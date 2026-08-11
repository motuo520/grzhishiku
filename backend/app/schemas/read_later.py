from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class ReadLaterCreate(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    title: Optional[str] = Field(None, max_length=500)
    excerpt: Optional[str] = Field(None, max_length=2000)
    source: Optional[str] = Field("manual", max_length=50)


class ReadLaterUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    excerpt: Optional[str] = Field(None, max_length=2000)
    status: Optional[str] = Field(None, pattern="^(unread|reading|read|archived)$")
    is_favorite: Optional[bool] = None
    read_progress: Optional[int] = Field(None, ge=0, le=100)


class ReadLaterResponse(BaseModel):
    id: str
    user_id: str
    title: Optional[str]
    url: str
    domain: Optional[str]
    excerpt: Optional[str]
    full_text: Optional[str]
    cover_image: Optional[str]
    status: str
    is_favorite: bool
    read_progress: int
    source: str
    item_status: str
    knowledge_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReadLaterSaveToKnowledgeRequest(BaseModel):
    tag_ids: Optional[List[str]] = Field(None, description="Optional tag IDs or names to attach")
