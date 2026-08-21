from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum

from app.schemas.tag import TagItem

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

class PipelineStage(str, Enum):
    RAW = "raw"
    CARD = "card"
    EXTRACTED = "extracted"
    COLLIDED = "collided"
    APPROVED = "approved"

class ContentSubtype(str, Enum):
    NOTE = "note"
    CONCEPT = "concept"
    COLLISION_RESULT = "collision_result"

class KnowledgeUnitCreate(BaseModel):
    content_raw: str = Field(..., min_length=1, max_length=50000, description="Raw content")
    brain_side: Optional[str] = Field("network", pattern=r"^(personal|network|both)$", description="Brain side")
    content_type: Optional[str] = Field(None, max_length=100, description="Content type")
    source_url: Optional[str] = Field(None, max_length=2048, description="Source URL")
    source_title: Optional[str] = Field(None, max_length=500, description="Source title")
    source_type: Optional[str] = Field(None, max_length=100, description="Source type")
    source_author: Optional[str] = Field(None, max_length=200, description="Source author")
    source_publish_date: Optional[datetime] = None
    source_credibility_score: Optional[float] = Field(None, ge=0, le=100)
    source_bias_indicator: Optional[str] = Field(None, max_length=500, description="Bias indicator")
    source_funding_source: Optional[str] = Field(None, max_length=500, description="Funding source")
    tags: Optional[List[str]] = Field(None, description="Tag IDs or names")
    origin_type: Optional[OriginType] = Field(OriginType.BOOK_EXCERPT, description="Origin type")
    practice_depth: Optional[int] = Field(0, ge=0, le=5, description="Practice depth 0-5")
    personal_relevance_score: Optional[float] = Field(0.3, ge=0, le=1, description="Personal relevance 0-1")
    evolution_stage: Optional[EvolutionStage] = Field(EvolutionStage.COLLECTED, description="Evolution stage")
    pipeline_stage: Optional[PipelineStage] = Field(PipelineStage.RAW, description="Pipeline stage")
    content_subtype: Optional[ContentSubtype] = Field(ContentSubtype.NOTE, description="Content subtype")
    source_id: Optional[str] = Field(None, description="Source content ID")
    source_content_type: Optional[str] = Field(None, description="Source content type")

class KnowledgeUnitUpdate(BaseModel):
    content_raw: Optional[str] = Field(None, min_length=1, max_length=50000)
    content_processed: Optional[str] = Field(None, max_length=50000, description="Personal annotation / processed interpretation")
    brain_side: Optional[str] = Field(None, pattern=r"^(personal|network|both)$")
    content_type: Optional[str] = Field(None, max_length=100)
    source_url: Optional[str] = Field(None, max_length=2048)
    source_title: Optional[str] = Field(None, max_length=500)
    source_type: Optional[str] = Field(None, max_length=100)
    source_author: Optional[str] = Field(None, max_length=200)
    source_publish_date: Optional[datetime] = None
    source_credibility_score: Optional[float] = Field(None, ge=0, le=100)
    source_bias_indicator: Optional[str] = Field(None, max_length=500)
    source_funding_source: Optional[str] = Field(None, max_length=500)
    tags: Optional[List[str]] = Field(None, description="Tag IDs or names")
    origin_type: Optional[OriginType] = Field(None, description="Origin type")
    practice_depth: Optional[int] = Field(None, ge=0, le=5, description="Practice depth 0-5")
    personal_relevance_score: Optional[float] = Field(None, ge=0, le=1, description="Personal relevance 0-1")
    evolution_stage: Optional[EvolutionStage] = Field(None, description="Evolution stage")
    pipeline_stage: Optional[PipelineStage] = Field(None, description="Pipeline stage")
    content_subtype: Optional[ContentSubtype] = Field(None, description="Content subtype")
    source_id: Optional[str] = Field(None, description="Source content ID")
    source_content_type: Optional[str] = Field(None, description="Source content type")
    verification_status: Optional[str] = Field(
        None,
        pattern=r"^(unverified|checking|confirmed|disputed|debunked|outdated)$",
        description="已废弃：核验状态不可直写（端点返回 400）。保留观察/驳回反证走 POST /knowledge/{id}/dispute-resolution，重验走 POST /knowledge/{id}/verify",
    )
    folder_id: Optional[str] = Field(None, description="所属文件夹 id；显式传 null 表示移出文件夹（未归档）")

