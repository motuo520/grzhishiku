from sqlalchemy import Column, String, DateTime, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["EmergenceResult", "EmergenceIdea", "EmergenceCanvas"]


class EmergenceResult(Base):
    __tablename__ = "emergence_results"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    type = Column(String, nullable=False)  # associate / collision / hybrid / counterfactual
    brain_side = Column(String, default="both")  # personal / network / both
    source_ids = Column(Text, default="[]")  # JSON array of source content ids
    source_types = Column(Text, default="[]")  # JSON array of source content types
    model_used = Column(String)  # actual LLM model used
    input_data = Column(Text, nullable=False)  # JSON
    output_data = Column(Text, nullable=False)  # JSON
    scores = Column(Text)  # JSON (optional)
    created_at = Column(DateTime, server_default=func.now())


class EmergenceIdea(Base):
    __tablename__ = "emergence_ideas"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    summary = Column(Text)
    brain_side = Column(String, default="both")  # personal / network / both
    source_result_ids = Column(Text, default="[]")  # JSON array of EmergenceResult.id
    tags = Column(Text, default="[]")  # JSON array
    status = Column(String, default="draft")  # draft / refining / converted
    target_type = Column(String)  # note / capsule / knowledge
    target_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_emergence_ideas_user_status', 'user_id', 'status'),
    )


class EmergenceCanvas(Base):
    __tablename__ = "emergence_canvases"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    brain_side = Column(String, default="both")  # personal / network / both
    nodes = Column(Text, default="[]")  # JSON array of canvas nodes
    edges = Column(Text, default="[]")  # JSON array of canvas edges
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_emergence_canvases_user_updated', 'user_id', 'updated_at'),
    )
