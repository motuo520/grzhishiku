from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AdminUser", "AdminAuditLog", "Tenant", "SystemConfig"]


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    avatar = Column(String)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)
    permissions = Column(Text)
    status = Column(String, default="pending")
    last_login_at = Column(DateTime)
    last_login_ip = Column(String)
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    created_by = Column(String)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    tenant_id = Column(String)
    managed_tenants = Column(Text)

class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id = Column(String, primary_key=True)
    admin_id = Column(String, nullable=False)
    admin_name = Column(String)
    admin_role = Column(String)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)
    resource_id = Column(String)
    before_state = Column(Text)
    after_state = Column(Text)
    changes = Column(Text)
    ip_address = Column(String)
    user_agent = Column(String)
    request_id = Column(String)
    risk_level = Column(String, default="low")
    risk_reason = Column(String)
    details = Column(Text)
    created_at = Column(DateTime, server_default=func.now())


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True)
    description = Column(String)
    status = Column(String, default="active")
    plan = Column(String, default="free")
    max_users = Column(Integer, default=10)
    max_storage = Column(Integer, default=10737418240)
    owner_id = Column(String)
    settings = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SystemConfig(Base):
    __tablename__ = "system_configs"

    id = Column(String, primary_key=True)
    key = Column(String, nullable=False, unique=True)
    value_json = Column(Text, nullable=False, default='{}')
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    updated_by = Column(String)
