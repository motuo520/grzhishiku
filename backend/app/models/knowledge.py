from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, CheckConstraint, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = [
    "KnowledgeUnit", "PracticeRecord", "PipelineTransition", "DailyReview",
    "ContextGuide", "ExperimentLog", "DepthCheckLog", "EvolutionReflection",
]


class KnowledgeUnit(Base):
    __tablename__ = "knowledge_units"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    brain_side = Column(String, default="network")
    content_raw = Column(Text, nullable=False)
    content_processed = Column(Text)
    content_type = Column(String)
    content_confidence = Column(Float)
    source_url = Column(String)
    source_title = Column(String)
    source_type = Column(String)
    source_author = Column(String)
    source_publish_date = Column(DateTime)
    source_access_date = Column(DateTime, server_default=func.now())
    source_credibility_score = Column(Float)
    source_bias_indicator = Column(String)
    source_funding_source = Column(String)
    verification_history = Column(Text, default='[]')
    verification_status = Column(String, default="unverified", index=True)
    verification_consensus = Column(Float)
    last_verified = Column(DateTime)
    next_scheduled = Column(DateTime)
    timeliness_status = Column(String)
    timeliness_half_life = Column(Integer)
    timeliness_deprecation_warning = Column(String)
    trust_level = Column(String, default="tentative")
    first_seen = Column(DateTime, server_default=func.now())
    last_reviewed = Column(DateTime)
    review_count = Column(Integer, default=0)
    status = Column(String, default="active")
    flag_reason = Column(String)
    tenant_id = Column(String)
    origin_type = Column(String, default="book_excerpt")
    invoke_count = Column(Integer, default=0)
    last_invoked_at = Column(DateTime)
    practice_depth = Column(Integer, default=0)
    personal_relevance_score = Column(Float, default=0.5)
    evolution_stage = Column(String, default="collected")
    attached_practice_ids = Column(Text, default='[]')
    pipeline_stage = Column(String, default="raw")
    content_subtype = Column(String, default="note")
    source_id = Column(String)
    source_content_type = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_knowledge_user_verification', 'user_id', 'verification_status'),
        Index('ix_knowledge_evolution', 'user_id', 'evolution_stage'),
        Index('ix_knowledge_invoke', 'user_id', 'invoke_count'),
        Index('ix_knowledge_pipeline', 'user_id', 'brain_side', 'pipeline_stage'),
        Index('ix_knowledge_subtype', 'user_id', 'content_subtype'),
        CheckConstraint("source_content_type IS NULL OR source_content_type IN ('note', 'knowledge')", name='ck_knowledge_source_content_type'),
    )

class PracticeRecord(Base):
    __tablename__ = "practice_records"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    practice_type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    result = Column(Text)
    learned_lesson = Column(Text)
    context_snapshot = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_practice_user_target', 'user_id', 'target_type', 'target_id'),
        Index('ix_practice_created', 'user_id', 'created_at'),
    )

class PipelineTransition(Base):
    __tablename__ = "pipeline_transitions"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    content_type = Column(String, nullable=False)
    content_id = Column(String, nullable=False)
    from_stage = Column(String, nullable=False)
    to_stage = Column(String, nullable=False)
    brain_side_before = Column(String)
    brain_side_after = Column(String)
    action = Column(String, default="transition")  # transition / extract / collide / review / brain_convert
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_pipeline_transition_user_content', 'user_id', 'content_type', 'content_id'),
        Index('ix_pipeline_transition_created', 'user_id', 'created_at'),
    )


class DailyReview(Base):
    __tablename__ = "daily_reviews"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    review_date = Column(DateTime, nullable=False)
    content_summary = Column(Text)
    ai_reflection = Column(Text)
    gaps_found = Column(Text, default='[]')
    action_items = Column(Text, default='[]')
    praise_items = Column(Text, default='[]')
    status = Column(String, default="pending")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_daily_reviews_user_date', 'user_id', 'review_date'),
    )

class ContextGuide(Base):
    __tablename__ = "context_guides"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    scope = Column(String, default="both")  # personal / network / both
    is_active = Column(Boolean, default=True)
    version_tag = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_context_guides_user_active', 'user_id', 'is_active'),
    )


class ExperimentLog(Base):
    __tablename__ = "experiment_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    hypothesis = Column(Text, nullable=False)
    controlled_variable = Column(Text)
    expected_result = Column(Text)
    actual_result = Column(Text)
    conclusion = Column(Text)
    status = Column(String, default="planned")  # planned / running / completed / abandoned
    related_content_type = Column(String)  # note / knowledge_unit
    related_content_id = Column(String)
    brain_side = Column(String, default="both")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_experiment_logs_user_status', 'user_id', 'status'),
        CheckConstraint("related_content_type IS NULL OR related_content_type IN ('note', 'knowledge_unit')", name='ck_experiment_related_content_type'),
    )


class DepthCheckLog(Base):
    __tablename__ = "depth_check_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    content_type = Column(String, nullable=False)  # note / knowledge_unit / text
    content_id = Column(String)
    content_preview = Column(String)
    depth_score = Column(Float, default=0.0)
    is_passed = Column(Boolean, default=False)
    feedback = Column(Text)
    suggestions = Column(Text, default='[]')  # JSON array
    model_used = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_depth_check_logs_user_created', 'user_id', 'created_at'),
        CheckConstraint("content_type IN ('note', 'knowledge_unit', 'text')", name='ck_depth_check_content_type'),
    )


class EvolutionReflection(Base):
    __tablename__ = "evolution_reflections"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    discomfort_level = Column(Integer, default=1)  # 1-5
    pain_description = Column(Text)
    joy_description = Column(Text)
    learning = Column(Text)
    is_true_evolution = Column(Boolean, default=True)
    related_content_type = Column(String)  # note / knowledge_unit / experiment_log
    related_content_id = Column(String)
    brain_side = Column(String, default="personal")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_evolution_reflections_user_created', 'user_id', 'created_at'),
        CheckConstraint("related_content_type IS NULL OR related_content_type IN ('note', 'knowledge_unit', 'experiment_log')", name='ck_evolution_related_content_type'),
    )
