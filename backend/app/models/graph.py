from sqlalchemy import Column, String, DateTime, Boolean, Float, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["GraphEdge"]


class GraphEdge(Base):
    __tablename__ = "graph_edges"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
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
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_graph_edges_user_source_target', 'user_id', 'source_id', 'target_id'),
    )
