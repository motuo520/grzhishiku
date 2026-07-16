from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import KnowledgeUnit, User
from app.plugins.base import BasePlugin
from app.plugins.manager import plugin_manager

NOTION_SEARCH_URL = "https://api.notion.com/v1/search"
NOTION_VERSION = "2022-06-28"


class ImportResult(BaseModel):
    created: int
    skipped: int


def _extract_title(item: dict) -> str:
    properties = item.get("properties") or {}
    # Page title
    title_prop = properties.get("title")
    if title_prop and title_prop.get("title"):
        return "".join(t.get("text", {}).get("content", "") for t in title_prop["title"])
    # Database title or other
    for key, val in properties.items():
        if isinstance(val, dict) and val.get("type") == "title" and val.get("title"):
            return "".join(t.get("text", {}).get("content", "") for t in val["title"])
    return item.get("url") or "Notion Item"


class NotionImportPlugin(BasePlugin):
    async def run_sync(self, user: User, db: Session, limit: int = 50) -> dict:
        """Import pages from Notion and store them as raw knowledge units."""
        config = plugin_manager.get_config(user, self.manifest.id)
        token = config.get("integration_token")
        if not token:
            raise ValueError("Notion Integration Token not configured")

        brain_side = config.get("brain_side", "network")
        headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }
        payload: dict = {"page_size": min(limit, 100)}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(NOTION_SEARCH_URL, headers=headers, json=payload)
            if response.status_code != 200:
                raise RuntimeError(f"Notion API error: {response.status_code} {response.text}")
            data = response.json()

        created = 0
        skipped = 0
        for item in data.get("results", []):
            item_id = item.get("id")
            if not item_id:
                continue
            existing = db.query(KnowledgeUnit).filter(
                KnowledgeUnit.user_id == user.id,
                KnowledgeUnit.source_id == item_id,
                KnowledgeUnit.source_content_type == "notion",
            ).first()
            if existing:
                skipped += 1
                continue

            title = _extract_title(item)
            ku = KnowledgeUnit(
                user_id=user.id,
                brain_side=brain_side,
                content_raw=title,
                content_type="notion",
                source_url=item.get("url"),
                source_title=title,
                source_type="notion",
                source_id=item_id,
                source_content_type="notion",
                verification_status="unverified",
                trust_level="tentative",
                verification_history='[]',
                pipeline_stage="raw",
                origin_type="external_import",
                attached_practice_ids='[]',
            )
            db.add(ku)
            created += 1

        db.commit()
        now = datetime.now(timezone.utc).isoformat()
        new_config = {**config, "last_sync_at": now}
        plugin_manager.set_config(user, self.manifest.id, new_config, db)
        return {"created": created, "skipped": skipped, "last_sync_at": now}

    def get_routers(self) -> List[Any]:
        router = APIRouter()

        @router.get("/status")
        async def status(current_user: User = Depends(get_current_user)):
            config = plugin_manager.get_config(current_user, self.manifest.id)
            return {
                "enabled": plugin_manager.is_enabled(current_user, self.manifest.id),
                "has_token": bool(config.get("integration_token")),
                "last_sync_at": config.get("last_sync_at"),
            }

        @router.post("/import", response_model=ImportResult)
        async def import_pages(
            limit: int = 50,
            current_user: User = Depends(get_current_user),
            db: Session = Depends(get_db),
        ):
            if not plugin_manager.is_enabled(current_user, self.manifest.id):
                raise HTTPException(status_code=403, detail="Plugin is not enabled")
            try:
                result = await self.run_sync(current_user, db, limit=limit)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except RuntimeError as e:
                raise HTTPException(status_code=502, detail=str(e))
            return ImportResult(created=result["created"], skipped=result["skipped"])

        return [router]
