from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List

from app.schemas.tag import TagItem

class ClipCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Clip title (1-200 chars)")
    url: str = Field(..., min_length=1, max_length=2048, description="Source URL (max 2048 chars)")
    domain: Optional[str] = Field(None, min_length=1, max_length=500, description="Source domain (auto-extracted if omitted)")
    # 09-11 拆 5 万字墙：数据库是 Text 列无墙，schema 层的 50000 上限会把长文档
    # 全文静默挡在 422 外（解析差+截断差根因之一），直接去掉
    excerpt: Optional[str] = Field(None, description="Content excerpt / summary")
    full_text: Optional[str] = Field(None, description="Full extracted text (no length cap)")
    brain_side: str = Field("network", max_length=50, description="Brain side: network (default) or personal")
    tags: Optional[List[str]] = Field(None, description="Tag IDs or names")
    index_only: Optional[bool] = Field(False, description="仓库模式：只进检索层（RAG 可答），不进图谱/百科/打标/复盘")

class ClipUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    url: Optional[str] = Field(None, min_length=1, max_length=2048)
    domain: Optional[str] = Field(None, min_length=1, max_length=500)
    excerpt: Optional[str] = Field(None)
    full_text: Optional[str] = Field(None)
    tags: Optional[List[str]] = Field(None, description="Tag IDs or names")
    folder_id: Optional[str] = Field(None, description="归档到文件夹；显式 null=移出（未归档）")
    index_only: Optional[bool] = Field(None, description="仓库模式开关：true=只进检索层，false/null=不改变")

class ClipResponse(BaseModel):
    id: str = Field(..., description="Clip ID (UUID)")
    user_id: str = Field(..., description="Owner user ID")
    brain_side: str = Field("network", description="Brain side")
    title: str = Field(..., description="Clip title")
    url: str = Field(..., description="Source URL")
    domain: str = Field(..., description="Source domain")
    excerpt: Optional[str] = Field(None, description="Content excerpt")
    full_text: Optional[str] = Field(None, description="Full extracted text")
    folder_id: Optional[str] = Field(None, description="所属文件夹；空=未归档")
    index_only: bool = Field(False, description="仓库模式：只进检索层，不进语义加工层")
    tags: List[TagItem] = Field(default_factory=list, description="Associated tags")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")

    class Config:
        from_attributes = True
