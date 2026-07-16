from datetime import datetime
from typing import List, Optional

from mcp.server.fastmcp import FastMCP

from app.core.database import SessionLocal
from app.models.base import KnowledgeUnit, Note, User


def register_core_tools(mcp: FastMCP) -> None:
    """Register core Personal Second Brain tools on the given FastMCP instance."""

    @mcp.tool()
    def search_knowledge(
        query: str,
        user_id: str,
        brain_side: str = "both",
        limit: int = 10,
    ) -> List[dict]:
        """Search the user's knowledge units by content or source title."""
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
            return [
                {
                    "id": item.id,
                    "content_raw": item.content_raw[:500],
                    "brain_side": item.brain_side,
                    "verification_status": item.verification_status,
                    "source_title": item.source_title,
                    "source_url": item.source_url,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                }
                for item in items
            ]
        finally:
            db.close()

    @mcp.tool()
    def create_note(
        title: str,
        content: str,
        user_id: str,
        brain_side: str = "personal",
    ) -> dict:
        """Create a personal note in the second brain."""
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
        user_id: str,
        brain_side: str = "network",
        source_url: Optional[str] = None,
        source_title: Optional[str] = None,
    ) -> dict:
        """Create a network-brain knowledge unit from external content."""
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"error": "User not found"}
            ku = KnowledgeUnit(
                user_id=user_id,
                brain_side=brain_side,
                content_raw=content_raw,
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
        user_id: str,
        brain_side: str = "both",
    ) -> dict:
        """Return cognitive pipeline stage counts for the user."""
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
    def whoami(user_id: str) -> dict:
        """Return basic info about the user."""
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
