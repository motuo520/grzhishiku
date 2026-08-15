from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List


class ChatConversationCreate(BaseModel):
    title: Optional[str] = Field("", max_length=200, description="Conversation title (auto-filled from first message if empty)")


class ChatConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="New conversation title")


class ChatConversationOut(BaseModel):
    id: str
    title: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class ChatConversationListItem(ChatConversationOut):
    message_count: int = 0


class ChatConversationList(BaseModel):
    total: int
    conversations: List[ChatConversationListItem]


class ChatMessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    refs: Optional[str] = None
    model: Optional[str] = None
    created_at: Optional[datetime]


class ChatConversationDetail(ChatConversationOut):
    messages: List[ChatMessageOut]
