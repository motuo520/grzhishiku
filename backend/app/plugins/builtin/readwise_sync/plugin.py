from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import KnowledgeUnit, User
from app.plugins.base import BasePlugin
from app.plugins.manager import plugin_manager

READWISE_EXPORT_URL = "https://readwise.io/api/v2/export/"


class SyncResult(BaseModel):
    created: int
    skipped: int
    last_sync_at: Optional[str]


class ReadwiseSyncPlugin(BasePlugin):
    async def run_sync(self, user: User, db: Session) -> dict:
        """Sync Readwise highlights into the knowledge base."""
        config = plugin_manager.get_config(user, self.manifest.id)
        token = config.get("api_token")
        if not token:
            raise ValueError("Readwise API Token not configured")

        brain_side = config.get("brain_side", "network")
        last_sync_at = config.get("last_sync_at")

        created = 0
        skipped = 0
        params: Dict[str, Any] = {}
        if last_sync_at:
            params["updated_after"] = last_sync_at

        headers = {"Authorization": f"Token {token}"}
        async with httpx.AsyncClient(timeout=60.0) as client:
            while True:
                response = await client.get(READWISE_EXPORT_URL, headers=headers, params=params)
                if response.status_code != 200:
                    raise RuntimeError(f"Readwise API error: {response.status_code} {response.text}")
                data = response.json()
                for book in data.get("results", []):
                    user_book = book.get("user_book") or {}
                    for highlight in book.get("highlights", []):
                        existing = db.query(KnowledgeUnit).filter(
                            KnowledgeUnit.user_id == user.id,
                            KnowledgeUnit.source_id == str(highlight.get("id")),
                            KnowledgeUnit.source_content_type == "readwise",
                        ).first()
                        if existing:
                            skipped += 1
                            continue

                        content_raw = highlight.get("text", "").strip()
                        if not content_raw:
                            skipped += 1
                            continue

                        note = highlight.get("note") or ""
                        if note:
                            content_raw = f"{content_raw}\n\n[笔记] {note}"

                        ku = KnowledgeUnit(
                            user_id=user.id,
                            brain_side=brain_side,
                            content_raw=content_raw[:50000],
                            content_type="readwise",
                            source_url=highlight.get("url") or user_book.get("source_url"),
                            source_title=user_book.get("title") or "Readwise Highlight",
                            source_author=user_book.get("author"),
                            source_type="readwise",
                            source_id=str(highlight.get("id")),
                            source_content_type="readwise",
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
                next_cursor = data.get("next")
                if not next_cursor:
                    break
                params["pageCursor"] = next_cursor

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
                "last_sync_at": config.get("last_sync_at"),
                "has_token": bool(config.get("api_token")),
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
