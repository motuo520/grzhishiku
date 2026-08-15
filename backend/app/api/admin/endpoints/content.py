from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import datetime
import uuid

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
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
    created_at: datetime
    flag_reason: str

class ModerateAction(BaseModel):
    action: str

@router.get("/", summary="List content", description="List all content for moderation.")
async def list_content(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.CONTENT_MODERATE))
):
    # Build user lookup dict
    users = {u.id: u.display_name or u.username or u.name or "Unknown" for u in db.query(User).all()}
    
    results = []
    
    # Notes
    for note in db.query(Note).all():
        results.append(ContentItem(
            id=note.id,
            type="note",
            title=note.title,
            content=note.content[:200],
            status=note.status or "active",
            brain_side=note.brain_side,
            author_id=note.user_id,
            author_name=users.get(note.user_id, "Unknown"),
            created_at=note.created_at,
            flag_reason=note.flag_reason or "",
        ))
    
    # Capsules
    for capsule in db.query(Capsule).all():
        results.append(ContentItem(
            id=capsule.id,
            type="capsule",
            title=capsule.content_body[:50] if capsule.content_body else "",
            content=capsule.content_body[:200] if capsule.content_body else "",
            status=capsule.status or "active",
            brain_side=capsule.brain_side,
            author_id=capsule.user_id,
            author_name=users.get(capsule.user_id, "Unknown"),
            created_at=capsule.created_at,
            flag_reason=capsule.flag_reason or "",
        ))
    
    # Clips
    for clip in db.query(BrowserClip).all():
        results.append(ContentItem(
            id=clip.id,
            type="clip",
            title=clip.title,
            content=clip.excerpt[:200] if clip.excerpt else clip.full_text[:200] if clip.full_text else "",
            status=clip.status or "active",
            brain_side=clip.brain_side,
            author_id=clip.user_id,
            author_name=users.get(clip.user_id, "Unknown"),
            created_at=clip.created_at,
            flag_reason=clip.flag_reason or "",
        ))
    
    # Knowledge units
    for ku in db.query(KnowledgeUnit).all():
        results.append(ContentItem(
            id=ku.id,
            type="knowledge",
            title=ku.source_title or "",
            content=ku.content_raw[:200] if ku.content_raw else ku.content_processed[:200] if ku.content_processed else "",
            status=ku.status or "active",
            brain_side=ku.brain_side,
            author_id=ku.user_id,
            author_name=users.get(ku.user_id, "Unknown"),
            created_at=ku.created_at,
            flag_reason=ku.flag_reason or "",
        ))
    
    return sorted(results, key=lambda x: x.created_at, reverse=True)

@router.post("/{content_id}/moderate", summary="Moderate content", description="Approve or reject content.")
async def moderate_content(
    content_id: str,
    data: ModerateAction,
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
    )
    db.add(log)
    db.commit()
    
    return {"message": f"Content {data.action}d"}
