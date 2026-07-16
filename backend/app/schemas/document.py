from pydantic import BaseModel, Field
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
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DocumentSaveToKnowledgeRequest(BaseModel):
    tag_ids: Optional[List[str]] = Field(None, description="Optional tag IDs or names to attach")
