from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum

class UnlockType(str, Enum):
    TEMPORAL = "temporal"
    EVENTUAL = "eventual"
    MILESTONE = "milestone"
    CONDITIONAL = "conditional"
    COMPOUND = "compound"

class UnlockStatus(str, Enum):
    LOCKED = "locked"
    UNLOCKED = "unlocked"
    OPENED = "opened"
    REVISITED = "revisited"

class ContentType(str, Enum):
    TEXT = "text"
    VOICE = "voice"
    IMAGE = "image"
    MIXED = "mixed"

class PrivacyLevel(str, Enum):
    PUBLIC = "public"
    SHARED = "shared"
    PRIVATE = "private"

class CapsuleCreate(BaseModel):
    content_type: ContentType = Field(ContentType.TEXT, description="Type of capsule content")
    content_body: str = Field(..., min_length=1, max_length=50000, description="Capsule content body (max 50KB)")
    content_attachments: Optional[List[Dict[str, Any]]] = Field(None, max_length=50, description="Attachments (max 50)")
    brain_side: Optional[str] = Field("personal", pattern=r"^(personal|network|both)$", description="Brain side")
    mood_emotion: Optional[str] = Field(None, max_length=200, description="Emotion label")
    mood_intensity: Optional[float] = Field(None, ge=0, le=10, description="Intensity 0-10")
    mood_energy_level: Optional[float] = Field(None, ge=0, le=10, description="Energy level 0-10")
    mood_tags: Optional[List[str]] = Field(None, max_length=10, description="Mood tags (max 10)")
    mood_trigger: Optional[str] = Field(None, max_length=500, description="Trigger event")
    mood_weather: Optional[str] = Field(None, max_length=100, description="Weather context")
    mood_location: Optional[str] = Field(None, max_length=500, description="Location context")
    unlock_type: UnlockType = Field(..., description="Unlock mechanism type")
    unlock_config: Dict[str, Any] = Field(..., description="Unlock configuration JSON")
    privacy_level: PrivacyLevel = Field(PrivacyLevel.PRIVATE, description="Privacy level")
    privacy_require_auth: bool = Field(False, description="Require auth to access")
    privacy_allow_export: bool = Field(True, description="Allow content export")
    privacy_encryption_level: str = Field("local", max_length=50, description="Encryption level")

class CapsuleResponse(BaseModel):
    id: str
    user_id: str
    brain_side: str = "personal"
    content_type: str
    content_body: str
    content_attachments: Optional[str] = None
    mood_emotion: Optional[str] = None
    mood_intensity: Optional[float] = None
    mood_energy_level: Optional[float] = None
    mood_tags: Optional[str] = None
    sealed_at: Optional[datetime] = None
    sealed_fingerprint: Optional[str] = None
    unlock_type: str
    unlock_config: str
    unlock_status: str
    is_unlocked: bool = False
    privacy_level: str = "private"
    privacy_require_auth: bool
    privacy_allow_export: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class CapsuleDialogueCreate(BaseModel):
    present_context: Optional[Dict[str, Any]] = Field(None, max_length=50, description="Context dictionary (max 50 keys)")
    present_mood: Optional[Dict[str, Any]] = Field(None, max_length=50, description="Mood dictionary (max 50 keys)")
    present_reflection: Optional[str] = Field(None, max_length=50000, description="Reflection text (max 50KB)")
    message: str = Field(..., min_length=1, max_length=10000, description="Message text (max 10KB)")
    preferred_model: Optional[str] = Field(None, max_length=200, description="Preferred LLM model identifier")

class CapsuleDialogueMessage(BaseModel):
    role: str = Field(..., max_length=50)
    content: str = Field(..., max_length=50000)
    timestamp: str = Field(..., max_length=100)
    is_cross_time: bool = False

class CapsuleDialogueResponse(BaseModel):
    id: str
    capsule_id: str
    opened_at: Optional[datetime] = None
    opened_by: str = "user"
    present_context: Optional[str] = None
    present_mood: Optional[str] = None
    present_reflection: Optional[str] = None
    conversation: Optional[str] = None
    messages: Optional[List[CapsuleDialogueMessage]] = None
    insights_pattern: Optional[str] = None
    insights_growth: Optional[str] = None
    insights_warning: Optional[str] = None
    insights_suggestion: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure: Optional[str] = None

    class Config:
        from_attributes = True
