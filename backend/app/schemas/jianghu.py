from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional, List
from enum import Enum


class PracticeType(str, Enum):
    APPLIED = "applied"
    TAUGHT = "taught"
    ITERATED = "iterated"
    FAILED = "failed"
    OBSERVED = "observed"


class PracticeRecordCreate(BaseModel):
    target_type: str = Field(..., pattern=r"^(note|knowledge_unit)$", description="Target content type")
    target_id: str = Field(..., description="Target note or knowledge unit ID")
    practice_type: PracticeType = Field(..., description="Type of practice")
    description: str = Field(..., min_length=1, max_length=5000, description="What was done")
    result: Optional[str] = Field(None, max_length=5000, description="Outcome")
    learned_lesson: Optional[str] = Field(None, max_length=5000, description="Key lesson learned")
    context_snapshot: Optional[str] = Field(None, max_length=5000, description="Context snapshot as JSON string")


class PracticeRecordResponse(BaseModel):
    id: str = Field(..., description="Practice record ID")
    user_id: str = Field(..., description="Owner user ID")
    target_type: str = Field(..., description="Target content type")
    target_id: str = Field(..., description="Target ID")
    practice_type: str = Field(..., description="Type of practice")
    description: str = Field(..., description="What was done")
    result: Optional[str] = Field(None, description="Outcome")
    learned_lesson: Optional[str] = Field(None, description="Key lesson learned")
    context_snapshot: Optional[str] = Field(None, description="Context snapshot")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True


class DailyReviewGenerateRequest(BaseModel):
    review_date: Optional[date] = Field(None, description="Date to review, defaults to today")
    include_attention: bool = Field(True, description="Include attention data")
    include_notes: bool = Field(True, description="Include notes created today")
    include_knowledge: bool = Field(True, description="Include knowledge operations today")
    brain_side: Optional[str] = Field("both", description="Filter by brain side: personal / network / both")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class DailyReviewResponse(BaseModel):
    id: str = Field(..., description="Daily review ID")
    user_id: str = Field(..., description="Owner user ID")
    review_date: date = Field(..., description="Review date")
    content_summary: Optional[str] = Field(None, description="Summary of today's content")
    ai_reflection: Optional[str] = Field(None, description="AI reflection")
    gaps_found: List[str] = Field(default_factory=list, description="Gaps between intent and behavior")
    action_items: List[str] = Field(default_factory=list, description="Actionable improvements")
    praise_items: List[str] = Field(default_factory=list, description="Things done well")
    status: str = Field("pending", description="Status: pending / generated / reviewed / archived")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True


class DailyReviewUpdate(BaseModel):
    status: Optional[str] = Field(None, description="Status: pending / generated / reviewed / archived")
    content_summary: Optional[str] = None
    ai_reflection: Optional[str] = None
    gaps_found: Optional[List[str]] = None
    action_items: Optional[List[str]] = None
    praise_items: Optional[List[str]] = None


class RelevanceCheckRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000, description="External knowledge content")
    content_type: Optional[str] = Field("book_excerpt", description="Type of external content")
    user_context_summary: Optional[str] = Field(None, max_length=2000, description="User context summary")
    brain_side: Optional[str] = Field("both", description="Filter context by brain side: personal / network / both")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class RelevanceCheckResponse(BaseModel):
    personal_relevance_score: float = Field(..., ge=0, le=1, description="Relevance score 0-1")
    reason: str = Field(..., description="Reasoning")
    connection_evidence: Optional[str] = Field(None, description="Evidence of connection to user interests")
    first_action: Optional[str] = Field(None, description="Suggested first practical action")
    suggested_action: str = Field(..., description="Recommendation: import / import_with_practice / read_later / ignore")


class EvolutionDistribution(BaseModel):
    collected: int = Field(0)
    understood: int = Field(0)
    practiced: int = Field(0)
    validated: int = Field(0)
    internalized: int = Field(0)


class KnowledgeHealthResponse(BaseModel):
    total_items: int = Field(0, description="Total note + knowledge unit count")
    evolution_distribution: EvolutionDistribution = Field(default_factory=EvolutionDistribution)
    avg_practice_depth: float = Field(0.0)
    avg_invoke_count: float = Field(0.0)
    high_value_items: int = Field(0, description="Items with practice_depth >= 3 and invoke_count >= 5")
    zombie_items: int = Field(0, description="Items with invoke_count == 0 and age > 30 days")
    daily_active_rate: float = Field(0.0, description="Ratio of items invoked today")
    value_score_total: float = Field(0.0, description="Sum of value scores")
    health_score: float = Field(0.0, description="Composite health score 0-100: 0.5*active + 0.3*practiced + 0.2*high_value ratios")


