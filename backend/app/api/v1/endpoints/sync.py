from datetime import datetime
from typing import List, Optional
import os
import shutil
import tempfile

from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
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


@router.post("/devices", response_model=DeviceOut)
def register_device(
    req: DeviceRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return sync_service.register_device(
        db, current_user.id, req.name, req.fingerprint
    )


@router.get("/devices", response_model=List[DeviceOut])
def list_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return sync_service.list_devices(db, current_user.id)


@router.delete("/devices/{device_id}")
def remove_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
):
    device = sync_service.get_or_create_device(
        db, current_user.id, fingerprint=fingerprint
    )
    # 分块写入临时文件再流式上传，避免整个快照一次性读进内存
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, prefix="psb-sync-", suffix=".enc") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
        size = os.path.getsize(tmp_path)
        with open(tmp_path, "rb") as f:
            s3_key = sync_storage_service.upload_encrypted_blob(
                current_user.id, device.id, f
            )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    snapshot = sync_service.record_snapshot(
        db,
        current_user.id,
        device.id,
        s3_key,
        size_bytes=size,
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


@router.get("/snapshots/latest/download")
def download_latest_snapshot(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """直接经后端下载最新快照密文（不走预签名 URL，S3 可完全保持内网）。"""
    snapshot = sync_service.get_latest_snapshot(db, current_user.id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="云端暂无快照")
    from fastapi import Response as _Response
    data = sync_storage_service.download_encrypted_blob(snapshot.s3_key)
    return _Response(content=data, media_type="application/octet-stream")


@router.get("/snapshots/latest", response_model=Optional[SnapshotOut])
def get_latest_snapshot(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
