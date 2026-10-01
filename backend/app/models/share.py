from sqlalchemy import Column, String, DateTime, Boolean, Integer
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["ShareLink"]


class ShareLink(Base):
    """只读分享链接（10-01 激活计费层预留的 public_sharing 特性）。

    - token 匿名可访问，泄露即公开——只回正文文本，绝不回传 user_id/email/租户信息
    - tenant_id 口径：团队空间打租户 id，个人空间空串 ''（scope 查询同口径）
    - expires_at NULL = 永久；revoked=True 即吊销（公开端统一 404，防枚举）
    """
    __tablename__ = "share_links"

    id = Column(String, primary_key=True)
    token = Column(String, nullable=False, unique=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, default='')  # '' = 个人空间；团队空间 = 租户 id
    content_type = Column(String, nullable=False)  # note / clip / knowledge / document
    content_id = Column(String, nullable=False)
    expires_at = Column(DateTime)  # NULL = 永久
    revoked = Column(Boolean, default=False)
    access_count = Column(Integer, default=0)
    last_accessed_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
