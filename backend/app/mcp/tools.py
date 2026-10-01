from datetime import datetime
from typing import Optional

from mcp.server.fastmcp import Context, FastMCP

from app.core.database import SessionLocal
from app.services.knowledge_title import first_line_title
from app.core.security import decode_token
from app.models.base import KnowledgeUnit, Note, User


def _current_user_id(ctx: Context) -> str:
    """Resolve the authenticated user from the HTTP request carrying this MCP call."""
    request = getattr(ctx.request_context, "request", None)
    auth = request.headers.get("authorization", "") if request is not None else ""
    if auth.lower().startswith("bearer "):
        payload = decode_token(auth[7:].strip())
        if payload and payload.get("type") == "user" and payload.get("sub"):
            return payload["sub"]
    raise ValueError("未认证：请在 MCP 客户端配置 Authorization: Bearer <token>")


def register_core_tools(mcp: FastMCP) -> None:
    """Register core Molore tools on the given FastMCP instance."""

    @mcp.tool()
    async def search_knowledge(
        query: str,
        ctx: Context,
        brain_side: str = "both",
        limit: int = 10,
    ) -> dict:
        """混合检索知识库（笔记/剪藏/知识单元/文档：向量+全文+图谱，与智能体
        search_notes 同一口径）。返回命中 id/类型/标题/摘要，可再用 read_note 读全文。"""
        user_id = _current_user_id(ctx)
        # 开源版无 agent_tools：用本地全文检索（ilike）同口径实现
        limit = max(1, min(limit, 100))
        db = SessionLocal()
        try:
            q = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id)
            if brain_side != "both":
                q = q.filter(KnowledgeUnit.brain_side == brain_side)
            q = q.filter(
                KnowledgeUnit.content_raw.ilike(f"%{query}%")
                | KnowledgeUnit.source_title.ilike(f"%{query}%")
            )
            items = q.order_by(KnowledgeUnit.created_at.desc()).limit(limit).all()
            return {
                "count": len(items),
                "results": [
                    {
                        "id": item.id,
                        "content_type": "knowledge",
                        "title": item.source_title or (item.content_raw or "")[:30],
                        "snippet": (item.content_raw or "")[:500],
                        "brain_side": item.brain_side,
                        "created_at": item.created_at.isoformat() if item.created_at else None,
                    }
                    for item in items
                ],
            }
        finally:
            db.close()

    @mcp.tool()
    def read_note(content_id: str, ctx: Context) -> dict:
        """按 id 读内容全文（笔记/剪藏/知识单元/文档四类通用，截断 2000 字）。"""
        user_id = _current_user_id(ctx)
        # 开源版无 agent_tools：按 id 直查四类内容，截断 2000 字
        from app.models.base import BrowserClip, Document

        db = SessionLocal()
        try:
            for model, ctype in ((Note, "note"), (BrowserClip, "clip"),
                                 (KnowledgeUnit, "knowledge"), (Document, "document")):
                row = db.query(model).filter(model.id == content_id, model.user_id == user_id).first()
                if row is None:
                    continue
                body = getattr(row, "content", None) or getattr(row, "content_raw", None) or ""
                title = getattr(row, "title", None) or getattr(row, "source_title", None) or ""
                return {
                    "id": row.id,
                    "content_type": ctype,
                    "title": title,
                    "content": body[:2000],
                    "truncated": len(body) > 2000,
                }
            return {"error": "内容不存在"}
        finally:
            db.close()

    @mcp.tool()
    def list_recent_notes(ctx: Context, limit: int = 10) -> dict:
        """最近更新的笔记列表（id/标题/脑侧/更新时间），按 updated_at 降序。"""
        user_id = _current_user_id(ctx)
        db = SessionLocal()
        try:
            rows = (
                db.query(Note)
                .filter(Note.user_id == user_id, Note.tenant_id.is_(None), Note.status == "active")
                .order_by(Note.updated_at.desc())
                .limit(max(1, min(int(limit or 10), 50)))
                .all()
            )
            return {
                "count": len(rows),
                "notes": [
                    {
                        "id": n.id,
                        "title": n.title,
                        "brain_side": n.brain_side,
                        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
                    }
                    for n in rows
                ],
            }
        finally:
            db.close()

    @mcp.tool()
    def create_note(
        title: str,
        content: str,
        ctx: Context,
        brain_side: str = "personal",
    ) -> dict:
        """Create a personal note in the second brain."""
        user_id = _current_user_id(ctx)
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"error": "User not found"}
            note = Note(
                user_id=user_id,
                brain_side=brain_side,
                title=title,
                content=content,
                pipeline_stage="raw",
            )
            db.add(note)
            db.commit()
            db.refresh(note)
            return {
                "id": note.id,
                "title": note.title,
                "brain_side": note.brain_side,
                "created_at": note.created_at.isoformat() if note.created_at else None,
            }
        finally:
            db.close()

    @mcp.tool()
    def create_knowledge_unit(
        content_raw: str,
        ctx: Context,
        brain_side: str = "network",
        source_url: Optional[str] = None,
        source_title: Optional[str] = None,
    ) -> dict:
        """Create a network-brain knowledge unit from external content."""
        user_id = _current_user_id(ctx)
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"error": "User not found"}
            ku = KnowledgeUnit(
                user_id=user_id,
                brain_side=brain_side,
                content_raw=content_raw,
                title=source_title or first_line_title(content_raw) or None,  # 09-16
                source_url=source_url,
                source_title=source_title,
                source_type="external",
                verification_status="unverified",
                trust_level="tentative",
                verification_history='[]',
                pipeline_stage="raw",
                origin_type="external_import",
                attached_practice_ids='[]',
            )
            db.add(ku)
            db.commit()
            db.refresh(ku)
            return {
                "id": ku.id,
                "brain_side": ku.brain_side,
                "verification_status": ku.verification_status,
                "created_at": ku.created_at.isoformat() if ku.created_at else None,
            }
        finally:
            db.close()

    @mcp.tool()
    def get_pipeline_stats(
        ctx: Context,
        brain_side: str = "both",
    ) -> dict:
        """Return cognitive pipeline stage counts for the user."""
        user_id = _current_user_id(ctx)
        db = SessionLocal()
        try:
            note_query = db.query(Note).filter(Note.user_id == user_id, Note.status == "active")
            ku_query = db.query(KnowledgeUnit).filter(
                KnowledgeUnit.user_id == user_id,
                KnowledgeUnit.status == "active",
            )
            if brain_side != "both":
                note_query = note_query.filter(Note.brain_side == brain_side)
                ku_query = ku_query.filter(KnowledgeUnit.brain_side == brain_side)

            stages = ["raw", "card", "extracted", "collided", "approved"]
            note_counts = {stage: note_query.filter(Note.pipeline_stage == stage).count() for stage in stages}
            ku_counts = {stage: ku_query.filter(KnowledgeUnit.pipeline_stage == stage).count() for stage in stages}
            return {stage: note_counts[stage] + ku_counts[stage] for stage in stages}
        finally:
            db.close()

    @mcp.tool()
    def whoami(ctx: Context) -> dict:
        """Return basic info about the authenticated user."""
        user_id = _current_user_id(ctx)
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"error": "User not found"}
            return {
                "id": user.id,
                "email": user.email,
                "name": user.name,
            }
        finally:
            db.close()
