from sqlalchemy import Column, String, DateTime, Integer, Index, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["Folder"]


class Folder(Base):
    """每脑文件夹树：文件夹必属一个脑（personal / network），管「笔记放在哪」。"""

    __tablename__ = "folders"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # 团队文件夹（可空）：非空=团队空间共享，空=个人空间
    brain_side = Column(String, nullable=False)  # personal / network（无 both）
    parent_id = Column(String, index=True)  # 可空，空=根级
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)
    # 自动归档规则（JSON：{"tags": [...], "subtypes": [...], "verification": [...]}，夹内 OR）。
    # 有规则的夹=系统车道（规则间可换道）；无规则的夹=用户领地（永远不被动）
    auto_rules = Column(Text)
    # 目录级权限（10-01）：inherit=沿父链上溯（默认，存量零行为变化）/
    # private=仅创建者+租户 owner/admin / restricted=按 folder_shares 授权清单。
    # 个人空间无实际效果（单人空间本就只自己可见）。判定单点：tenant_scope.invisible_folder_ids
    visibility = Column(String, default="inherit")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_folders_user_brain', 'user_id', 'brain_side'),
    )
