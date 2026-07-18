"""Business logic for multi-device encrypted cloud sync.

The server is a dumb store for encrypted blobs and operation logs.
Encryption/decryption and conflict resolution happen on the client.
"""

import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.sync import SyncDevice, SyncOperation, SyncSnapshot
from app.services import sync_storage_service


def register_device(db: Session, user_id: str, name: str, fingerprint: str) -> SyncDevice:
    device = (
        db.query(SyncDevice)
        .filter(SyncDevice.user_id == user_id, SyncDevice.fingerprint == fingerprint)
        .first()
    )
    if device:
        device.name = name
        device.last_seen_at = datetime.utcnow()
    else:
        device = SyncDevice(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name,
            fingerprint=fingerprint,
            last_seen_at=datetime.utcnow(),
        )
        db.add(device)
    db.commit()
    db.refresh(device)
    return device


def list_devices(db: Session, user_id: str) -> List[SyncDevice]:
    return (
        db.query(SyncDevice)
        .filter(SyncDevice.user_id == user_id)
        .order_by(desc(SyncDevice.last_seen_at))
        .all()
    )


def remove_device(db: Session, user_id: str, device_id: str) -> bool:
    device = (
        db.query(SyncDevice)
        .filter(SyncDevice.user_id == user_id, SyncDevice.id == device_id)
        .first()
    )
    if not device:
        return False
    db.delete(device)
    db.commit()
    return True


def touch_device(db: Session, user_id: str, fingerprint: str) -> None:
    device = (
        db.query(SyncDevice)
        .filter(SyncDevice.user_id == user_id, SyncDevice.fingerprint == fingerprint)
        .first()
    )
    if device:
        device.last_seen_at = datetime.utcnow()
        db.commit()


def get_or_create_device(
    db: Session, user_id: str, fingerprint: str, name: Optional[str] = None
) -> SyncDevice:
    device = (
        db.query(SyncDevice)
        .filter(SyncDevice.user_id == user_id, SyncDevice.fingerprint == fingerprint)
        .first()
    )
    if device:
        device.last_seen_at = datetime.utcnow()
        if name:
            device.name = name
    else:
        device = SyncDevice(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name or "未命名设备",
            fingerprint=fingerprint,
            last_seen_at=datetime.utcnow(),
        )
        db.add(device)
    db.commit()
    db.refresh(device)
    return device


def push_operations(
    db: Session, user_id: str, device_id: str, ops_data: List[dict]
) -> List[SyncOperation]:
    ops = []
    for item in ops_data:
        op = SyncOperation(
            id=str(uuid.uuid4()),
            user_id=user_id,
            device_id=device_id,
            entity_type=item["entity_type"],
            entity_id=item["entity_id"],
            op_type=item["op_type"],
            op_timestamp=item["op_timestamp"],
            checksum=item["checksum"],
        )
        db.add(op)
        ops.append(op)
    db.commit()
    for op in ops:
        db.refresh(op)
    return ops


def get_pending_operations(
    db: Session, user_id: str, device_id: str, since: Optional[datetime] = None
) -> List[SyncOperation]:
    query = db.query(SyncOperation).filter(
        SyncOperation.user_id == user_id,
        SyncOperation.device_id != device_id,
    )
    if since:
        query = query.filter(SyncOperation.op_timestamp > since)
    return query.order_by(SyncOperation.op_timestamp).all()


def record_snapshot(
    db: Session,
    user_id: str,
    device_id: str,
    s3_key: str,
    size_bytes: int,
    salt: str,
    iv: str,
    entity_count: int = 0,
) -> SyncSnapshot:
    snapshot = SyncSnapshot(
        id=str(uuid.uuid4()),
        user_id=user_id,
        device_id=device_id,
        s3_key=s3_key,
        size_bytes=size_bytes,
        salt=salt,
        iv=iv,
        entity_count=entity_count,
        expires_at=datetime.utcnow() + timedelta(days=30),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    _cleanup_old_snapshots(db, user_id, keep=5)
    return snapshot


def get_latest_snapshot(db: Session, user_id: str) -> Optional[SyncSnapshot]:
    return (
        db.query(SyncSnapshot)
        .filter(SyncSnapshot.user_id == user_id)
        .order_by(desc(SyncSnapshot.created_at))
        .first()
    )


def _cleanup_old_snapshots(db: Session, user_id: str, keep: int = 5) -> None:
    snapshots = (
        db.query(SyncSnapshot)
        .filter(SyncSnapshot.user_id == user_id)
        .order_by(desc(SyncSnapshot.created_at))
        .all()
    )
    for old in snapshots[keep:]:
        sync_storage_service.delete_blob(old.s3_key)
        db.delete(old)
    db.commit()
