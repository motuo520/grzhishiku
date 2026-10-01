from pydantic import Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from typing import Optional, List


class ManualEdgeCreate(BaseModel):
    source_id: str = Field(..., min_length=1, description="Source content id (note/capsule/clip/knowledge)")
    target_id: str = Field(..., min_length=1, description="Target content id (note/capsule/clip/knowledge)")
    context: Optional[str] = Field(None, max_length=500, description="Optional note about why the two are linked")


class LinkedNodeInfo(BaseModel):
    id: str
    title: str
    type: str
    brain_side: str


class ManualEdgeOut(BaseModel):
    id: str
    source_id: str
    target_id: str
    edge_type: str
    weight: float
    context: Optional[str] = None
    # created=false：已存在同对边（任意方向/类型），幂等返回既有边
    created: bool
    peer: Optional[LinkedNodeInfo] = None


class ManualEdgeListItem(BaseModel):
    id: str
    source_id: str
    target_id: str
    context: Optional[str] = None
    weight: float
    peer: Optional[LinkedNodeInfo] = None


class ManualEdgeListResponse(BaseModel):
    edges: List[ManualEdgeListItem]
    total: int


class LinkSuggestionCandidate(BaseModel):
    content_id: str
    title: str
    type: str
    similarity: float


class LinkSuggestionsResponse(BaseModel):
    candidates: List[LinkSuggestionCandidate]
    pairing: str  # graphify / embedding / recent
