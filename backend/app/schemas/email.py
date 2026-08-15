from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List


class EmailAccountCreate(BaseModel):
    provider: str = Field(..., max_length=50, description="Provider key: gmail / outlook / qq / 163 / 126 / imap_other")
    email_address: str = Field(..., max_length=200, description="Email address")
    imap_host: Optional[str] = Field(None, max_length=200, description="IMAP server host")
    imap_port: Optional[int] = Field(993, description="IMAP server port")
    imap_use_ssl: Optional[bool] = Field(True, description="Use SSL for IMAP")
    access_token: str = Field(..., max_length=1000, description="IMAP password or app-specific authorization code")
    refresh_token: Optional[str] = Field(None, max_length=1000)


class EmailAccountUpdate(BaseModel):
    provider: Optional[str] = Field(None, max_length=50)
    email_address: Optional[str] = Field(None, max_length=200)
    imap_host: Optional[str] = Field(None, max_length=200)
    imap_port: Optional[int] = Field(None)
    imap_use_ssl: Optional[bool] = Field(None)
    access_token: Optional[str] = Field(None, max_length=1000)
    refresh_token: Optional[str] = Field(None, max_length=1000)
    status: Optional[str] = Field(None, max_length=50)


class EmailAccountResponse(BaseModel):
    id: str
    user_id: str
    provider: str
    email_address: str
    imap_host: Optional[str]
    imap_port: Optional[int]
    imap_use_ssl: Optional[bool]
    sync_status: str
    last_sync_at: Optional[datetime]
    last_error: Optional[str]
    sync_count: int
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailMessageResponse(BaseModel):
    id: str
    user_id: str
    account_id: str
    message_uid: str
    subject: Optional[str]
    sender_name: Optional[str]
    sender_email: Optional[str]
    recipients_to: Optional[str]
    recipients_cc: Optional[str]
    body_text: Optional[str]
    body_html: Optional[str]
    received_at: Optional[datetime]
    is_read: bool
    labels: Optional[str]
    status: str
    knowledge_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailSyncResult(BaseModel):
    success: bool
    synced_count: int
    error: Optional[str] = None


class EmailSaveToKnowledgeRequest(BaseModel):
    tag_ids: Optional[List[str]] = Field(None, description="Optional tag IDs or names to attach")
