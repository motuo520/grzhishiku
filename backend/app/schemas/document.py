from pydantic import BaseModel, Field, field_validator
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from app.schemas.tag import TagItem
from datetime import datetime
from typing import Optional, List


class DocumentResponse(BaseModel):
    id: str
    user_id: str
    title: Optional[str]
    original_name: str
    file_path: str
    file_size: int
    file_type: Optional[str]
    content_text: Optional[str]
    extraction_status: str
    extraction_error: Optional[str]
    doc_status: str
    knowledge_id: Optional[str]
    brain_side: Optional[str]
    folder_id: Optional[str]
    index_only: bool = False  # 仓库模式：只进检索层，不进语义加工层
    tags: List[TagItem] = []  # 自动/人工标签（09-11 文档纳入打标，列表/详情直接展示）
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DocumentUpdateRequest(BaseModel):
    # 手动归档入口（口径B：只手动，不进 evaluate_archive_rules）；
    # folder_id 显式传了才处理，显式 null = 移出文件夹（未归档）
    folder_id: Optional[str] = Field(None, description="目标文件夹 id；显式 null=移出文件夹")
    # 文本类文档在线编辑：title 去空白限 200；content 写的是 content_text 文本层
    # （原始上传文件不动），限长 200000（笔记 content 无限长口径，取本项目约定上限）
    title: Optional[str] = Field(None, max_length=200, description="文档标题（去空白，≤200 字）")
    content: Optional[str] = Field(None, max_length=200000, description="正文文本层 content_text（≤200000 字）")
    index_only: Optional[bool] = Field(None, description="仓库模式：只进检索层（RAG 可答），不进图谱/百科/打标/复盘")

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("标题去空白后不能为空")
        return v


class DocumentSaveToKnowledgeRequest(BaseModel):
    tag_ids: Optional[List[str]] = Field(None, description="Optional tag IDs or names to attach")
