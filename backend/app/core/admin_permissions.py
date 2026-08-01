"""Admin RBAC helpers.

Defines a simple permission model for admin endpoints and a FastAPI dependency
factory to enforce them. Permissions are stored in `AdminUser.permissions` as a
JSON object mapping resource to a list of actions.

Super admins bypass all permission checks.
"""

import json
from enum import Enum
from functools import wraps
from typing import List, Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import TYPE_CHECKING

from app.core.database import get_db
from app.models.base import AdminUser

if TYPE_CHECKING:
    pass  # avoid circular imports at runtime


class Permission(str, Enum):
    USERS_READ = "users:read"
    USERS_WRITE = "users:write"
    CONTENT_MODERATE = "content:moderate"
    SYSTEM_CONFIG = "system:config"
    SUPPORT_MANAGE = "support:manage"
    LOGS_READ = "logs:read"
    TENANTS_MANAGE = "tenants:manage"
    ADMINS_MANAGE = "admins:manage"


# Default permissions per role
ROLE_PERMISSIONS = {
    "super_admin": [p.value for p in Permission],
    "platform_admin": [
        Permission.USERS_READ.value,
        Permission.USERS_WRITE.value,
        Permission.CONTENT_MODERATE.value,
        Permission.SYSTEM_CONFIG.value,
        Permission.SUPPORT_MANAGE.value,
        Permission.LOGS_READ.value,
        Permission.TENANTS_MANAGE.value,
    ],
    "support": [
        Permission.USERS_READ.value,
        Permission.SUPPORT_MANAGE.value,
        Permission.LOGS_READ.value,
    ],
    "operator": [
        Permission.USERS_READ.value,
        Permission.CONTENT_MODERATE.value,
        Permission.SUPPORT_MANAGE.value,
    ],
    "auditor": [
        Permission.LOGS_READ.value,
        Permission.USERS_READ.value,
    ],
    "readonly": [
        Permission.USERS_READ.value,
        Permission.LOGS_READ.value,
    ],
}


def _get_permissions(admin: AdminUser) -> List[str]:
    """Return effective permissions for an admin (stored + role defaults)."""
    if admin.role == "super_admin":
        return [p.value for p in Permission]

    stored = {}
    if admin.permissions:
        try:
            stored = json.loads(admin.permissions)
        except (json.JSONDecodeError, TypeError):
            stored = {}

    # Start with role defaults
    perms = set(ROLE_PERMISSIONS.get(admin.role, []))
    # Apply stored overrides
    for resource, actions in stored.items():
        if isinstance(actions, list):
            for action in actions:
                perms.add(f"{resource}:{action}")
        elif actions is True:
            perms.add(f"{resource}:read")
            perms.add(f"{resource}:write")

    return list(perms)


def has_permission(admin: AdminUser, permission: Permission) -> bool:
    """Check if admin has a specific permission."""
    if admin.role == "super_admin":
        return True
    return permission.value in _get_permissions(admin)


def require_permission(permission: Permission):
    """FastAPI dependency factory: require a specific admin permission."""
    # Local import to avoid circular dependency: auth.py imports this module.
    from app.api.admin.endpoints.auth import get_current_admin

    def _check(
        current_admin: AdminUser = Depends(get_current_admin),
    ) -> AdminUser:
        if not has_permission(current_admin, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission.value}",
            )
        return current_admin
    return _check


def get_admin_permissions(admin: AdminUser) -> List[str]:
    """Public helper to list an admin's effective permissions."""
    return _get_permissions(admin)
