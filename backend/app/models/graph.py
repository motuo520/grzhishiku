from sqlalchemy import Column, String, DateTime, Boolean, Float, Integer, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["GraphEdge", "GraphLayout", "CommunityDigest"]


class GraphEdge(Base):
    __tablename__ = "graph_edges"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # 团队空间归属（可空）：非空=团队内容的边，注销个人内容时保留
    source_id = Column(String, nullable=False, index=True)
    target_id = Column(String, nullable=False, index=True)
    source_brain_side = Column(String)
    target_brain_side = Column(String)
    edge_type = Column(String)
    strength = Column(Float, default=1.0)
    weight = Column(Float, default=1.0)
    context = Column(Text)
    cross_brain = Column(Boolean, default=False)
    auto_created = Column(Boolean, default=False)
    # 证据血缘（09-17 GraphRAG P1②）：边出自哪篇文档（graphify link.source_file 解析），
    # 以及两端 label 共现的 embeddings 子块 content_id 清单（JSON list，无匹配=[]）
    evidence_doc_id = Column(String)
    evidence_chunk_ids = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_graph_edges_user_source_target', 'user_id', 'source_id', 'target_id'),
    )


class GraphLayout(Base):
    """3D 图谱 V2 阶段一：两层布局落库。

    kind='node'      → 节点行：(x,y,z) 由 graph_layout_service 确定性布局算出；
    kind='community' → 社区超节点行：坐标=成员质心，size=成员数（LOD 用）。
    graphify 全量重建后整删整插（旧坐标作废重算）；手动边逻辑不涉及本表。
    """
    __tablename__ = "graph_layouts"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # 团队空间归属（可空），口径对齐 graph_edges
    graph_source = Column(String, nullable=False, default="semantic")  # semantic | physical
    node_id = Column(String, nullable=False)
    kind = Column(String, nullable=False, default="node")  # node | community
    community_id = Column(Integer)  # 节点行=所属社区；超节点行=自身社区号
    size = Column(Integer)  # 仅超节点行：成员数
    x = Column(Float, nullable=False, default=0.0)
    y = Column(Float, nullable=False, default=0.0)
    z = Column(Float, nullable=False, default=0.0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_graph_layouts_user_source', 'user_id', 'graph_source'),
    )


class CommunityDigest(Base):
    """RAG 大改阶段二：社区摘要（无 LLM 纯聚合），chat 全局/主题意图注入用。

    语义社区（graphify 构建收尾重算，整删整插）与物理社区（连通分量，随内容
    变化懒刷新，fingerprint 判陈旧）共用本表，graph_source 区分。

    独立建表而不复用 graph_layouts kind='digest'：布局行是坐标语义
    （x/y/z 非空、node_id 指图节点），摘要行是文本块 + 结构化 payload，
    强塞进布局表要新增悬空列且两类行字段大半互斥；生命周期也不同——
    布局只随构建整删整插，物理摘要按指纹懒刷新。
    """
    __tablename__ = "community_digests"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    # 空间归属（NULL=个人空间）：chat 注入按空间读取，整删整插按空间各存一份，
    # 防团队空间的全局意图吃到个人空间摘要（提示词级跨空间泄漏）
    tenant_id = Column(String)
    graph_source = Column(String, nullable=False, default="semantic")  # semantic | physical
    community_id = Column(Integer, nullable=False)
    label = Column(String)        # 社区中文名（graphify labels / 物理命名）
    size = Column(Integer, default=0)  # 成员数（语义=节点数；物理=内容条目数）
    text = Column(Text)           # 渲染好的摘要文本块（chat 注入直接用）
    payload = Column(Text)        # 结构化 JSON：top_tags/keywords/representatives/stages/time_range
    fingerprint = Column(String)  # 物理摘要陈旧判定（内容数+最新更新时间）；语义为 NULL
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_community_digests_user_source', 'user_id', 'graph_source'),
    )
