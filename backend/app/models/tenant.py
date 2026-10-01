from sqlalchemy import Column, String, DateTime, Index, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["TenantMember", "TenantAudit"]


class TenantMember(Base):
    """租户成员：企业版业务层第一刀。

    role: owner（创建者，不可被移除）/ admin / member。
    用户与租户为多对多（user.tenant_id 仅表示「当前激活租户」，由后续
    租户上下文接线使用；本切片不做数据隔离过滤）。
    """

    __tablename__ = "tenant_members"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False, default="member")  # owner / admin / member
    status = Column(String, nullable=False, default="active")  # active / removed
    invited_by = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_member"),
        Index("ix_tenant_members_user_status", "user_id", "status"),
    )


class TenantAudit(Base):
    """租户审计流水（只读）：成员增删/角色变更/租户创建/空间内容创建删除。

    actor_email 冗余存储——用户注销后审计仍能显示操作者。
    不做保留期/导出（后续需要再加）。
    """

    __tablename__ = "tenant_audit"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    actor_user_id = Column(String, nullable=False)
    actor_email = Column(String)
    action = Column(String, nullable=False)  # tenant_create / member_add / member_remove / content_create / content_delete / folder_create / folder_update / folder_delete / tag_create / tag_delete / tag_merge
    target_type = Column(String, nullable=False)  # member / note / knowledge / clip / tenant / folder / tag
    target_id = Column(String)
    detail = Column(String)  # 目标标题/被移除者邮箱等（截断 80 字）
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_tenant_audit_tenant_created", "tenant_id", "created_at"),
    )
