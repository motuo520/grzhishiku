from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Dict

class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Tag name (1-100 chars)")
    color: str = Field("#8b949e", max_length=50, description="Color hex code")
    description: Optional[str] = Field(None, max_length=500, description="Tag description (max 500 chars)")

class TagUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="Tag name (1-100 chars)")
    color: Optional[str] = Field(None, max_length=50, description="Color hex code")
    description: Optional[str] = Field(None, max_length=500, description="Tag description (max 500 chars)")

class TagResponse(BaseModel):
    id: str
    user_id: str
    name: str
    color: str = "#8b949e"
    description: Optional[str] = None
    usage_count: int = 0
    usage_breakdown: Dict[str, int] = Field(default_factory=dict, description="Usage count by content type")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TagItem(BaseModel):
    id: str
    name: str = Field(..., max_length=100)
    color: str = Field("#8b949e", max_length=50)

class TagMergeRequest(BaseModel):
    target_tag_id: str = Field(..., description="ID of the tag to merge into")

class TagAssociationItem(BaseModel):
    id: str
    title: str
    type: str
    url: Optional[str] = None

class TagAssociationsResponse(BaseModel):
    tag_id: str
    note: List[TagAssociationItem] = []
    clip: List[TagAssociationItem] = []
    knowledge: List[TagAssociationItem] = []
