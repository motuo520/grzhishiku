"""回收站快照（10-01）：四类内容软删前的派生关联快照，30 天恢复窗口。

四类内容（Note/BrowserClip/KnowledgeUnit 的 status、Document 的 doc_status）
软删时会清 content_tags 关联与 graph_edges 图边——回收站恢复要把它们找回来，
删除前先落一份快照进本表；30 天到期由 hourly sweep 物理清（连同内容行本身）。

无快照的老数据（特性上线前删的）恢复时只翻 status，tags/edges 无法找回。
"""
from sqlalchemy import Column, String, DateTime, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["RecycleSnapshot"]


class RecycleSnapshot(Base):
    __tablename__ = "recycle_snapshots"

    id = Column(String, primary_key=True)
    content_type = Column(String, nullable=False)  # note / knowledge / clip / document
    content_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, default="")  # 空间归属快照：''=个人空间（内容表用 NULL，这里统一空串免三值逻辑）
    tags_json = Column(Text)   # content_tags 行快照：[{tag_id, source}, ...]
    edges_json = Column(Text)  # graph_edges 行快照：重建一条边所需的全部列
    deleted_at = Column(DateTime, server_default=func.now())
    purge_after = Column(DateTime)  # deleted_at + 30 天，到期物理清
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # 同一内容只允许一条快照：重复删除（幂等）走更新而不是插重
        Index('ix_recycle_snapshots_content', 'content_type', 'content_id', unique=True),
    )
