from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List

from app.schemas.tag import TagItem

class ClipCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Clip title (1-200 chars)")
    url: str = Field(..., min_length=1, max_length=2048, description="Source URL (max 2048 chars)")
    domain: Optional[str] = Field(None, min_length=1, max_length=500, description="Source domain (auto-extracted if omitted)")
    excerpt: Optional[str] = Field(None, max_length=50000, description="Content excerpt / summary (max 50KB)")
    full_text: Optional[str] = Field(None, max_length=50000, description="Full extracted text (max 50KB)")
    brain_side: str = Field("network", max_length=50, description="Brain side: network (default) or personal")
    tags: Optional[List[str]] = Field(None, description="Tag IDs or names")

class ClipUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    url: Optional[str] = Field(None, min_length=1, max_length=2048)
    domain: Optional[str] = Field(None, min_length=1, max_length=500)
    excerpt: Optional[str] = Field(None, max_length=50000)
    full_text: Optional[str] = Field(None, max_length=50000)
    tags: Optional[List[str]] = Field(None, description="Tag IDs or names")

class ClipResponse(BaseModel):
    id: str = Field(..., description="Clip ID (UUID)")
    user_id: str = Field(..., description="Owner user ID")
    brain_side: str = Field("network", description="Brain side")
    title: str = Field(..., description="Clip title")
    url: str = Field(..., description="Source URL")
    domain: str = Field(..., description="Source domain")
    excerpt: Optional[str] = Field(None, description="Content excerpt")
    full_text: Optional[str] = Field(None, description="Full extracted text")
    tags: List[TagItem] = Field(default_factory=list, description="Associated tags")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")

    class Config:
        from_attributes = True
