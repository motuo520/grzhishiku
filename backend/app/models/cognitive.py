from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, CheckConstraint, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = [
    "BiasDetectionRecord", "DecisionAudit", "FutureSimulation",
    "CognitiveChallenge", "CognitiveWeeklyReport",
]


class BiasDetectionRecord(Base):
    __tablename__ = "bias_detection_records"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    bias_type = Column(String, nullable=False)
    severity = Column(Integer, nullable=False)  # 1-5
    text_snippet = Column(Text, nullable=False)
    suggestion = Column(Text)
    source_content_id = Column(String)  # note_id or knowledge_id
    source_content_type = Column(String)  # note / knowledge
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint("source_content_type IS NULL OR source_content_type IN ('note', 'knowledge')", name='ck_bias_source_content_type'),
    )


class DecisionAudit(Base):
    __tablename__ = "decision_audits"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)
    title = Column(String, nullable=False)
    context = Column(Text, nullable=False)
    options = Column(Text, default='[]')  # JSON array
    expected_outcome = Column(Text)
    actual_outcome = Column(Text)
    decision_date = Column(DateTime)
    status = Column(String, default="pending")  # pending / reviewed / closed
    analysis_result = Column(Text, default='{}')  # JSON
    related_note_ids = Column(Text, default='[]')  # JSON array
    brain_side = Column(String, default="personal")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_decision_audits_user_status', 'user_id', 'status'),
        Index('ix_decision_audits_user_created', 'user_id', 'created_at'),
    )


class FutureSimulation(Base):
    __tablename__ = "future_simulations"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)
    title = Column(String, nullable=False)
    context = Column(Text, nullable=False)
    variables = Column(Text, default='[]')  # JSON array of variable names
    scenarios = Column(Text, default='[]')  # JSON array of scenario objects
    timeframes = Column(Text, default='[]')  # JSON array: ["1周", "1个月", "1年"]
    status = Column(String, default="pending")  # pending / simulated
    result = Column(Text, default='{}')  # JSON
    related_audit_id = Column(String)
    brain_side = Column(String, default="both")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_future_simulations_user_status', 'user_id', 'status'),
        Index('ix_future_simulations_user_created', 'user_id', 'created_at'),
    )


class CognitiveChallenge(Base):
    __tablename__ = "cognitive_challenges"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    challenge_date = Column(DateTime, nullable=False, index=True)  # assigned date
    type = Column(String, nullable=False)  # bias_quiz / thought_experiment / reflection
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    options = Column(Text, default='[]')  # JSON array for bias_quiz
    correct_answer = Column(String)
    explanation = Column(Text)
    user_answer = Column(String)
    is_correct = Column(Boolean)
    points = Column(Integer, default=0)
    completed_at = Column(DateTime)
    streak_before = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending / completed / skipped
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_cognitive_challenges_user_date', 'user_id', 'challenge_date'),
        Index('ix_cognitive_challenges_user_status', 'user_id', 'status'),
    )


class CognitiveWeeklyReport(Base):
    __tablename__ = "cognitive_weekly_reports"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    week_start = Column(DateTime, nullable=False, index=True)
    week_end = Column(DateTime, nullable=False)
    health_score: int = Column(Integer, default=0)  # 0-100
    summary = Column(Text)
    dimensions = Column(Text, default='[]')  # JSON array of {name, score, trend}
    highlights = Column(Text, default='[]')  # JSON array of strings
    risks = Column(Text, default='[]')  # JSON array of strings
    suggestions = Column(Text, default='[]')  # JSON array of strings
    stats = Column(Text, default='{}')  # JSON: notes_count, knowledge_count, challenges_completed, decisions_audited, biases_found
    status = Column(String, default="generated")  # generated / archived
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_cognitive_weekly_reports_user_week', 'user_id', 'week_start'),
    )
