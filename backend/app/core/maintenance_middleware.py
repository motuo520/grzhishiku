"""Maintenance mode middleware.

When maintenance_mode.enabled is true, non-admin API requests are blocked with
HTTP 503. Admin endpoints and health checks are always allowed.
"""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.database import SessionLocal
from app.core.config_loader import get_system_config


class MaintenanceMiddleware(BaseHTTPMiddleware):
    """Block public API requests when maintenance mode is enabled."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Always allow health checks and admin endpoints
        if path in ("/", "/health") or path.startswith("/api/admin/"):
            return await call_next(request)

        # Only apply to API routes
        if not path.startswith("/api/"):
            return await call_next(request)

        try:
            with SessionLocal() as db:
                config = get_system_config(db)
                if config.maintenance_enabled:
                    return JSONResponse(
                        status_code=503,
                        content={
                            "detail": "系统维护中",
                            "message": config.maintenance_message or "系统正在维护，请稍后再试。",
                            "maintenance": True,
                        },
                    )
        except Exception:
            # Fail open: if we can't read config, don't block traffic
            pass

        return await call_next(request)
