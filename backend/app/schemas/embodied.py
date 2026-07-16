from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class DepthCheckRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000, description="Content to evaluate")
    content_type: str = Field("text", description="note / knowledge_unit / text")
    content_id: Optional[str] = Field(None, description="Optional related content ID")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")
    use_ai: bool = Field(False, description="是否使用付费 AI 深度评估；默认免费规则评估，不消耗余额")


class DepthCheckResponse(BaseModel):
    depth_score: float = Field(..., ge=0, le=1, description="Depth score 0-1")
    is_passed: bool = Field(..., description="Whether content passes depth threshold")
    feedback: str = Field(..., description="AI evaluation feedback")
    suggestions: List[str] = Field(default_factory=list, description="How to improve depth")


class DepthCheckLogResponse(BaseModel):
    id: str
    user_id: str
    content_type: str
    content_id: Optional[str]
    content_preview: Optional[str]
    depth_score: float
    is_passed: bool
    feedback: str
    suggestions: List[str]
    model_used: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class EvolutionReflectionBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    discomfort_level: int = Field(1, ge=1, le=5, description="Discomfort intensity 1-5")
    pain_description: Optional[str] = Field(None, max_length=5000)
    joy_description: Optional[str] = Field(None, max_length=5000)
    learning: Optional[str] = Field(None, max_length=5000)
    is_true_evolution: bool = Field(True)
    related_content_type: Optional[str] = Field(None, pattern=r"^(note|knowledge_unit|experiment_log)$")
    related_content_id: Optional[str] = None
    brain_side: Optional[str] = Field("personal", description="personal / network / both")


class EvolutionReflectionCreate(EvolutionReflectionBase):
    pass


class EvolutionReflectionUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    discomfort_level: Optional[int] = Field(None, ge=1, le=5)
    pain_description: Optional[str] = Field(None, max_length=5000)
    joy_description: Optional[str] = Field(None, max_length=5000)
    learning: Optional[str] = Field(None, max_length=5000)
    is_true_evolution: Optional[bool] = None
    related_content_type: Optional[str] = Field(None, pattern=r"^(note|knowledge_unit|experiment_log)$")
    related_content_id: Optional[str] = None
    brain_side: Optional[str] = None


class EvolutionReflectionResponse(EvolutionReflectionBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EvolutionAnalysisRequest(BaseModel):
    brain_side: Optional[str] = Field("both", description="Filter reflections by brain side")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class EvolutionAnalysisResponse(BaseModel):
    summary: str = Field(..., description="Overall assessment")
    true_evolution_ratio: float = Field(..., ge=0, le=1)
    patterns: List[str] = Field(default_factory=list, description="Observed patterns")
    warnings: List[str] = Field(default_factory=list, description="Pseudo-maturity warnings")
    next_steps: List[str] = Field(default_factory=list, description="Suggested actions")


class MoodLocationItem(BaseModel):
    id: str
    capsule_id: str
    brain_side: str
    sealed_at: Optional[datetime]
    mood_emotion: Optional[str]
    mood_intensity: Optional[float]
    mood_energy_level: Optional[float]
    mood_tags: List[str]
    mood_trigger: Optional[str]
    mood_weather: Optional[str]
    mood_location: Optional[str]
    content_preview: Optional[str]
    created_at: datetime


class MoodLocationStats(BaseModel):
    mood_distribution: dict
    location_distribution: dict
    total: int


class MoodLocationResponse(BaseModel):
    items: List[MoodLocationItem]
    stats: MoodLocationStats
