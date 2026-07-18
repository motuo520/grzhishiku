"""Sync-related models for encrypted multi-device cloud sync."""

from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, BigInteger
from sqlalchemy.sql import func
from app.core.database import Base


class SyncDevice(Base):
    __tablename__ = "sync_devices"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    fingerprint = Column(String, nullable=False, index=True)  # stable device id
    last_seen_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    last_sync_at = Column(DateTime)
    is_current = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class SyncOperation(Base):
    __tablename__ = "sync_operations"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    device_id = Column(String, nullable=False, index=True)
    entity_type = Column(String, nullable=False)  # note, clip, knowledge_unit, capsule, tag
    entity_id = Column(String, nullable=False)
    op_type = Column(String, nullable=False)  # create, update, delete
    op_timestamp = Column(DateTime, nullable=False)
    checksum = Column(String, nullable=False)  # sha256 of encrypted payload slice
    applied_at = Column(DateTime)  # null until the target device has applied it
    created_at = Column(DateTime, server_default=func.now())


class SyncSnapshot(Base):
    __tablename__ = "sync_snapshots"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    device_id = Column(String, nullable=False, index=True)
    s3_key = Column(String, nullable=False, unique=True)
    size_bytes = Column(BigInteger, default=0)
    salt = Column(String, nullable=False)  # public salt used for key derivation
    iv = Column(String, nullable=False)    # public IV/nonce for AES-GCM
    entity_count = Column(Integer, default=0)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
