from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["User"]


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True)
    name = Column(String)
    username = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    avatar = Column(String)
    password_hash = Column(String)
    status = Column(String, default="active")
    storage_used = Column(Integer, default=0)
    storage_limit = Column(Integer, default=1073741824)
    last_login_at = Column(DateTime)
    last_login_ip = Column(String)
    mfa_enabled = Column(Boolean, default=False)
    settings = Column(Text, default='{}')
    active_brain = Column(String, default="personal")
    token_version = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    tenant_id = Column(String)

    __table_args__ = (
        Index('ix_users_email_status', 'email', 'status'),
    )
