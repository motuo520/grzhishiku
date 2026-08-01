from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config_loader import get_system_config

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


@router.get("/features", summary="Public features", description="Get enabled feature flags.")
async def get_public_features(
    db: Session = Depends(get_db),
):
    config = get_system_config(db)
    flags = config.feature_flags()
    module_flags = {
        key.replace("module_", "").replace("_enabled", ""): enabled
        for key, enabled in flags.items()
        if key.startswith("module_") and key.endswith("_enabled")
    }

    return {
        "registration_open": config.registration_open,
        "maintenance_enabled": config.maintenance_enabled,
        "feature_flags": flags,
        "modules": module_flags,
    }
