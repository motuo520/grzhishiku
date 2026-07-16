"""Quota tracking and enforcement service.

Tracks `User.storage_used` and provides helpers to check plan limits before
content creation. Storage is estimated from content text length (1 char ≈ 1 byte
for UTF-8 content; this is a conservative estimate).
"""

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.base import User, Note, BrowserClip, KnowledgeUnit
from app.services.billing_service import BillingService


class QuotaService:
    """User quota helper."""

    def __init__(self, db: Session):
        self.db = db
        self.billing = BillingService(db)

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

    def check_storage_before_create(self, user_id: str, additional_bytes: int) -> None:
        """Check if adding additional_bytes would exceed the plan storage limit."""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return

        current_used = user.storage_used or 0
        # Validate against plan limit
        if not self.billing.check_limit(user_id, "storage_bytes", current_used + additional_bytes):
            plan = self.billing.get_plan_by_slug("storage")
            from fastapi import HTTPException
            limit_bytes = self._get_plan_limit(user_id, "storage_bytes")
            raise HTTPException(
                status_code=403,
                detail=f"存储空间不足（已用 {self._human_size(current_used)}，限额 {self._human_size(limit_bytes)}），请升级存储会员",
            )

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

    def _get_plan_limit(self, user_id: str, limit_key: str):
        sub = self.billing.get_user_subscription(user_id)
        plan = self.billing.get_plan(sub.plan_id) if sub else self.billing.get_plan_by_slug("free")
        if not plan or not plan.limits:
            return None
        import json
        limits = json.loads(plan.limits) if isinstance(plan.limits, str) else plan.limits
        return limits.get(limit_key)

    @staticmethod
    def _human_size(size_bytes: int) -> str:
        if size_bytes is None:
            return "无限制"
        if size_bytes < 1024:
            return f"{size_bytes} B"
        if size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        if size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"


def get_quota_service(db: Session) -> QuotaService:
    return QuotaService(db)
