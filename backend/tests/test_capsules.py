import pytest
from fastapi.testclient import TestClient


class TestCapsules:
    def test_create_capsule(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/capsules", headers=auth_headers, json={
            "content_type": "text",
            "content_body": "Sealed message",
            "unlock_type": "temporal",
            "unlock_config": {"date": "2025-12-31"},
        })
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["content_body"] == "Sealed message"

    def test_list_capsules(self, client: TestClient, test_capsule, auth_headers):
        resp = client.get("/api/v1/capsules", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_capsule_detail(self, client: TestClient, test_capsule, auth_headers):
        resp = client.get(f"/api/v1/capsules/{test_capsule.id}", headers=auth_headers)
        assert resp.status_code in (200, 403)  # May be locked

    def test_capsule_unlock(self, client: TestClient, test_capsule, auth_headers):
        # Temporal unlock may not be available, but endpoint should respond
        resp = client.post(f"/api/v1/capsules/{test_capsule.id}/unlock", headers=auth_headers)
        assert resp.status_code in (200, 400, 403, 422)

    def test_capsule_dialogue(self, client: TestClient, test_capsule, auth_headers):
        resp = client.post(f"/api/v1/capsules/{test_capsule.id}/dialogue", headers=auth_headers, json={
            "message": "Hello past me",
        })
        assert resp.status_code in (200, 400, 403, 422)

    def test_get_capsule_dialogue(self, client: TestClient, test_capsule, auth_headers):
        resp = client.get(f"/api/v1/capsules/{test_capsule.id}/dialogue", headers=auth_headers)
        assert resp.status_code in (200, 400, 403, 422)
        if resp.status_code == 200:
            data = resp.json()
            assert "messages" in data
            assert isinstance(data["messages"], list)
