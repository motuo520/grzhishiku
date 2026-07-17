from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = [
    "AttentionActivity", "AttentionCategory", "AttentionGuardianRule",
    "AttentionRation", "DeepWorkSession",
]


class AttentionActivity(Base):
    __tablename__ = "attention_activities"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    category_id = Column(String, nullable=False)
    category = Column(String, default="other")
    activity_source = Column(String, default="unknown")
    brain_side = Column(String)
    description = Column(String)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime)
    actual_duration = Column(Integer)
    source = Column(String)
    metadata_url = Column(String)
    metadata_app = Column(String)
    metadata_title = Column(String)
    completion_status = Column(String)
    focus_score = Column(Float)
    focus_duration = Column(Float)
    focus_intensity = Column(Float)
    focus_recovery = Column(Float)
    focus_switching = Column(Float)
    created_at = Column(DateTime, server_default=func.now())
    tenant_id = Column(String)

    __table_args__ = (
        Index('ix_attention_user_created', 'user_id', 'created_at'),
    )

class AttentionCategory(Base):
    __tablename__ = "attention_categories"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    icon = Column(String)
    color = Column(String)
    brain_side = Column(String, default="personal")
    allocated_minutes = Column(Integer, nullable=False)
    min_required = Column(Integer)
    max_allowed = Column(Integer)
    priority = Column(String)
    auto_rebalance_from = Column(Text)
    notify_at = Column(Float)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    tenant_id = Column(String)

class AttentionGuardianRule(Base):
    __tablename__ = "attention_guardian_rules"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    type = Column(String, nullable=False)  # website | app | notification
    target = Column(String, nullable=False)
    mode = Column(String, nullable=False, default="block")  # block | limit
    limit_minutes = Column(Integer)
    active = Column(Boolean, default=True)
    schedule_days = Column(String)  # JSON list of ints 0-6
    schedule_start = Column(String)  # HH:MM
    schedule_end = Column(String)  # HH:MM
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class AttentionRation(Base):
    __tablename__ = "attention_rations"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    source_type = Column(String, nullable=False)  # rss | social | email | clip
    source_id = Column(String)
    name = Column(String, nullable=False)
    daily_limit_minutes = Column(Integer, nullable=False)
    used_minutes = Column(Integer, default=0)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class DeepWorkSession(Base):
    __tablename__ = "deep_work_sessions"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    brain_side = Column(String, default="personal")
    task = Column(String, nullable=False)
    planned_duration = Column(Integer, nullable=False)
    actual_duration = Column(Integer)
    started_at = Column(DateTime)
    ended_at = Column(DateTime)
    rules_block_notifications = Column(Boolean)
    rules_blocked_apps = Column(Text)
    rules_blocked_websites = Column(Text)
    rules_allowed_websites = Column(Text)
    rules_ambient_sound = Column(String)
    focus_score_avg = Column(Float)
    interruptions = Column(Integer, default=0)
    blocked_attempts = Column(Integer, default=0)
    completion_status = Column(String)
    end_reason = Column(String)
    tenant_id = Column(String)
