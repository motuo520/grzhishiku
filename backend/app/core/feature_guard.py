"""Feature and quota guards —— 开源本地版放行桩。

主仓同名模块按订阅套餐做功能/配额门闸（依赖 billing_service，剥离面）。
开源版无套餐概念：保留接口形态（FeatureGuard / require_feature / require_module），
全部放行。require_module 仍保留管理员全局模块开关（SystemConfig feature_flags），
那是本地管理开关，与计费无关。
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config_loader import get_system_config
from app.models.base import User


class FeatureGuard:
    """开源版：功能门闸全部放行（无套餐/计费）。"""

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user

    def require_feature(self, feature_key: str, sys_config=None):
        return None

    def check_limit(self, limit_key: str, current_usage: int = 0):
        return None


def require_feature(feature_key: str):
    """FastAPI dependency factory: 开源版直通（只解析当前用户）。"""
    def _check(
        current_user: User = Depends(get_current_user),
    ) -> User:
        return current_user
    return _check


def require_module(module_key: str):
    """FastAPI dependency factory: 保留管理员模块级总开关（本地配置，非计费）。"""
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
