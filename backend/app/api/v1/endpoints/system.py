from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.core.config_loader import get_system_config
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

    # 开源本地版：无套餐概念，tier 恒为 local
    tier = "local"

    return {
        "registration_open": config.registration_open,
        "maintenance_enabled": config.maintenance_enabled,
        "feature_flags": flags,
        "modules": module_flags,
        "tier": tier,
    }


@router.get("/content-version", summary="Content version stamp",
            description="内容版本戳（轻量聚合，<50ms）：前端 60s 轮询比对，戳变才触发失效刷新。")
async def get_content_version(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.core.tenant_scope import get_active_tenant
    from app.services import site_knowledge
    return site_knowledge.content_version(db, current_user.id, get_active_tenant(db, current_user))
