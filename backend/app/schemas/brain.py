from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from typing import Optional, List, Dict, Any
from enum import Enum

class BrainSide(str, Enum):
    PERSONAL = "personal"
    NETWORK = "network"
    BOTH = "both"
    UNKNOWN = "unknown"

class BrainStatus(BaseModel):
    active_brain: BrainSide
    personal_count: int
    network_count: int
    both_count: int
    total_items: int

class BrainSwitchRequest(BaseModel):
    target_brain: BrainSide

class FusionSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000, description="Search query (max 1000 chars)")
    brain_side: Optional[BrainSide] = None
    brain_sides: Optional[List[BrainSide]] = Field(None, max_length=10, description="Brain sides to search (max 10)")
    limit: int = Field(20, ge=1, le=100, description="Results limit")
    offset: int = Field(0, ge=0, description="Results offset")

class FusionSearchResult(BaseModel):
    id: str
    type: str = Field(..., max_length=50)
    title: str = Field(..., max_length=500)
    brain_side: BrainSide
    content: str = Field(..., max_length=10000)
    relevance_score: float
    source_url: Optional[str] = Field(None, max_length=2048)
    created_at: str

class FusionSearchResponse(BaseModel):
    results: List[FusionSearchResult]
    total: int
    query: str
    brain_sides: List[BrainSide]

class CrossLinkCreate(BaseModel):
    source_id: str = Field(..., max_length=100)
    source_type: str = Field(..., max_length=50)
    target_id: str = Field(..., max_length=100)
    target_type: str = Field(..., max_length=50)
    link_type: str = Field("references", max_length=50)
    strength: Optional[float] = Field(None, ge=0, le=1)
    context: Optional[str] = Field(None, max_length=5000)

class CrossLinkResponse(BaseModel):
    id: str
    source_id: str
    source_type: str
    source_brain_side: BrainSide
    target_id: str
    target_type: str
    target_brain_side: BrainSide
    link_type: str
    strength: Optional[float] = None
    cross_brain: bool
    created_at: str

class CrossBrainGraph(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    cross_brain_edges: int
    total_nodes: int
    total_edges: int

class BrainStats(BaseModel):
    notes: Optional[int] = None
    capsules: Optional[int] = None
    tags: Optional[int] = None
    total_chars: Optional[int] = None
    clips: Optional[int] = None
    knowledge: Optional[int] = None
    domains: Optional[int] = None
    verified: Optional[int] = None
    cross_brain_links: Optional[int] = None
    fusion_ratio: Optional[float] = None
    collaboration_count: Optional[int] = None

