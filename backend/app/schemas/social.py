from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class SocialAccountCreate(BaseModel):
    provider: str = Field(..., max_length=50, description="Platform: wechat / dingtalk / feishu")
    account_name: Optional[str] = Field(None, max_length=200, description="Optional account/enterprise name")


class SocialAccountUpdate(BaseModel):
    account_name: Optional[str] = Field(None, max_length=200)
    status: Optional[str] = Field(None, max_length=50)


class SocialAccountResponse(BaseModel):
    id: str
    user_id: str
    provider: str
    account_name: Optional[str]
    connection_type: str
    sync_status: str
    last_sync_at: Optional[datetime]
    last_error: Optional[str]
    sync_count: int
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SocialMessageResponse(BaseModel):
    id: str
    user_id: str
    account_id: str
    platform: str
    conversation_id: Optional[str]
    conversation_name: Optional[str]
    message_uid: str
    sender_name: Optional[str]
    sender_id: Optional[str]
    content_raw: Optional[str]
    content_text: Optional[str]
    message_type: str
    attachments: Optional[str]
    sent_at: Optional[datetime]
    is_me: bool
    status: str
    knowledge_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SocialUploadResult(BaseModel):
    success: bool
    parsed_count: int
    skipped_count: int
    error: Optional[str] = None


class SocialSaveToKnowledgeRequest(BaseModel):
    tag_ids: Optional[List[str]] = Field(None, description="Optional tag IDs or names to attach")
    brain_side: Optional[str] = Field("network", description="Target brain side: personal / network / both")
