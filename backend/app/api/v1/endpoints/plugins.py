from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User
from app.plugins.manager import plugin_manager
from app.services.plugin_scheduler import (
    SYNCABLE_PLUGIN_IDS,
    get_next_run_time,
    schedule_user_plugin_sync,
)

router = APIRouter()


class PluginEnableRequest(BaseModel):
    enabled: bool


class PluginConfigRequest(BaseModel):
    config: Dict[str, Any]


class AutoSyncConfigRequest(BaseModel):
    enabled: bool = False
    interval_minutes: int = 60


_SYNC_INTERVALS = {30, 60, 360, 1440}


@router.get("", summary="List installed plugins")
async def list_plugins(
    current_user: User = Depends(get_current_user),
):
    """Return all discovered plugins merged with the current user's enable/config state."""
    return plugin_manager.list_for_user(current_user)


@router.post("/{plugin_id}/enable", summary="Enable or disable a plugin")
async def enable_plugin(
    plugin_id: str,
    request: PluginEnableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if plugin_id not in plugin_manager.plugins:
        raise HTTPException(status_code=404, detail="Plugin not found")
    plugin_manager.set_enabled(current_user, plugin_id, request.enabled, db)
    if not request.enabled:
        schedule_user_plugin_sync(current_user, plugin_id)
    manifest = plugin_manager.plugins[plugin_id].manifest
    return {"id": plugin_id, "enabled": request.enabled, "permissions": manifest.permissions}


@router.put("/{plugin_id}/config", summary="Update plugin configuration")
async def configure_plugin(
    plugin_id: str,
    request: PluginConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if plugin_id not in plugin_manager.plugins:
        raise HTTPException(status_code=404, detail="Plugin not found")
    plugin_manager.set_config(current_user, plugin_id, request.config, db)
    schedule_user_plugin_sync(current_user, plugin_id)
    return {"id": plugin_id, "config": request.config}


@router.get("/{plugin_id}/sync/config", summary="Get auto-sync configuration")
async def get_auto_sync_config(
    plugin_id: str,
    current_user: User = Depends(get_current_user),
):
    if plugin_id not in plugin_manager.plugins:
        raise HTTPException(status_code=404, detail="Plugin not found")
    if plugin_id not in SYNCABLE_PLUGIN_IDS:
        raise HTTPException(status_code=400, detail="Plugin does not support auto-sync")

    auto = plugin_manager.get_auto_sync_config(current_user, plugin_id)
    cfg = plugin_manager.get_config(current_user, plugin_id)
    return {
        "plugin_id": plugin_id,
        "auto_sync": auto,
        "last_sync_at": cfg.get("last_sync_at"),
        "next_run_at": get_next_run_time(current_user.id, plugin_id),
        "has_credentials": _has_credentials(plugin_id, cfg),
    }


@router.post("/{plugin_id}/sync/config", summary="Update auto-sync configuration")
async def set_auto_sync_config(
    plugin_id: str,
    request: AutoSyncConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if plugin_id not in plugin_manager.plugins:
        raise HTTPException(status_code=404, detail="Plugin not found")
    if plugin_id not in SYNCABLE_PLUGIN_IDS:
        raise HTTPException(status_code=400, detail="Plugin does not support auto-sync")
    if request.interval_minutes not in _SYNC_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interval. Allowed values: {_SYNC_INTERVALS}",
        )

    auto_sync = {
        "enabled": request.enabled,
        "interval_minutes": request.interval_minutes,
    }
    plugin_manager.set_auto_sync_config(current_user, plugin_id, auto_sync, db)
    schedule_user_plugin_sync(current_user, plugin_id)

    return {
        "plugin_id": plugin_id,
        "auto_sync": auto_sync,
        "next_run_at": get_next_run_time(current_user.id, plugin_id),
    }


@router.post("/{plugin_id}/sync/trigger", summary="Trigger a manual sync")
async def trigger_sync(
    plugin_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if plugin_id not in plugin_manager.plugins:
        raise HTTPException(status_code=404, detail="Plugin not found")
    if plugin_id not in SYNCABLE_PLUGIN_IDS:
        raise HTTPException(status_code=400, detail="Plugin does not support sync")
    if not plugin_manager.is_enabled(current_user, plugin_id):
        raise HTTPException(status_code=403, detail="Plugin is not enabled")

    try:
        result = await plugin_manager.run_sync_for_user(current_user, plugin_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    schedule_user_plugin_sync(current_user, plugin_id)
    return {"plugin_id": plugin_id, **result}


def _has_credentials(plugin_id: str, cfg: dict) -> bool:
    if plugin_id == "notion-import":
        return bool(cfg.get("integration_token"))
    if plugin_id == "pocket-sync":
        return bool(cfg.get("consumer_key") and cfg.get("access_token"))
    if plugin_id == "readwise-sync":
        return bool(cfg.get("api_token"))
    return False
