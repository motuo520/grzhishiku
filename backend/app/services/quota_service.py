"""Quota tracking service.

Tracks `User.storage_used`. Storage is estimated from content text length
(1 char ≈ 1 byte for UTF-8 content; this is a conservative estimate).
"""

from sqlalchemy.orm import Session

from app.models.base import User


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

    def record_storage_add(self, user_id: str, additional_bytes: int) -> int:
        """Add storage usage after content creation."""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return 0
        user.storage_used = (user.storage_used or 0) + additional_bytes
        self.db.commit()
        return user.storage_used
