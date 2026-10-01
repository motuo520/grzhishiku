"""Quota tracking and enforcement service.

Tracks `User.storage_used` and provides helpers to check plan limits before
content creation. Storage usage is counted in real UTF-8 bytes everywhere:
incremental adds go through `estimate_storage_bytes` (len of utf-8).
"""

from sqlalchemy.orm import Session
from sqlalchemy import func, update

from app.models.base import User


class QuotaService:
    """User quota helper."""

    def __init__(self, db: Session):
        self.db = db

    def estimate_storage_bytes(self, text: str) -> int:
        """Estimate storage size for a text payload."""
        if not text:
            return 0
        # UTF-8 Chinese characters are ~3 bytes; use len as lower bound
        return len(text.encode("utf-8"))

    def check_storage_before_create(self, user_id: str, additional_bytes: int) -> None:
        """Check if adding additional_bytes would exceed the plan storage limit.

        前置体验校验（fail-fast 给出友好提示）；真正的防线在
        record_storage_add 的原子更新，读校验与写之间的并发窗口由它兜底。
        """
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return

        current_used = user.storage_used or 0
        # 开源本地版：限额取 user.storage_limit 列（无套餐概念）
        limit_bytes = self._get_plan_limit(user_id, "storage_bytes")
        if limit_bytes is not None and limit_bytes >= 0 and current_used + additional_bytes >= limit_bytes:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=403,
                detail=f"存储空间不足（已用 {self._human_size(current_used)}，限额 {self._human_size(limit_bytes)}）",
            )

    def record_storage_add(self, user_id: str, additional_bytes: int) -> int:
        """Add storage usage after content creation.

        单条原子 UPDATE 带限额条件，按影响行数判定：并发下超额请求影响 0 行
        直接报超额，不存在读-改-写竞态。限额口径与 check_storage_before_create
        一致（达到限额即拒绝；限额缺失/<=0 视为无限制）。
        """
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return 0

        limit_bytes = self._get_plan_limit(user_id, "storage_bytes")
        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(storage_used=func.coalesce(User.storage_used, 0) + additional_bytes)
        )
        if limit_bytes is not None and limit_bytes >= 0:
            # <0（约定 -1）表示无限制，不加限额条件
            stmt = stmt.where(func.coalesce(User.storage_used, 0) + additional_bytes < limit_bytes)

        result = self.db.execute(stmt.execution_options(synchronize_session="fetch"))
        if result.rowcount == 0:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=403,
                detail=f"存储空间不足（已用 {self._human_size(user.storage_used or 0)}，限额 {self._human_size(limit_bytes)}）",
            )
        self.db.commit()
        return (user.storage_used or 0)

    def _get_plan_limit(self, user_id: str, limit_key: str):
        # 开源本地版：无套餐 limits，唯一限额源是 user.storage_limit 列；<=0 视为无限制
        if limit_key != "storage_bytes":
            return None
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return None
        limit = user.storage_limit
        if limit is None or limit <= 0:
            return None
        return limit

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
