from sqlalchemy import Column, String, DateTime, Boolean, Float, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["Capsule", "CapsuleDialogue"]


class Capsule(Base):
    __tablename__ = "capsules"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    brain_side = Column(String, default="personal")
    content_type = Column(String)
    content_body = Column(Text, nullable=False)
    content_attachments = Column(Text)
    mood_emotion = Column(String)
    mood_intensity = Column(Float)
    mood_energy_level = Column(Float)
    mood_tags = Column(Text)  # JSON array of mood tags
    mood_trigger = Column(String)
    mood_weather = Column(String)
    mood_location = Column(String)
    sealed_at = Column(DateTime)
    privacy_level = Column(String, default="private")  # public, shared, private
    unlock_conditions = Column(Text)  # JSON detailed unlock conditions
    sealed_context = Column(Text)
    sealed_fingerprint = Column(String)
    unlock_type = Column(String)
    unlock_config = Column(Text, nullable=False)
    unlock_status = Column(String, default="locked")
    privacy_require_auth = Column(Boolean, default=False)
    privacy_allow_export = Column(Boolean, default=True)
    privacy_encryption_level = Column(String, default="local")
    status = Column(String, default="active")
    flag_reason = Column(String)
    tenant_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class CapsuleDialogue(Base):
    __tablename__ = "capsule_dialogues"

    id = Column(String, primary_key=True)
    capsule_id = Column(String, nullable=False)
    opened_at = Column(DateTime)
    opened_by = Column(String)
    present_context = Column(Text)
    present_mood = Column(Text)
    present_reflection = Column(Text)
    conversation = Column(Text)
    insights_pattern = Column(Text)
    insights_growth = Column(Text)
    insights_warning = Column(Text)
    insights_suggestion = Column(Text)
    closed_at = Column(DateTime)
    closure = Column(Text)
