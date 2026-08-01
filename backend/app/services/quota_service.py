"""Quota tracking service.

Tracks `User.storage_used`. Storage is estimated from content text length
(1 char ≈ 1 byte for UTF-8 content; this is a conservative estimate).
"""

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.base import User, Note, BrowserClip, KnowledgeUnit


class QuotaService:
    """User storage usage helper."""

    def __init__(self, db: Session):
        self.db = db

    def estimate_storage_bytes(self, text: str) -> int:
        """Estimate storage size for a text payload."""
        if not text:
            return 0
        # UTF-8 Chinese characters are ~3 bytes; use len as lower bound
        return len(text.encode("utf-8"))

    def recalculate_storage_used(self, user_id: str) -> int:
        """Recalculate total storage used by a user from all content tables."""
        notes_size = self.db.query(func.coalesce(func.sum(func.length(Note.title) + func.length(Note.content)), 0)).filter(
            Note.user_id == user_id, Note.status == "active"
        ).scalar() or 0

        clips_size = self.db.query(func.coalesce(func.sum(func.length(BrowserClip.title) + func.length(BrowserClip.excerpt) + func.length(BrowserClip.full_text)), 0)).filter(
            BrowserClip.user_id == user_id, BrowserClip.status == "active"
        ).scalar() or 0

        knowledge_size = self.db.query(func.coalesce(func.sum(func.length(KnowledgeUnit.content_raw)), 0)).filter(
            KnowledgeUnit.user_id == user_id, KnowledgeUnit.status == "active"
        ).scalar() or 0

        total = int(notes_size + clips_size + knowledge_size)
        user = self.db.query(User).filter(User.id == user_id).first()
        if user:
            user.storage_used = total
            self.db.commit()
        return total

    def record_storage_add(self, user_id: str, additional_bytes: int) -> int:
        """Add storage usage after content creation."""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return 0
        user.storage_used = (user.storage_used or 0) + additional_bytes
        self.db.commit()
        return user.storage_used

    def record_storage_remove(self, user_id: str, removed_bytes: int) -> int:
        """Subtract storage usage after content deletion."""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return 0
        user.storage_used = max(0, (user.storage_used or 0) - removed_bytes)
        self.db.commit()
        return user.storage_used


def get_quota_service(db: Session) -> QuotaService:
    return QuotaService(db)
