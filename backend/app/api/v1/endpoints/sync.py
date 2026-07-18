from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.feature_guard import require_feature
from app.models.base import User
from app.schemas.sync import (
    DeviceRegisterRequest,
    DeviceOut,
    SyncOperationIn,
    SyncOperationOut,
    SnapshotOut,
)
from app.services import sync_service, sync_storage_service

router = APIRouter(tags=["Sync"])


def _device_fingerprint() -> str:
    # The fingerprint is supplied by the client during registration and then
    # kept in localStorage.  For endpoints that do not re-register we rely on
    # the client sending it in a header or form field.  Here we accept it via
    # a simple query/form parameter for GET requests.
    raise NotImplementedError("use fingerprint parameter")


@router.post("/devices", response_model=DeviceOut)
def register_device(
    req: DeviceRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    return sync_service.register_device(
        db, current_user.id, req.name, req.fingerprint
    )


@router.get("/devices", response_model=List[DeviceOut])
def list_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    return sync_service.list_devices(db, current_user.id)


@router.delete("/devices/{device_id}")
def remove_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    if not sync_service.remove_device(db, current_user.id, device_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="设备不存在")
    return {"ok": True}


@router.post("/operations", response_model=List[SyncOperationOut])
def push_operations(
    ops: List[SyncOperationIn],
    fingerprint: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    device = sync_service.get_or_create_device(
        db, current_user.id, fingerprint=fingerprint
    )
    data = [op.model_dump() for op in ops]
    return sync_service.push_operations(db, current_user.id, device.id, data)


@router.get("/operations", response_model=List[SyncOperationOut])
def get_pending_operations(
    fingerprint: str,
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    device = sync_service.get_or_create_device(
        db, current_user.id, fingerprint=fingerprint
    )
    return sync_service.get_pending_operations(
        db, current_user.id, device.id, since=since
    )


@router.post("/snapshots", response_model=SnapshotOut)
def upload_snapshot(
    fingerprint: str = Form(...),
    salt: str = Form(...),
    iv: str = Form(...),
    entity_count: int = Form(0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    device = sync_service.get_or_create_device(
        db, current_user.id, fingerprint=fingerprint
    )
    data = file.file.read()
    s3_key = sync_storage_service.upload_encrypted_blob(
        current_user.id, device.id, data
    )
    snapshot = sync_service.record_snapshot(
        db,
        current_user.id,
        device.id,
        s3_key,
        size_bytes=len(data),
        salt=salt,
        iv=iv,
        entity_count=entity_count,
    )
    device.last_sync_at = datetime.utcnow()
    db.commit()
    return SnapshotOut(
        id=snapshot.id,
        device_id=snapshot.device_id,
        s3_key=snapshot.s3_key,
        size_bytes=snapshot.size_bytes,
        salt=snapshot.salt,
        iv=snapshot.iv,
        entity_count=snapshot.entity_count,
        download_url=sync_storage_service.get_download_url(snapshot.s3_key),
        created_at=snapshot.created_at,
    )


@router.get("/snapshots/latest", response_model=Optional[SnapshotOut])
def get_latest_snapshot(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_feature("cloud_sync")),
):
    snapshot = sync_service.get_latest_snapshot(db, current_user.id)
    if not snapshot:
        return None
    return SnapshotOut(
        id=snapshot.id,
        device_id=snapshot.device_id,
        s3_key=snapshot.s3_key,
        size_bytes=snapshot.size_bytes,
        salt=snapshot.salt,
        iv=snapshot.iv,
        entity_count=snapshot.entity_count,
        download_url=sync_storage_service.get_download_url(snapshot.s3_key),
        created_at=snapshot.created_at,
    )
