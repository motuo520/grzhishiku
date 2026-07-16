from fastapi import Depends, HTTPException, status, Request
from typing import Optional, Callable
from functools import wraps

from app.core.security import get_current_user
from app.core.database import get_db
from app.services.billing_service import BillingService
from app.models.base import User
from sqlalchemy.orm import Session

# ─── 权限检查装饰器 ───

def require_subscription(tier: str = "storage"):
    """
    装饰器：要求用户至少达到某订阅等级
    tier: 'free' | 'storage'
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            user = kwargs.get('user') or kwargs.get('current_user')
            db = kwargs.get('db')
            if user and db:
                billing = BillingService(db)
                sub = billing.get_user_subscription(user.id)

                current_tier = sub.status if sub and sub.status in ['active', 'trial'] else 'free'
                if current_tier == 'trial':
                    current_tier = billing.get_plan(sub.plan_id).slug if billing.get_plan(sub.plan_id) else 'free'
                elif current_tier not in ['active', 'trial']:
                    current_tier = 'free'
                else:
                    plan = billing.get_plan(sub.plan_id) if sub else None
                    current_tier = plan.slug if plan else 'free'

                current_level = SubscriptionGuard.TIER_LEVELS.get(current_tier, 0)
                required_level = SubscriptionGuard.TIER_LEVELS.get(tier, 0)

                if current_level < required_level:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Requires {tier} subscription. Current: {current_tier}",
                    )
            return await func(*args, **kwargs)
        wrapper._require_tier = tier
        return wrapper
    return decorator


class SubscriptionGuard:
    """订阅权限守卫（用于依赖注入）"""

    TIER_LEVELS = {
        'free': 0,
        'storage': 1,
    }

    def __init__(self, min_tier: str = "free"):
        self.min_tier = min_tier

    async def __call__(self, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        billing = BillingService(db)
        sub = billing.get_user_subscription(user.id)

        current_tier = sub.status if sub and sub.status in ['active', 'trial'] else 'free'
        if current_tier == 'trial':
            current_tier = billing.get_plan(sub.plan_id).slug if billing.get_plan(sub.plan_id) else 'free'
        elif current_tier not in ['active', 'trial']:
            current_tier = 'free'
        else:
            # 有活跃订阅，取 plan slug
            plan = billing.get_plan(sub.plan_id) if sub else None
            current_tier = plan.slug if plan else 'free'

        current_level = self.TIER_LEVELS.get(current_tier, 0)
        required_level = self.TIER_LEVELS.get(self.min_tier, 0)

        if current_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {self.min_tier} subscription. Current: {current_tier}",
            )

        return user

# 便捷依赖
require_free = SubscriptionGuard("free")          # 任何用户
require_storage = SubscriptionGuard("storage")    # 存储会员及以上

# 功能检查中间件（轻量级，不阻断请求，只附加信息）
async def check_feature_limit(
    feature: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> bool:
    """检查用户是否有某功能权限，返回布尔值"""
    billing = BillingService(db)
    return billing.check_feature_access(user.id, feature)

# 辅助函数：检查用户当前 tier
async def get_user_tier(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> str:
    """获取用户当前订阅等级"""
    billing = BillingService(db)
    sub = billing.get_user_subscription(user.id)
    if not sub or sub.status not in ['active', 'trial']:
        return 'free'
    plan = billing.get_plan(sub.plan_id)
    return plan.slug if plan else 'free'
