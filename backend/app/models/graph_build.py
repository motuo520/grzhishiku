from sqlalchemy import Column, String, DateTime, Boolean, Integer, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["GraphBuildState"]


class GraphBuildState(Base):
    """图谱构建状态落库（内存 _build_status 的持久层，进程重启可水合/续建）。

    空间口径（09-12）：按空间各一行，主键 (user_id, tenant_id)。
    - 个人空间行 tenant_id=''（空串占位，非 NULL）：SQLite 复合主键里 NULL 互不
      判等，(user, NULL) 可重复插入、唯一性形同虚设——'' 是唯一安全的「个人」表达。
      注意这与内容表「tenant_id IS NULL=个人」的口径不同，仅限本表。
    - 团队空间行 = 团队共享一行（tenant_id=T 不限作者）：构建是整个空间的资源，
      谁触发都读写同一行；行上的 user_id 只记首个创建者，不作过滤条件。
    """

    __tablename__ = "graph_build_state"

    user_id = Column(String, primary_key=True)
    tenant_id = Column(String, primary_key=True, default="", server_default="")  # ''=个人空间（占位原因见上）
    state = Column(String, default="idle")  # idle|exporting|building|done|failed
    progress = Column(Text)
    error = Column(Text)
    has_graph = Column(Boolean, default=False)
    doc_count = Column(Integer)
    synced_edges = Column(Integer)
    warning = Column(Text)
    finished_at = Column(String)  # ISO 字符串，与内存状态形状一致
    preferred_model = Column(String)  # 断点续建时恢复原模型选择
    evolve_dirty = Column(Boolean, default=False)  # 自进化 dirty 落库
    evolve_pending = Column(Integer, default=0)  # 待进化内容条数（写入事件累计，构建成功清零）
    auto_resumed = Column(Boolean, default=False)  # 防崩溃循环：只自动续建一次
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
