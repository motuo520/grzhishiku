from datetime import datetime, timezone
from typing import Any, List, Optional
from urllib.parse import urlparse
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import ReadLaterItem, User
from app.plugins.base import BasePlugin
from app.plugins.manager import plugin_manager

logger = logging.getLogger(__name__)

POCKET_GET_URL = "https://getpocket.com/v3/get"


class SyncResult(BaseModel):
    created: int
    skipped: int
    last_sync_at: Optional[str]


class PocketSyncPlugin(BasePlugin):
    async def run_sync(self, user: User, db: Session) -> dict:
        """Sync Pocket read-later list into the system."""
        config = plugin_manager.get_config(user, self.manifest.id)
        consumer_key = config.get("consumer_key")
        access_token = config.get("access_token")
        if not consumer_key or not access_token:
            raise ValueError("Pocket credentials not configured")

        last_sync_ts = config.get("last_sync_at")
        payload = {
            "consumer_key": consumer_key,
            "access_token": access_token,
            "state": "all",
            "detailType": "complete",
        }
        if last_sync_ts:
            payload["since"] = last_sync_ts

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(POCKET_GET_URL, json=payload)
            if response.status_code != 200:
                # 上游错误体原文只进日志；用户面只留 status_code
                logger.warning("Pocket API error %s: %s", response.status_code, response.text)
                raise RuntimeError(f"Pocket API error: {response.status_code}")
            data = response.json()

        items = data.get("list") or {}
        created = 0
        skipped = 0
        now_ts = str(int(datetime.now(timezone.utc).timestamp()))

        for item_id, item in items.items():
            if not isinstance(item, dict):
                continue
            url = item.get("resolved_url") or item.get("given_url") or ""
            title = item.get("resolved_title") or item.get("given_title") or ""
            excerpt = item.get("excerpt", "")

            existing = db.query(ReadLaterItem).filter(
                ReadLaterItem.user_id == user.id,
                ReadLaterItem.url == url,
                ReadLaterItem.item_status == "active",
            ).first()
            if existing:
                skipped += 1
                continue

            domain = ""
            try:
                domain = urlparse(url).hostname or ""
            except Exception:
                pass

            rl = ReadLaterItem(
                user_id=user.id,
                title=title,
                url=url,
                domain=domain,
                excerpt=excerpt,
                source="pocket",
                item_status="active",
            )
            db.add(rl)
            created += 1

        db.commit()
        new_config = {**config, "last_sync_at": now_ts}
        plugin_manager.set_config(user, self.manifest.id, new_config, db)
        return {"created": created, "skipped": skipped, "last_sync_at": now_ts}

    def get_routers(self) -> List[Any]:
        router = APIRouter()

        @router.get("/status")
        async def status(current_user: User = Depends(get_current_user)):
            config = plugin_manager.get_config(current_user, self.manifest.id)
            return {
                "enabled": plugin_manager.is_enabled(current_user, self.manifest.id),
                "last_sync_at": config.get("last_sync_at"),
                "has_credentials": bool(config.get("consumer_key") and config.get("access_token")),
            }

        @router.post("/sync", response_model=SyncResult)
        async def sync(
            current_user: User = Depends(get_current_user),
            db: Session = Depends(get_db),
        ):
            if not plugin_manager.is_enabled(current_user, self.manifest.id):
                raise HTTPException(status_code=403, detail="Plugin is not enabled")
            try:
                result = await self.run_sync(current_user, db)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except RuntimeError as e:
                raise HTTPException(status_code=502, detail=str(e))
            return SyncResult(
                created=result["created"],
                skipped=result["skipped"],
                last_sync_at=result["last_sync_at"],
            )

        return [router]
