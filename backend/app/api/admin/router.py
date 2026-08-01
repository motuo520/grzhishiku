from fastapi import APIRouter
from app.api.admin.endpoints import auth, users, content, logs, dashboard, system, support, tenants, gdpr, monitoring

admin_router = APIRouter()

admin_router.include_router(auth.router, prefix="/auth", tags=["Admin Auth"])
admin_router.include_router(users.router, prefix="/users", tags=["Admin Users"])
admin_router.include_router(content.router, prefix="/content", tags=["Admin Content"])
admin_router.include_router(logs.router, prefix="/logs", tags=["Admin Logs"])
admin_router.include_router(dashboard.router, prefix="/dashboard", tags=["Admin Dashboard"])
admin_router.include_router(system.router, prefix="/system", tags=["Admin System"])
admin_router.include_router(support.router, prefix="/support", tags=["Admin Support"])
admin_router.include_router(tenants.router, prefix="/tenants", tags=["Admin Tenants"])
admin_router.include_router(gdpr.router, prefix="/gdpr", tags=["Admin GDPR"])
admin_router.include_router(monitoring.router, prefix="/monitoring", tags=["Admin Monitoring"])
