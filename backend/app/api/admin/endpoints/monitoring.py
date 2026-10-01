from fastapi import APIRouter, Depends
from app.core.metrics import get_metrics
from app.core.admin_permissions import Permission, require_permission
from app.models.base import AdminUser
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()

@router.get("/prometheus", summary="Prometheus metrics", description="Prometheus metrics endpoint for scraping.")
async def prometheus_metrics(
    current_admin: AdminUser = Depends(require_permission(Permission.LOGS_READ))
):
    return get_metrics()