class ContextGuideScope(str, Enum):
    PERSONAL = "personal"
    NETWORK = "network"
    BOTH = "both"


class ContextGuideBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Guide title")
    content: str = Field(..., min_length=1, max_length=50000, description="Markdown guide content")
    scope: ContextGuideScope = Field(ContextGuideScope.BOTH, description="Applicable brain side")
    is_active: bool = Field(True, description="Whether this guide is active")
    version_tag: Optional[str] = Field(None, max_length=50, description="Optional version tag")


class ContextGuideCreate(ContextGuideBase):
    pass


class ContextGuideUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=1, max_length=50000)
    scope: Optional[ContextGuideScope] = None
    is_active: Optional[bool] = None
    version_tag: Optional[str] = Field(None, max_length=50)


class ContextGuideResponse(ContextGuideBase):
    id: str = Field(..., description="Guide ID")
    user_id: str = Field(..., description="Owner user ID")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True


class ContextGuideGenerateRequest(BaseModel):
    brain_side: Optional[str] = Field("both", description="Filter content by brain side: personal / network / both")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")
    title: Optional[str] = Field(None, max_length=200, description="Optional title for generated guide")


class CognitivePotentialItem(BaseModel):
    content_id: str = Field(..., description="Source note or knowledge unit ID")
    content_type: str = Field(..., description="note / knowledge_unit")
    title: str = Field(..., description="Short title of the content")
    score: float = Field(..., ge=0, le=1, description="Potential score 0-1")
    reason: str = Field(..., description="Why this content has this kind of potential")
    suggested_action: str = Field(..., description="Concrete next step")


class CognitivePotentialResponse(BaseModel):
    summary: str = Field(..., description="Overall assessment")
    sinkable: List[CognitivePotentialItem] = Field(default_factory=list, description="Items that can be internalized into habits")
    outputable: List[CognitivePotentialItem] = Field(default_factory=list, description="Items that can be turned into articles, courses, shares")
    monetizable: List[CognitivePotentialItem] = Field(default_factory=list, description="Items with market value")


class CognitivePotentialRequest(BaseModel):
    brain_side: Optional[str] = Field("both", description="Filter content by brain side: personal / network / both")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class ExperimentStatus(str, Enum):
    PLANNED = "planned"
    RUNNING = "running"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class ExperimentLogBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Experiment title")
    hypothesis: str = Field(..., min_length=1, max_length=5000, description="What you assume")
    controlled_variable: Optional[str] = Field(None, max_length=2000, description="The single variable being tested")
    expected_result: Optional[str] = Field(None, max_length=2000, description="Expected outcome")
    actual_result: Optional[str] = Field(None, max_length=5000, description="Actual observed outcome")
    conclusion: Optional[str] = Field(None, max_length=5000, description="Conclusion or learning")
    status: ExperimentStatus = Field(ExperimentStatus.PLANNED, description="Experiment status")
    related_content_type: Optional[str] = Field(None, pattern=r"^(note|knowledge_unit)$", description="Linked content type")
    related_content_id: Optional[str] = Field(None, description="Linked content ID")
    brain_side: Optional[str] = Field("both", description="Brain side context")


class ExperimentLogCreate(ExperimentLogBase):
    pass


class ExperimentLogUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    hypothesis: Optional[str] = Field(None, min_length=1, max_length=5000)
    controlled_variable: Optional[str] = Field(None, max_length=2000)
    expected_result: Optional[str] = Field(None, max_length=2000)
    actual_result: Optional[str] = Field(None, max_length=5000)
    conclusion: Optional[str] = Field(None, max_length=5000)
    status: Optional[ExperimentStatus] = None
    related_content_type: Optional[str] = Field(None, pattern=r"^(note|knowledge_unit)$")
    related_content_id: Optional[str] = None
    brain_side: Optional[str] = None


class ExperimentLogResponse(ExperimentLogBase):
    id: str = Field(..., description="Experiment log ID")
    user_id: str = Field(..., description="Owner user ID")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True
