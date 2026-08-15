from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List
from enum import Enum

class OriginType(str, Enum):
    SELF_PRACTICE = "self_practice"
    BOOK_EXCERPT = "book_excerpt"
    HEARD_FROM = "heard_from"
    LLM_GENERATED = "llm_generated"
    REFLECTION = "reflection"

class EvolutionStage(str, Enum):
    COLLECTED = "collected"
    UNDERSTOOD = "understood"
    PRACTICED = "practiced"
    VALIDATED = "validated"
    INTERNALIZED = "internalized"

class TagItem(BaseModel):
    id: str = Field(..., description="Tag ID (UUID)")
    name: str = Field(..., max_length=100, description="Tag name")
    color: str = Field("#8b949e", max_length=50, description="Tag color hex code")

class PipelineStage(str, Enum):
    RAW = "raw"
    CARD = "card"
    EXTRACTED = "extracted"
    COLLIDED = "collided"
    APPROVED = "approved"

class NoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Note title (1-200 chars)")
    content: str = Field(..., min_length=1, max_length=50000, description="Note content (Markdown supported, max 50KB)")
    brain_side: str = Field("personal", max_length=50, description="Brain side: personal / network")
    tags: Optional[List[str]] = Field(None, max_length=50, description="List of tag names or IDs to associate (max 50)")
    origin_type: Optional[OriginType] = Field(OriginType.SELF_PRACTICE, description="Origin type")
    practice_depth: Optional[int] = Field(0, ge=0, le=5, description="Practice depth 0-5")
    personal_relevance_score: Optional[float] = Field(0.5, ge=0, le=1, description="Personal relevance 0-1")
    evolution_stage: Optional[EvolutionStage] = Field(EvolutionStage.COLLECTED, description="Evolution stage")
    pipeline_stage: Optional[PipelineStage] = Field(PipelineStage.RAW, description="Pipeline stage")

class NoteUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200, description="Updated title")
    content: Optional[str] = Field(None, min_length=1, max_length=50000, description="Updated content (max 50KB)")
    brain_side: Optional[str] = Field(None, max_length=50, description="Updated brain side")
    tags: Optional[List[str]] = Field(None, max_length=50, description="Updated tag list (replaces existing, max 50)")
    origin_type: Optional[OriginType] = Field(None, description="Origin type")
    practice_depth: Optional[int] = Field(None, ge=0, le=5, description="Practice depth 0-5")
    personal_relevance_score: Optional[float] = Field(None, ge=0, le=1, description="Personal relevance 0-1")
    evolution_stage: Optional[EvolutionStage] = Field(None, description="Evolution stage")
    pipeline_stage: Optional[PipelineStage] = Field(None, description="Pipeline stage")

class NoteResponse(BaseModel):
    id: str = Field(..., description="Note ID (UUID)")
    user_id: str = Field(..., description="Owner user ID")
    brain_side: str = Field("personal", description="Brain side")
    title: str = Field(..., description="Note title")
    content: str = Field(..., description="Note content")
    content_format: str = Field("markdown", description="Content format: markdown / html / plain")
    tags: List[TagItem] = Field([], description="Associated tags")
    origin_type: str = Field("self_practice", description="Origin type")
    invoke_count: int = Field(0, description="How many times this note has been invoked")
    last_invoked_at: Optional[datetime] = Field(None, description="Last invocation timestamp")
    practice_depth: int = Field(0, ge=0, le=5, description="Practice depth 0-5")
    personal_relevance_score: float = Field(0.5, ge=0, le=1, description="Personal relevance 0-1")
    evolution_stage: str = Field("collected", description="Evolution stage")
    attached_practice_ids: List[str] = Field(default_factory=list, description="Associated practice record IDs")
    pipeline_stage: str = Field("raw", description="Pipeline stage: raw / card / extracted / collided / approved")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