class KnowledgeUnitResponse(BaseModel):
    id: str = Field(..., description="Knowledge unit ID (UUID)")
    user_id: str = Field(..., description="Owner user ID")
    brain_side: str = Field("network", description="Brain side: network")
    content_raw: str = Field(..., description="Raw content")
    content_processed: Optional[str] = Field(None, description="Processed / normalized content")
    content_type: Optional[str] = Field(None, description="Content type")
    content_confidence: Optional[float] = Field(None, description="LLM confidence score 0-1")
    source_url: Optional[str] = Field(None, description="Source URL")
    source_title: Optional[str] = Field(None, description="Source title")
    source_type: Optional[str] = Field(None, description="Source type")
    source_author: Optional[str] = Field(None, description="Source author")
    source_publish_date: Optional[datetime] = Field(None, description="Source publish date")
    source_credibility_score: Optional[float] = Field(None, description="Source credibility score")
    source_bias_indicator: Optional[str] = Field(None, description="Bias indicator")
    source_funding_source: Optional[str] = Field(None, description="Funding source")
    verification_status: str = Field(..., description="Verification status: unverified / checking / confirmed / disputed / debunked / outdated")
    verification_consensus: Optional[float] = Field(None, description="Consensus score 0-100")
    verification_history: Optional[str] = Field(None, description="JSON string of verification history")
    dispute_resolution: Optional[str] = Field(None, description="争议决议：corrected / kept / rejected，null=未决议")
    latest_evidence: Optional[Dict[str, Any]] = Field(None, description="最近一条反证 {evidence_text, evidence_url, created_at}，无反证为 null")
    last_verified: Optional[datetime] = Field(None, description="Last verification timestamp")
    next_scheduled: Optional[datetime] = Field(None, description="Next scheduled verification")
    timeliness_status: Optional[str] = Field(None, description="Timeliness status: fresh / stable / aging / outdated / superseded")
    trust_level: str = Field(..., description="Trust level: trusted / tentative / suspicious / rejected")
    first_seen: datetime = Field(..., description="First seen timestamp")
    last_reviewed: Optional[datetime] = Field(None, description="Last review timestamp")
    review_count: int = Field(0, description="Number of reviews")
    origin_type: str = Field("book_excerpt", description="Origin type")
    invoke_count: int = Field(0, description="How many times this unit has been invoked")
    last_invoked_at: Optional[datetime] = Field(None, description="Last invocation timestamp")
    practice_depth: int = Field(0, ge=0, le=5, description="Practice depth 0-5")
    personal_relevance_score: float = Field(0.3, ge=0, le=1, description="Personal relevance 0-1")
    evolution_stage: str = Field("collected", description="Evolution stage")
    attached_practice_ids: List[str] = Field(default_factory=list, description="Associated practice record IDs")
    value_score: Optional[float] = Field(None, description="Calculated value score = density * log1p(invoke_count) * (1 + practice_depth)")
    pipeline_stage: str = Field("raw", description="Pipeline stage: raw / card / extracted / collided / approved")
    content_subtype: str = Field("note", description="Content subtype: note / concept / collision_result")
    source_id: Optional[str] = Field(None, description="Source content ID")
    source_content_type: Optional[str] = Field(None, description="Source content type")
    collision_parents: Optional[List[dict]] = Field(None, description="碰撞产物的双亲出处 [{id,title}]（仅 collision_result）")
    folder_id: Optional[str] = Field(None, description="所属文件夹 id，空=未归档")
    tags: List[TagItem] = Field(default_factory=list, description="Associated tags")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True

class VerificationResult(BaseModel):
    model_name: str = Field(..., max_length=200, description="Model name used for verification")
    confidence: float = Field(..., description="Confidence score 0-1")
    result: str = Field(..., max_length=200, description="Result: confirmed / disputed / debunked")
    reasoning: Optional[str] = Field(None, max_length=5000, description="Reasoning text")

class CounterEvidenceCreate(BaseModel):
    evidence_url: Optional[str] = Field(None, max_length=2048, description="URL supporting counter-evidence")
    evidence_text: str = Field(..., min_length=1, max_length=50000, description="Counter-evidence text")
    source_authority: Optional[str] = Field(None, max_length=500, description="Authority of the source")

class DisputeResolutionCreate(BaseModel):
    resolution: str = Field(
        ...,
        pattern=r"^(kept|rejected|revoked)$",
        description="kept=保留观察（维持 disputed 不变）；rejected=驳回反证（恢复反证前状态）；revoked=人工撤销可信（confirmed → unverified，可信回顾的「移出」动作）。corrected 由修正重验路径自动打",
    )

class SourceInfoResponse(BaseModel):
    source_url: Optional[str] = Field(None, description="Source URL")
    source_title: Optional[str] = Field(None, description="Source title")
    source_author: Optional[str] = Field(None, description="Source author")
    source_publish_date: Optional[datetime] = Field(None, description="Publish date")
    source_credibility_score: Optional[float] = Field(None, description="Credibility score")
    source_bias_indicator: Optional[str] = Field(None, description="Bias indicator")
    source_funding_source: Optional[str] = Field(None, description="Funding source")
    domain_credibility_score: Optional[float] = Field(None, description="Domain credibility score 0-1")
    domain_reputation: Optional[str] = Field(None, description="Domain reputation: high / medium / low / unknown")

class DomainCredibilityResponse(BaseModel):
    domain: str = Field(..., max_length=500, description="Domain name")
    credibility_score: float = Field(..., description="Credibility score 0-1")
    reputation: str = Field(..., max_length=50, description="Reputation label")
    factors: List[str] = Field(..., max_length=50, description="Reputation factors")
