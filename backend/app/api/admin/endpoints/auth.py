from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Literal
import json
import uuid

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, decode_token, validate_password_complexity
from app.core.admin_permissions import get_admin_permissions, Permission, require_permission
from app.models.base import AdminUser, AdminAuditLog
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

router = APIRouter()
admin_security = HTTPBearer(auto_error=False)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(admin_security),
    db: Session = Depends(get_db)
):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials, is_admin=True)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    admin_id = payload.get("sub")
    if not admin_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    admin = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if not admin or admin.status != "active":
        raise HTTPException(status_code=403, detail="Admin access denied")
    return admin


# 固定 dummy bcrypt hash：账号不存在时也执行一次 verify_password，
# 抹平「邮箱是否注册」的响应时序差，防登录接口用户枚举
_DUMMY_PASSWORD_HASH = "$2b$12$qE4.oSZdBERv/iREWKuaPOnbb.2.Wo0ovWDFzTie0S9CFtkrVyCUK"


# ─── Schemas ──────────────────────────────────────────────────────

# 角色白名单与 admin_permissions.ROLE_PERMISSIONS 保持一致；
# status 取模型与现有流程实际用到的值（deleted 走 DELETE 软删除，不经 PATCH）
AdminRole = Literal["super_admin", "platform_admin", "finance_admin", "support", "operator", "auditor", "readonly"]
AdminStatus = Literal["active", "inactive", "pending"]


class AdminLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class AdminCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    name: str = Field(..., min_length=1, max_length=200, pattern=r'^[a-zA-Z0-9_\u4e00-\u9fff]+$')
    role: AdminRole = "operator"


class AdminUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200, pattern=r'^[a-zA-Z0-9_\u4e00-\u9fff]+$')
    role: Optional[AdminRole] = None
    status: Optional[AdminStatus] = None
    permissions: Optional[Dict[str, Any]] = None


class AdminOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    status: str
    permissions: Optional[Dict[str, Any]]
    last_login_at: Optional[datetime]
    created_at: Optional[datetime]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


# ─── Login / profile ──────────────────────────────────────────────

@router.post("/login", summary="Admin login", description="Authenticate as admin user.")
async def admin_login(login_data: AdminLogin, request: Request, db: Session = Depends(get_db)):
    admin = db.query(AdminUser).filter(AdminUser.email == login_data.email).first()
    # admin 不存在也对 dummy hash 验一次，保持失败路径耗时一致
    password_hash = admin.password_hash if admin else _DUMMY_PASSWORD_HASH
    if not admin or not verify_password(login_data.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    admin.last_login_at = datetime.utcnow()
    admin.last_login_ip = request.client.host if request.client else "unknown"
    db.commit()

    access_token = create_access_token(
        data={"sub": admin.id, "email": admin.email, "role": admin.role},
        expires_delta=timedelta(hours=8),
        is_admin=True
    )
    return {
        "admin": {
            "id": admin.id,
            "email": admin.email,
            "name": admin.name,
            "role": admin.role,
            "permissions": get_admin_permissions(admin),
        },
        "access_token": access_token,
        "expires_in": 60 * 60 * 8,
    }


@router.get("/me", summary="Get admin profile", description="Get current admin user profile.")
async def get_admin_me(current_admin: AdminUser = Depends(get_current_admin)):
    return {
        "id": current_admin.id,
        "email": current_admin.email,
        "name": current_admin.name,
        "role": current_admin.role,
        "status": current_admin.status,
        "last_login_at": current_admin.last_login_at,
        "permissions": get_admin_permissions(current_admin),
    }


# ─── Admin account CRUD ───────────────────────────────────────────

def _admin_out(admin: AdminUser) -> dict:
    perms = None
    if admin.permissions:
        try:
            perms = json.loads(admin.permissions)
        except (json.JSONDecodeError, TypeError):
            perms = None
    return {
        "id": admin.id,
        "email": admin.email,
        "name": admin.name,
        "role": admin.role,
        "status": admin.status,
        "permissions": perms,
        "last_login_at": admin.last_login_at,
        "created_at": admin.created_at,
    }


@router.post("/admins", status_code=status.HTTP_201_CREATED, response_model=AdminOut, summary="Create admin", description="Create a new admin account.")
async def create_admin(
    admin_data: AdminCreate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    existing = db.query(AdminUser).filter(AdminUser.email == admin_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered as admin")

    if not validate_password_complexity(admin_data.password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters, contain at least one uppercase letter, one lowercase letter, and one digit."
        )

    admin = AdminUser(
        id=str(uuid.uuid4()),
        email=admin_data.email,
        name=admin_data.name,
        password_hash=get_password_hash(admin_data.password),
        role=admin_data.role,
        status="active",
        created_by=current_admin.id,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="CREATE_ADMIN",
        resource_type="admin",
        resource_id=admin.id,
        details=f"Created admin {admin.email} with role {admin.role}",
        risk_level="high",
    )
    db.add(log)
    db.commit()

    return _admin_out(admin)


@router.get("/admins", response_model=List[AdminOut], summary="List admins", description="List all admin accounts.")
async def list_admins(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    admins = db.query(AdminUser).order_by(AdminUser.created_at.desc()).all()
    return [_admin_out(a) for a in admins]


@router.get("/admins/{admin_id}", response_model=AdminOut, summary="Get admin", description="Get admin account details.")
async def get_admin(
    admin_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    admin = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")
    return _admin_out(admin)


@router.patch("/admins/{admin_id}", response_model=AdminOut, summary="Update admin", description="Update admin role, status, name or custom permissions.")
async def update_admin(
    admin_id: str,
    data: AdminUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    target = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    # Prevent self-lockout: a super_admin cannot be downgraded by non-super-admins,
    # and you cannot disable yourself.
    if target.id == current_admin.id:
        if data.status is not None and data.status != "active":
            raise HTTPException(status_code=400, detail="Cannot disable your own account")
        if data.role is not None and current_admin.role != "super_admin":
            raise HTTPException(status_code=403, detail="Cannot change your own role")

    if target.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can modify another super admin")

    if data.name is not None:
        target.name = data.name
    if data.role is not None:
        target.role = data.role
    if data.status is not None:
        target.status = data.status
    if data.permissions is not None:
        target.permissions = json.dumps(data.permissions, ensure_ascii=False)

    db.commit()
    db.refresh(target)

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="UPDATE_ADMIN",
        resource_type="admin",
        resource_id=admin_id,
        details=f"Updated admin {target.email}",
        risk_level="high",
    )
    db.add(log)
    db.commit()

    return _admin_out(target)


@router.delete("/admins/{admin_id}", summary="Delete admin", description="Delete an admin account.")
async def delete_admin(
    admin_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    target = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    if target.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if target.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can delete another super admin")

    db.delete(target)

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="DELETE_ADMIN",
        resource_type="admin",
        resource_id=admin_id,
        details=f"Deleted admin {target.email}",
        risk_level="high",
    )
    db.add(log)
    db.commit()

    return {"message": "Admin deleted"}
