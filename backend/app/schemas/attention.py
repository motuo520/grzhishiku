from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum

class CategoryType(str, Enum):
    WORK = "work"
    STUDY = "study"
    ENTERTAINMENT = "entertainment"
    SOCIAL = "social"
    OTHER = "other"

class Priority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class CompletionStatus(str, Enum):
    COMPLETED = "completed"
    INTERRUPTED = "interrupted"
    ABANDONED = "abandoned"

class ActivitySource(str, Enum):
    MANUAL = "manual"
    BROWSER_EXTENSION = "browser_extension"
    DESKTOP_APP = "desktop_app"
    AI_DETECTED = "ai_detected"

class AttentionCategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Category name")
    icon: Optional[str] = Field(None, max_length=100, description="Icon identifier")
    color: Optional[str] = Field(None, max_length=50, description="Color hex code")
    brain_side: Optional[str] = Field("personal", pattern=r"^(personal|network|both)$", description="Brain side for budget")
    allocated_minutes: int = Field(..., gt=0, le=1440, description="Allocated minutes per day (max 24h)")
    min_required: Optional[int] = Field(None, ge=0, le=1440, description="Minimum required minutes")
    max_allowed: Optional[int] = Field(None, ge=0, le=1440, description="Maximum allowed minutes")
    priority: Priority = Priority.MEDIUM
    auto_rebalance_from: Optional[List[str]] = Field(None, max_length=20, description="Categories to rebalance from (max 20)")
    notify_at: Optional[float] = Field(None, ge=0, le=100, description="Notification threshold %")

class AttentionCategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    icon: Optional[str] = Field(None, max_length=100)
    color: Optional[str] = Field(None, max_length=50)
    brain_side: Optional[str] = Field(None, pattern=r"^(personal|network|both)$")
    allocated_minutes: Optional[int] = Field(None, gt=0, le=1440)
    min_required: Optional[int] = Field(None, ge=0, le=1440)
    max_allowed: Optional[int] = Field(None, ge=0, le=1440)
    priority: Optional[Priority] = None
    auto_rebalance_from: Optional[List[str]] = Field(None, max_length=20)
    notify_at: Optional[float] = Field(None, ge=0, le=100)

class AttentionCategoryResponse(BaseModel):
    id: str
    user_id: str
    name: str
    icon: Optional[str] = None
    color: Optional[str] = None
    brain_side: Optional[str] = None
    allocated_minutes: int
    min_required: Optional[int] = None
    max_allowed: Optional[int] = None
    priority: str
    auto_rebalance_from: Optional[str] = None
    notify_at: Optional[float] = None
    used_minutes: float = 0.0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AttentionActivityCreate(BaseModel):
    category_id: str = Field(..., max_length=100, description="Category ID")
    category: Optional[CategoryType] = CategoryType.OTHER
    brain_side: Optional[str] = Field(None, pattern=r"^(personal|network|both)$", description="Brain side")
    description: Optional[str] = Field(None, max_length=5000, description="Activity description (max 5KB)")
    start_time: datetime
    end_time: Optional[datetime] = None
    actual_duration: Optional[int] = Field(None, ge=0, le=1440, description="Duration in minutes")
    source: ActivitySource = ActivitySource.MANUAL
    metadata_url: Optional[str] = Field(None, max_length=2048, description="Related URL")
    metadata_app: Optional[str] = Field(None, max_length=200, description="App name")
    metadata_title: Optional[str] = Field(None, max_length=500, description="Page/app title")
    completion_status: CompletionStatus = CompletionStatus.COMPLETED
    focus_score: Optional[float] = Field(None, ge=0, le=100)
    focus_duration: Optional[float] = Field(None, ge=0)
    focus_intensity: Optional[float] = Field(None, ge=0, le=10)

class AttentionActivityResponse(BaseModel):
    id: str
    user_id: str
    category_id: str
    category: str
    activity_source: str = "unknown"
    brain_side: Optional[str] = None
    description: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    actual_duration: Optional[int] = None
    source: Optional[str] = None
    metadata_url: Optional[str] = None
    metadata_app: Optional[str] = None
    metadata_title: Optional[str] = None
    completion_status: Optional[str] = None
    focus_score: Optional[float] = None
    focus_duration: Optional[float] = None
    focus_intensity: Optional[float] = None
    focus_recovery: Optional[float] = None
    focus_switching: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True

