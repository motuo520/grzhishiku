from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import List, Optional


class DeviceRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    fingerprint: str = Field(..., min_length=1, max_length=128)


class DeviceOut(BaseModel):
    id: str
    name: str
    fingerprint: str
    last_seen_at: Optional[datetime]
    last_sync_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class SyncOperationIn(BaseModel):
    entity_type: str = Field(..., min_length=1, max_length=32)
    entity_id: str = Field(..., min_length=1, max_length=64)
    op_type: str = Field(..., pattern="^(create|update|delete)$")
    op_timestamp: datetime
    checksum: str = Field(..., min_length=1, max_length=128)


class SyncOperationOut(BaseModel):
    id: str
    device_id: str
    entity_type: str
    entity_id: str
    op_type: str
    op_timestamp: datetime
    checksum: str
    created_at: datetime

    class Config:
        from_attributes = True


class SnapshotUploadMeta(BaseModel):
    salt: str = Field(..., min_length=1, max_length=256)
    iv: str = Field(..., min_length=1, max_length=256)
    entity_count: int = Field(0, ge=0)


class SnapshotOut(BaseModel):
    id: str
    device_id: str
    s3_key: str
    size_bytes: int
    salt: str
    iv: str
    entity_count: int
    download_url: str
    created_at: datetime
