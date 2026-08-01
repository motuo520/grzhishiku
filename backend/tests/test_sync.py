import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.models.sync import SyncDevice, SyncOperation, SyncSnapshot


@pytest.fixture
def sync_s3_stub():
    """In-memory stub for encrypted sync blob storage."""
    blobs = {}
    counter = {"n": 0}

    def upload(user_id: str, device_id: str, data: bytes) -> str:
        counter["n"] += 1
        key = f"sync/{user_id}/test-{counter['n']}.enc"
        blobs[key] = data
        return key

    def download(s3_key: str) -> bytes:
        return blobs[s3_key]

    def url(s3_key: str, expires_in: int = 300) -> str:
        return f"http://test-server/sync-download/{s3_key}"

    def delete(s3_key: str) -> None:
        blobs.pop(s3_key, None)

    with patch("app.services.sync_storage_service.upload_encrypted_blob", side_effect=upload), \
         patch("app.services.sync_storage_service.download_encrypted_blob", side_effect=download), \
         patch("app.services.sync_storage_service.get_download_url", side_effect=url), \
         patch("app.services.sync_storage_service.delete_blob", side_effect=delete):
        yield blobs


def test_register_and_list_devices(client, auth_headers, sync_s3_stub):
    resp = client.post(
        "/api/v1/sync/devices",
        json={"name": "Test Device", "fingerprint": "fp-1"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Test Device"
    assert data["fingerprint"] == "fp-1"

    resp = client.get("/api/v1/sync/devices", headers=auth_headers)
    assert resp.status_code == 200
    devices = resp.json()
    assert len(devices) == 1
    assert devices[0]["fingerprint"] == "fp-1"


def test_push_and_pull_operations(client, auth_headers, sync_s3_stub):
    # Register two devices
    client.post(
        "/api/v1/sync/devices",
        json={"name": "Device A", "fingerprint": "fp-a"},
        headers=auth_headers,
    )
    client.post(
        "/api/v1/sync/devices",
        json={"name": "Device B", "fingerprint": "fp-b"},
        headers=auth_headers,
    )

    now = datetime.now(timezone.utc).isoformat()
    resp = client.post(
        "/api/v1/sync/operations",
        json=[
            {
                "entity_type": "note",
                "entity_id": "note-1",
                "op_type": "create",
                "op_timestamp": now,
                "checksum": "sha256-abc",
            }
        ],
        params={"fingerprint": "fp-a"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    ops = resp.json()
    assert len(ops) == 1
    assert ops[0]["entity_id"] == "note-1"

    resp = client.get(
        "/api/v1/sync/operations",
        params={"fingerprint": "fp-b"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    pending = resp.json()
    assert len(pending) == 1
    assert pending[0]["entity_id"] == "note-1"


def test_upload_and_latest_snapshot(client, auth_headers, sync_s3_stub):
    fp = "fp-snapshot"
    client.post(
        "/api/v1/sync/devices",
        json={"name": "Snap Device", "fingerprint": fp},
        headers=auth_headers,
    )

    form = {
        "fingerprint": fp,
        "salt": "c2FsdA==",
        "iv": "aXY=",
        "entity_count": "3",
    }
    files = {"file": ("snapshot.enc", b"encrypted-bytes", "application/octet-stream")}
    resp = client.post(
        "/api/v1/sync/snapshots",
        data=form,
        files=files,
        headers=auth_headers,
    )
    assert resp.status_code == 200
    snap = resp.json()
    assert snap["size_bytes"] == len(b"encrypted-bytes")
    assert snap["entity_count"] == 3
    assert snap["download_url"].startswith("http://test-server/sync-download/")

    resp = client.get("/api/v1/sync/snapshots/latest", headers=auth_headers)
    assert resp.status_code == 200
    latest = resp.json()
    assert latest["id"] == snap["id"]


def test_admin_users_includes_sync_stats(client, auth_headers, admin_user, sync_s3_stub):
    # Create a user device + snapshot so sync stats are non-zero.
    client.post(
        "/api/v1/sync/devices",
        json={"name": "Admin Test Device", "fingerprint": "fp-admin"},
        headers=auth_headers,
    )
    form = {
        "fingerprint": "fp-admin",
        "salt": "c2FsdA==",
        "iv": "aXY=",
        "entity_count": "1",
    }
    files = {"file": ("snapshot.enc", b"x", "application/octet-stream")}
    client.post(
        "/api/v1/sync/snapshots",
        data=form,
        files=files,
        headers=auth_headers,
    )

    from app.core.security import create_access_token
    admin_token = create_access_token(
        data={"sub": admin_user.id, "email": admin_user.email, "is_admin": True},
        expires_delta=timedelta(days=1),
        is_admin=True,
    )
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = client.get("/api/admin/users", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    test_user = next(u for u in data["items"] if u["email"] == "test@example.com")
    assert test_user["sync_devices_count"] == 1
    assert test_user["last_sync_at"] is not None
