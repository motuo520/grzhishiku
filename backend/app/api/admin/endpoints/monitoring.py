from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.metrics import get_metrics, update_business_metrics
from app.core.admin_permissions import Permission, require_permission
from app.models.base import AdminUser
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()

@router.get("/prometheus", summary="Prometheus metrics", description="Prometheus metrics endpoint for scraping.")
async def prometheus_metrics(
    current_admin: AdminUser = Depends(require_permission(Permission.LOGS_READ))
):
    return get_metrics()

@router.get("/business", summary="Business metrics", description="Current business metrics (users, content counts).")
async def business_metrics(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.LOGS_READ))
):
    update_business_metrics(db)
    from app.models.base import User, Note, Capsule, BrowserClip
    from sqlalchemy import func
    
    return {
        "active_users": db.query(func.count(User.id)).filter(User.status == "active").scalar(),
        "total_notes": db.query(func.count(Note.id)).scalar(),
        "total_capsules": db.query(func.count(Capsule.id)).scalar(),
        "total_clips": db.query(func.count(BrowserClip.id)).scalar(),
        "total_knowledge": db.query(func.count(Note.id)).scalar(),
    }
