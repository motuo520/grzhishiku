"""目录级权限实体（10-01 立项）：租户分组 + 文件夹授权。

- UserGroup / UserGroupMember：部门/分组实体（仅租户上下文有意义），
  owner/admin 管理，成员必须本是本租户 active member。
- FolderShare：restricted 夹的授权清单（user 直授 / group 间授）。
  level 列预留 read/write 细分，本轮统一「可见即可操作」。
- Folder.visibility（folder.py 补列）：inherit（默认，沿父链上溯）/
  private（仅创建者+租户 owner/admin）/restricted（按 FolderShare 清单）。
判定单点在 app/core/tenant_scope.py（血泪#85：规则单点化，各路径只调它）。
"""
from sqlalchemy import Column, String, DateTime, Index
from sqlalchemy.sql import func

from app.core.database import Base

__all__ = ["UserGroup", "UserGroupMember", "FolderShare"]


class UserGroup(Base):
    """租户内分组（部门雏形）：仅团队空间；个人空间无分组概念。"""

    __tablename__ = "user_groups"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    created_by = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class UserGroupMember(Base):
    """分组 ↔ 成员（成员必须同时是本租户 active TenantMember，端点层校验）。"""

    __tablename__ = "user_group_members"

    id = Column(String, primary_key=True)
    group_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("uq_group_member", "group_id", "user_id", unique=True),
    )


class FolderShare(Base):
    """restricted 文件夹的授权行：grantee_type='user' 直授 / 'group' 经分组间授。"""

    __tablename__ = "folder_shares"

    id = Column(String, primary_key=True)
    folder_id = Column(String, nullable=False, index=True)
    grantee_type = Column(String, nullable=False)  # user / group
    grantee_id = Column(String, nullable=False)
    level = Column(String, nullable=False, default="write")  # write 默认；read 预留（本轮不细分行为）
    created_by = Column(String)
    created_at = Column(DateTime, server_default=func.now())
