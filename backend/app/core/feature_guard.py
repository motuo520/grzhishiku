"""Feature and quota guards for subscription-aware endpoints.

These dependencies can be injected into FastAPI routes to enforce plan-based
feature access and usage limits.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config_loader import get_system_config
from app.models.base import User
from app.services.billing_service import BillingService


class FeatureGuard:
    """Enforce feature flags and plan limits."""

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.billing = BillingService(db)

    def require_feature(self, feature_key: str, sys_config=None):
        """Check global feature flag first, then plan feature access."""
        if sys_config is None:
            sys_config = get_system_config(self.db)

        # Global kill switch takes precedence
        if feature_key in ("ai_summary", "web_clipper", "public_sharing"):
            if not sys_config.is_feature_enabled(feature_key, default=True):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"功能「{feature_key}」已被管理员关闭",
                )

        # Plan-level feature access
        if not self.billing.check_feature_access(self.user.id, feature_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"当前订阅不支持功能「{feature_key}」，请升级会员",
            )

    def check_limit(self, limit_key: str, current_value: int):
        """Check whether current usage is within plan limit."""
        if not self.billing.check_limit(self.user.id, limit_key, current_value):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"已超出「{limit_key}」额度限制，请升级会员",
            )

    def require_storage_feature(self):
        """Shortcut for cloud backup / storage features."""
        return self.require_feature("cloud_backup")


def require_feature(feature_key: str):
    """FastAPI dependency factory: require a feature for the current user."""
    def _check(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        sys_config = get_system_config(db)
        guard = FeatureGuard(db, current_user)
        guard.require_feature(feature_key, sys_config=sys_config)
        return current_user
    return _check


def require_module(module_key: str):
    """FastAPI dependency factory: require a module-level feature flag."""
    def _check(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        sys_config = get_system_config(db)
        if not sys_config.module_enabled(module_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"模块「{module_key}」已被管理员关闭",
            )
        return current_user
    return _check
