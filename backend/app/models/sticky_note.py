"""Sticky notes and reminders models."""

from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base


class StickyNote(Base):
    """A lightweight sticky note (post-it) for quick memo capture."""

    __tablename__ = "sticky_notes"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)
    color = Column(String, default="#f59e0b")
    position_x = Column(Integer, default=0)
    position_y = Column(Integer, default=0)
    width = Column(Integer, default=240)
    height = Column(Integer, default=180)
    is_pinned = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    remind_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_sticky_notes_user_archived', 'user_id', 'is_archived'),
    )


class Reminder(Base):
    """A timed reminder attached to the mascot or created globally."""

    __tablename__ = "reminders"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=True)
    remind_at = Column(DateTime, nullable=False)
    is_completed = Column(Boolean, default=False)
    source = Column(String, default="mascot")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_reminders_user_due', 'user_id', 'remind_at'),
    )
