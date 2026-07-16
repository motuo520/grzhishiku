from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class EmergenceSourceItem(BaseModel):
    id: str
    type: str  # note / capsule / clip / knowledge / rss_entry / email / social / read_later / document / tag
    title: str
    excerpt: Optional[str] = None
    brain_side: str
    created_at: Optional[datetime] = None


class EmergenceSourceList(BaseModel):
    items: List[EmergenceSourceItem]
    total: int


class EmergenceBaseRequest(BaseModel):
    brain_side: Optional[str] = Field(None, description="personal / network / both")
    source_ids: Optional[List[str]] = Field(None, description="Selected source content ids")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class AssociateRequest(EmergenceBaseRequest):
    topic_a: str = Field(..., min_length=1, max_length=500)
    topic_b: str = Field(..., min_length=1, max_length=500)


class CollisionRequest(EmergenceBaseRequest):
    topic: str = Field(..., min_length=1, max_length=500)
    perspectives: Optional[List[str]] = Field(None, max_length=20)


class HybridRequest(EmergenceBaseRequest):
    concept_a: str = Field(..., min_length=1, max_length=500)
    concept_b: str = Field(..., min_length=1, max_length=500)


class CounterfactualRequest(EmergenceBaseRequest):
    premise: str = Field(..., min_length=1, max_length=1000)
    timeline_depth: int = Field(3, ge=1, le=5)


class EmergenceResultItem(BaseModel):
    id: str
    type: str
    brain_side: str
    source_ids: List[str]
    source_types: List[str]
    model_used: Optional[str]
    input: Dict[str, Any]
    output: Dict[str, Any]
    scores: Optional[Dict[str, Any]]
    created_at: datetime


class EmergenceHistoryResponse(BaseModel):
    items: List[EmergenceResultItem]
    total: int
    skip: int
    limit: int


class SaveIdeaRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    summary: Optional[str] = None
    source_result_ids: List[str] = Field(default_factory=list)
    tags: Optional[List[str]] = Field(default_factory=list)
    status: Optional[str] = Field("draft", pattern=r"^(draft|saved|archived)$")


class EmergenceIdeaItem(BaseModel):
    id: str
    title: str
    summary: Optional[str]
    brain_side: str
    source_result_ids: List[str]
    tags: List[str]
    status: str
    target_type: Optional[str]
    target_id: Optional[str]
    created_at: datetime
    updated_at: datetime


class EmergenceIdeaListResponse(BaseModel):
    items: List[EmergenceIdeaItem]
    total: int
    skip: int
    limit: int


class PromoteIdeaRequest(BaseModel):
    target_type: str = Field(..., pattern=r"^(note|capsule|knowledge)$")


class CanvasNode(BaseModel):
    id: str
    type: str = Field(..., pattern=r"^(idea|text|source)$")
    idea_id: Optional[str] = None
    source_id: Optional[str] = None
    label: str
    content: Optional[str] = None
    x: float
    y: float
    width: Optional[float] = 180
    height: Optional[float] = 100
    brain_side: Optional[str] = "both"
    color: Optional[str] = None


class CanvasEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None


class CanvasCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    brain_side: Optional[str] = "both"
    nodes: Optional[List[CanvasNode]] = Field(default_factory=list)
    edges: Optional[List[CanvasEdge]] = Field(default_factory=list)


class CanvasUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    brain_side: Optional[str] = None
    nodes: Optional[List[CanvasNode]] = None
    edges: Optional[List[CanvasEdge]] = None


class CanvasItem(BaseModel):
    id: str
    user_id: str
    title: str
    description: Optional[str]
    brain_side: str
    node_count: int
    edge_count: int
    created_at: datetime
    updated_at: datetime


class CanvasDetail(BaseModel):
    id: str
    user_id: str
    title: str
    description: Optional[str]
    brain_side: str
    nodes: List[CanvasNode]
    edges: List[CanvasEdge]
    created_at: datetime
    updated_at: datetime


class CanvasListResponse(BaseModel):
    items: List[CanvasItem]
    total: int
    skip: int
    limit: int


class CanvasCombineRequest(BaseModel):
    node_ids: List[str] = Field(..., min_length=2)
    title: str = Field(..., min_length=1, max_length=200)
    summary: Optional[str] = None
    tags: Optional[List[str]] = Field(default_factory=list)


class CanvasReportRequest(BaseModel):
    title: Optional[str] = None
    focus_node_ids: Optional[List[str]] = Field(default_factory=list)
    format: Optional[str] = Field("proposal", pattern=r"^(proposal|summary|story|mindmap)$")
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class CanvasReportResponse(BaseModel):
    title: str
    content: str
    model_used: Optional[str]


class CanvasToNoteRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
