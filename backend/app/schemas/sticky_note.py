from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from datetime import datetime
from typing import Optional, List


class StickyNoteCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000, description="Note content")
    color: Optional[str] = Field("#f59e0b", max_length=50, description="Sticky note color hex")
    position_x: Optional[int] = Field(0, ge=0, description="X position on board")
    position_y: Optional[int] = Field(0, ge=0, description="Y position on board")
    width: Optional[int] = Field(240, ge=100, le=600, description="Width in px")
    height: Optional[int] = Field(180, ge=80, le=400, description="Height in px")
    is_pinned: Optional[bool] = Field(False, description="Pin to top")
    remind_at: Optional[datetime] = Field(None, description="Optional reminder time")


class StickyNoteUpdate(BaseModel):
    content: Optional[str] = Field(None, min_length=1, max_length=2000)
    color: Optional[str] = Field(None, max_length=50)
    position_x: Optional[int] = Field(None, ge=0)
    position_y: Optional[int] = Field(None, ge=0)
    width: Optional[int] = Field(None, ge=100, le=600)
    height: Optional[int] = Field(None, ge=80, le=400)
    is_pinned: Optional[bool] = None
    is_archived: Optional[bool] = None
    remind_at: Optional[datetime] = None


class StickyNoteOut(BaseModel):
    id: str
    user_id: str
    content: str
    color: str
    position_x: int
    position_y: int
    width: int
    height: int
    is_pinned: bool
    is_archived: bool
    remind_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class StickyNoteList(BaseModel):
    total: int
    notes: List[StickyNoteOut]


class ReminderCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Reminder title")
    content: Optional[str] = Field(None, max_length=2000, description="Optional detail")
    remind_at: datetime = Field(..., description="When to remind")
    source: Optional[str] = Field("mascot", max_length=50)


class ReminderUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, max_length=2000)
    remind_at: Optional[datetime] = None
    is_completed: Optional[bool] = None


class ReminderOut(BaseModel):
    id: str
    user_id: str
    title: str
    content: Optional[str]
    remind_at: datetime
    is_completed: bool
    source: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReminderList(BaseModel):
    total: int
    reminders: List[ReminderOut]


class UpcomingReminder(BaseModel):
    id: str
    title: str
    content: Optional[str]
    remind_at: datetime
    source: str