class DeepWorkConfig(BaseModel):
    task: str = Field(..., min_length=1, max_length=500, description="Task description")
    planned_duration: int = Field(..., gt=0, le=480, description="Planned duration in minutes (max 8h)")
    brain_side: Optional[str] = Field("personal", pattern=r"^(personal|network|both)$", description="Brain side for session")
    rules_block_notifications: bool = True
    rules_blocked_websites: Optional[List[str]] = Field(None, max_length=100, description="Blocked websites (max 100)")
    rules_blocked_apps: Optional[List[str]] = Field(None, max_length=100, description="Blocked apps (max 100)")
    rules_allowed_websites: Optional[List[str]] = Field(None, max_length=100, description="Allowed websites (max 100)")
    rules_ambient_sound: Optional[str] = Field(None, max_length=200, description="Ambient sound preset")

class DeepWorkSessionResponse(BaseModel):
    id: str
    user_id: str
    brain_side: str = "personal"
    task: str
    planned_duration: int
    actual_duration: Optional[int] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    rules_block_notifications: Optional[bool] = None
    focus_score_avg: Optional[float] = None
    interruptions: int = 0
    blocked_attempts: int = 0
    completion_status: Optional[str] = None
    end_reason: Optional[str] = None

    class Config:
        from_attributes = True

class AttentionDashboard(BaseModel):
    total_focus_today: float
    total_interruptions: int
    category_distribution: List[Dict[str, Any]]
    weekly_trend: List[Dict[str, Any]]
    deep_work_sessions_today: int
    average_focus_score: float

class AttentionStats(BaseModel):
    daily: Dict[str, Any]
    weekly: List[Dict[str, Any]]
    categories: List[Dict[str, Any]]

class ScoreBreakdown(BaseModel):
    focus_duration_score: float
    interruption_penalty: float
    deep_work_score: float

class AttentionScore(BaseModel):
    score: float
    breakdown: ScoreBreakdown
    trend: List[Dict[str, Any]]

class AttentionGuardianRuleCreate(BaseModel):
    type: str = Field(..., pattern=r"^(website|app|notification)$")
    target: str = Field(..., min_length=1, max_length=300)
    mode: str = Field("block", pattern=r"^(block|limit)$")
    limit_minutes: Optional[int] = Field(None, ge=1, le=1440)
    active: bool = True
    schedule_days: Optional[List[int]] = Field(None, max_length=7)
    schedule_start: Optional[str] = Field(None, max_length=5)
    schedule_end: Optional[str] = Field(None, max_length=5)

class AttentionGuardianRuleUpdate(BaseModel):
    type: Optional[str] = Field(None, pattern=r"^(website|app|notification)$")
    target: Optional[str] = Field(None, min_length=1, max_length=300)
    mode: Optional[str] = Field(None, pattern=r"^(block|limit)$")
    limit_minutes: Optional[int] = Field(None, ge=1, le=1440)
    active: Optional[bool] = None
    schedule_days: Optional[List[int]] = Field(None, max_length=7)
    schedule_start: Optional[str] = Field(None, max_length=5)
    schedule_end: Optional[str] = Field(None, max_length=5)

class AttentionGuardianRuleResponse(BaseModel):
    id: str
    user_id: str
    type: str
    target: str
    mode: str
    limit_minutes: Optional[int] = None
    active: bool
    schedule_days: Optional[str] = None
    schedule_start: Optional[str] = None
    schedule_end: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AttentionRationCreate(BaseModel):
    source_type: str = Field(..., pattern=r"^(rss|social|email|clip)$")
    source_id: Optional[str] = Field(None, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    daily_limit_minutes: int = Field(..., gt=0, le=1440)
    active: bool = True

class AttentionRationUpdate(BaseModel):
    source_type: Optional[str] = Field(None, pattern=r"^(rss|social|email|clip)$")
    source_id: Optional[str] = Field(None, max_length=100)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    daily_limit_minutes: Optional[int] = Field(None, gt=0, le=1440)
    active: Optional[bool] = None
    used_minutes: Optional[int] = Field(None, ge=0)

class AttentionRationResponse(BaseModel):
    id: str
    user_id: str
    source_type: str
    source_id: Optional[str] = None
    name: str
    daily_limit_minutes: int
    used_minutes: int
    active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AttentionWeeklyReport(BaseModel):
    week_start: str
    week_end: str
    brain_side: str
    total_focus_minutes: float
    total_activities: int
    deep_work_sessions: int
    interruptions: int
    average_focus_score: float
    daily_trend: List[Dict[str, Any]]
    category_distribution: List[Dict[str, Any]]
