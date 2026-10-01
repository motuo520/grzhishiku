from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uuid

from app.core.database import get_db
from app.core.audit import audit_request_meta
from app.core.admin_permissions import Permission, require_permission
from app.core.crypto import decrypt_capsule_content
from app.models.base import Note, Capsule, BrowserClip, KnowledgeUnit, AdminAuditLog, User, AdminUser
from app.models.community import CommunityPost
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()

class ContentItem(BaseModel):
    id: str
    type: str
    title: str
    content: str
    status: str
    brain_side: str
    author_id: str
    author_name: str
    created_at: Optional[datetime] = None
    flag_reason: str

class ModerateAction(BaseModel):
    action: str

@router.get("/", summary="List content", description="List content for moderation (paginated, newest first).")
async def list_content(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    type: Optional[str] = Query(None, description="Filter by type: note/capsule/clip/knowledge"),
    status: Optional[str] = Query(None, description="Filter by status"),
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.CONTENT_MODERATE))
):
    # 全局按 created_at 倒序分页：每表只需取前 page*page_size 条，
    # 归并排序后切片即为当前页，避免五表全量拉进内存
    fetch_limit = page * page_size

    items: List[ContentItem] = []

    # Notes
    if type in (None, "note"):
        q = db.query(Note)
        if status:
            q = q.filter(Note.status == status)
        for note in q.order_by(Note.created_at.desc()).limit(fetch_limit).all():
            items.append(ContentItem(
                id=note.id,
                type="note",
                title=note.title or "",
                content=(note.content or "")[:200],
                status=note.status or "active",
                brain_side=note.brain_side or "",
                author_id=note.user_id,
                author_name="",
                created_at=note.created_at,
                flag_reason=note.flag_reason or "",
            ))

    # Capsules
    if type in (None, "capsule"):
        q = db.query(Capsule)
        if status:
            q = q.filter(Capsule.status == status)
        for capsule in q.order_by(Capsule.created_at.desc()).limit(fetch_limit).all():
            body = decrypt_capsule_content(capsule.content_body)
            items.append(ContentItem(
                id=capsule.id,
                type="capsule",
                title=body[:50],
                content=body[:200],
                status=capsule.status or "active",
                brain_side=capsule.brain_side or "",
                author_id=capsule.user_id,
                author_name="",
                created_at=capsule.created_at,
                flag_reason=capsule.flag_reason or "",
            ))

    # Clips
    if type in (None, "clip"):
        q = db.query(BrowserClip)
        if status:
            q = q.filter(BrowserClip.status == status)
        for clip in q.order_by(BrowserClip.created_at.desc()).limit(fetch_limit).all():
            items.append(ContentItem(
                id=clip.id,
                type="clip",
                title=clip.title or "",
                content=(clip.excerpt or clip.full_text or "")[:200],
                status=clip.status or "active",
                brain_side=clip.brain_side or "",
                author_id=clip.user_id,
                author_name="",
                created_at=clip.created_at,
                flag_reason=clip.flag_reason or "",
            ))

    # Knowledge units
    if type in (None, "knowledge"):
        q = db.query(KnowledgeUnit)
        if status:
            q = q.filter(KnowledgeUnit.status == status)
        for ku in q.order_by(KnowledgeUnit.created_at.desc()).limit(fetch_limit).all():
            items.append(ContentItem(
                id=ku.id,
                type="knowledge",
                title=ku.source_title or "",
                content=(ku.content_raw or ku.content_processed or "")[:200],
                status=ku.status or "active",
                brain_side=ku.brain_side or "",
                author_id=ku.user_id,
                author_name="",
                created_at=ku.created_at,
                flag_reason=ku.flag_reason or "",
            ))

    # 作者名只查当前页涉及的 user，避免 User 全表加载
    author_ids = {i.author_id for i in items if i.author_id}
    users = (
        {u.id: u.display_name or u.username or u.name or "Unknown"
         for u in db.query(User).filter(User.id.in_(author_ids)).all()}
        if author_ids else {}
    )
    for item in items:
        item.author_name = users.get(item.author_id, "Unknown")

    items.sort(key=lambda x: x.created_at or datetime.min, reverse=True)
    start = (page - 1) * page_size
    return items[start:start + page_size]

@router.post("/{content_id}/moderate", summary="Moderate content", description="Approve or reject content.")
async def moderate_content(
    content_id: str,
    data: ModerateAction,
    request: Request,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.CONTENT_MODERATE))
):
    # Try each content type
    item = None
    item_type = ""
    
    for Model, model_type in [
        (Note, "note"),
        (Capsule, "capsule"),
        (BrowserClip, "clip"),
        (KnowledgeUnit, "knowledge"),
        (CommunityPost, "community_post"),
    ]:
        item = db.query(Model).filter(Model.id == content_id).first()
        if item:
            item_type = model_type
            break
    
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")
    
    # CommunityPost 无 status 字段，审核口径映射到 is_spam（approve=正常，reject=标记垃圾隐藏）
    if data.action == "approve":
        if item_type == "community_post":
            item.is_spam = False
        else:
            item.status = "active"
    elif data.action == "reject":
        if item_type == "community_post":
            item.is_spam = True
        else:
            item.status = "rejected"
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    # Log audit
    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="MODERATE_CONTENT",
        resource_type=item_type,
        resource_id=content_id,
        details=f"Action: {data.action}",
        risk_level="medium" if data.action == "reject" else "low",
        **audit_request_meta(request),
    )
    db.add(log)
    db.commit()
    
    return {"message": f"Content {data.action}d"}
