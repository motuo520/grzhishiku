from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_optional
from app.core.config_loader import get_system_config
from app.services.billing_service import BillingService
from app.models.base import User

router = APIRouter()


@router.get("/announcement", summary="Public announcement", description="Get the current system announcement.")
async def get_public_announcement(db: Session = Depends(get_db)):
    config = get_system_config(db)
    announcement = config.announcement
    return {
        "title": announcement.get("title", ""),
        "content": announcement.get("content", ""),
        "effective_at": announcement.get("effective_at"),
        "enabled": bool(announcement.get("title") or announcement.get("content")),
    }


@router.get("/features", summary="Public features", description="Get enabled feature flags and current user's tier.")
async def get_public_features(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_optional),
):
    config = get_system_config(db)
    flags = config.feature_flags()
    module_flags = {
        key.replace("module_", "").replace("_enabled", ""): enabled
        for key, enabled in flags.items()
        if key.startswith("module_") and key.endswith("_enabled")
    }

    tier = "free"
    if current_user:
        billing = BillingService(db)
        sub = billing.get_user_subscription(current_user.id)
        if sub:
            plan = billing.get_plan(sub.plan_id)
            tier = plan.slug if plan else "free"

    return {
        "registration_open": config.registration_open,
        "maintenance_enabled": config.maintenance_enabled,
        "feature_flags": flags,
        "modules": module_flags,
        "tier": tier,
    }
