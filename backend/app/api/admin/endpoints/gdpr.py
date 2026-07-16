from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
import uuid

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import (
    User, Note, Capsule, BrowserClip, KnowledgeUnit,
    AttentionActivity, AttentionCategory, DeepWorkSession,
    AdminAuditLog, AdminUser
)
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()

class GDPRDeleteRequest(BaseModel):
    user_id: str
    reason: str = "user_request"

class DataExportRequest(BaseModel):
    user_id: str
    format: str = "json"

@router.post("/delete-user", summary="GDPR Delete User", description="Complete data deletion for a user (GDPR Article 17).")
async def gdpr_delete_user(
    request: Request,
    data: GDPRDeleteRequest,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SYSTEM_CONFIG))
):
    """Soft delete user and all associated data, then hard delete after retention period."""
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Log the deletion request
    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="GDPR_DELETE_USER",
        resource_type="user",
        resource_id=data.user_id,
        details=f"Reason: {data.reason}. IP: {request.client.host}",
        risk_level="high",
        ip_address=request.client.host,
    )
    db.add(log)
    
    # Soft delete: mark user as deleted and anonymize PII
    user.status = "deleted"
    user.email = f"deleted_{data.user_id}@anonymized.local"
    user.name = "Deleted User"
    user.avatar = None
    user.password_hash = None
    
    # Anonymize content (remove PII but keep structure for analytics)
    for note in db.query(Note).filter(Note.user_id == data.user_id).all():
        note.title = "[Deleted]"
        note.content = "[Content deleted per user request]"
    
    for capsule in db.query(Capsule).filter(Capsule.user_id == data.user_id).all():
        capsule.content_body = "[Content deleted per user request]"
    
    for clip in db.query(BrowserClip).filter(BrowserClip.user_id == data.user_id).all():
        clip.excerpt = "[Deleted]"
        clip.full_text = "[Content deleted per user request]"
    
    for ku in db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == data.user_id).all():
        ku.content_raw = "[Content deleted per user request]"
    
    # Delete attention/sensitive data completely
    db.query(AttentionActivity).filter(AttentionActivity.user_id == data.user_id).delete()
    db.query(AttentionCategory).filter(AttentionCategory.user_id == data.user_id).delete()
    db.query(DeepWorkSession).filter(DeepWorkSession.user_id == data.user_id).delete()
    
    db.commit()
    return {
        "message": "User data deletion initiated",
        "user_id": data.user_id,
        "deleted_at": datetime.utcnow().isoformat(),
        "retention_period_days": 30,
        "note": "Data is soft-deleted now. Hard deletion will occur after 30 days."
    }

@router.post("/export-user", summary="GDPR Data Export", description="Export all user data in a portable format (GDPR Article 20).")
async def gdpr_export_user(
    data: DataExportRequest,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_READ))
):
    """Export all user data in a structured format."""
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    notes = db.query(Note).filter(Note.user_id == data.user_id).all()
    capsules = db.query(Capsule).filter(Capsule.user_id == data.user_id).all()
    clips = db.query(BrowserClip).filter(BrowserClip.user_id == data.user_id).all()
    knowledge = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == data.user_id).all()
    
    export_data = {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "subscription_tier": user.subscription_tier,
        },
        "notes": [{"id": n.id, "title": n.title, "content": n.content, "created_at": n.created_at.isoformat()} for n in notes],
        "capsules": [{"id": c.id, "content": c.content_body, "created_at": c.created_at.isoformat()} for c in capsules],
        "clips": [{"id": c.id, "title": c.title, "url": c.url, "created_at": c.created_at.isoformat()} for c in clips],
        "knowledge": [{"id": k.id, "title": k.source_title, "created_at": k.created_at.isoformat()} for k in knowledge],
    }
    
    return {
        "user_id": data.user_id,
        "format": data.format,
        "exported_at": datetime.utcnow().isoformat(),
        "data": export_data,
    }
