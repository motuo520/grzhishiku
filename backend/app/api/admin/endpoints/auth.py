from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta
import threading
import time
from typing import Optional, List, Dict, Any, Literal
import json
import uuid

from app.core.database import get_db
from app.core.audit import audit_request_meta, record_login_event
from app.core.security import verify_password, get_password_hash, create_access_token, decode_token, validate_password_complexity
from app.core.admin_permissions import get_admin_permissions, Permission, require_permission
from app.models.base import AdminUser, AdminAuditLog
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

router = APIRouter()
admin_security = HTTPBearer(auto_error=False)

# 管理员登录失败锁定（进程内内存版；多 worker 需换 Redis/网关限流）
_LOGIN_LOCK = threading.Lock()
_LOGIN_FAILURES: Dict[str, tuple] = {}
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_SECONDS = 15 * 60

# 固定 dummy bcrypt hash：账号不存在时也执行一次 verify_password，
# 抹平「邮箱是否注册」的响应时序差，防登录接口用户枚举
_DUMMY_PASSWORD_HASH = "$2b$12$qE4.oSZdBERv/iREWKuaPOnbb.2.Wo0ovWDFzTie0S9CFtkrVyCUK"


def _login_key(email: str, ip: str) -> str:
    return f"{email.strip().lower()}:{ip}"


def _login_is_locked(key: str) -> bool:
    now = time.monotonic()
    with _LOGIN_LOCK:
        info = _LOGIN_FAILURES.get(key)
        if not info:
            return False
        count, locked_until = info
        if locked_until and now < locked_until:
            return True
        if locked_until and now >= locked_until:
            _LOGIN_FAILURES.pop(key, None)
        return False


def _login_record_failure(key: str) -> None:
    now = time.monotonic()
    with _LOGIN_LOCK:
        count, _ = _LOGIN_FAILURES.get(key, (0, 0))
        count += 1
        locked_until = now + LOGIN_LOCK_SECONDS if count >= LOGIN_MAX_FAILURES else 0
        _LOGIN_FAILURES[key] = (count, locked_until)

        if len(_LOGIN_FAILURES) > 10000:
            for k in list(_LOGIN_FAILURES.keys()):
                _, expires = _LOGIN_FAILURES[k]
                if expires and now >= expires:
                    _LOGIN_FAILURES.pop(k, None)


def _login_clear_failures(key: str) -> None:
    with _LOGIN_LOCK:
        _LOGIN_FAILURES.pop(key, None)


def _get_client_ip(request: Request) -> str:
    """审计用真实 IP：与 security_middleware._get_client_ip 同口径——仅在可信代理时
    取 XFF 末段。09-30 安全批：此前取 XFF 首段，客户端可任意伪造——锁定名单被随机
    XFF 绕过，且攻击者可用受害者 IP 当 key 定点锁死管理员。"""
    from app.core.security_middleware import _get_client_ip as _trusted_client_ip
    return _trusted_client_ip(request)


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
    client_ip = _get_client_ip(request)
    login_key = _login_key(login_data.email, client_ip)

    if _login_is_locked(login_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")

    admin = db.query(AdminUser).filter(AdminUser.email == login_data.email).first()
    # admin 不存在也对 dummy hash 验一次，保持失败路径耗时一致
    password_hash = admin.password_hash if admin else _DUMMY_PASSWORD_HASH
    if not admin or not verify_password(login_data.password, password_hash):
        _login_record_failure(login_key)
        record_login_event(
            db, request, email=login_data.email, success=False, portal="admin",
            user_id=admin.id if admin else None,
            reason="user_not_found" if not admin else "wrong_password",
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # 非 active 登录即拒（此前照常签 8h token，靠接口侧 403 兜底——
    # token 已流出，10-01 审计实捕）
    if admin.status != "active":
        raise HTTPException(status_code=403, detail="账号未激活或已停用，请联系超级管理员")

    admin.last_login_at = datetime.utcnow()
    admin.last_login_ip = client_ip
    db.commit()
    _login_clear_failures(login_key)
    record_login_event(db, request, email=admin.email, success=True, portal="admin", user_id=admin.id)

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
    request: Request,
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

    # 仅 super_admin 可创建 super_admin，防止提权
    if admin_data.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can create a super admin")

    admin = AdminUser(
        id=str(uuid.uuid4()),
        email=admin_data.email,
        name=admin_data.name,
        password_hash=get_password_hash(admin_data.password),
        role=admin_data.role,
        status="active",
        created_by=current_admin.id,
    )
    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="CREATE_ADMIN",
        resource_type="admin",
        resource_id=admin.id,
        after_state=json.dumps({"email": admin.email, "name": admin.name, "role": admin.role}, ensure_ascii=False),
        details=f"Created admin {admin.email} with role {admin.role}",
        risk_level="high",
        **audit_request_meta(request),
    )
    db.add(admin)
    db.add(log)
    db.commit()
    db.refresh(admin)

    return _admin_out(admin)


@router.get("/admins", response_model=List[AdminOut], summary="List admins", description="List all admin accounts.")
async def list_admins(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    admins = db.query(AdminUser).filter(AdminUser.status != "deleted").order_by(AdminUser.created_at.desc()).all()
    return [_admin_out(a) for a in admins]


@router.get("/admins/{admin_id}", response_model=AdminOut, summary="Get admin", description="Get admin account details.")
async def get_admin(
    admin_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    admin = db.query(AdminUser).filter(AdminUser.id == admin_id, AdminUser.status != "deleted").first()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")
    return _admin_out(admin)


@router.patch("/admins/{admin_id}", response_model=AdminOut, summary="Update admin", description="Update admin role, status, name or custom permissions.")
async def update_admin(
    admin_id: str,
    data: AdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    target = db.query(AdminUser).filter(AdminUser.id == admin_id, AdminUser.status != "deleted").first()
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
    # 非 super_admin 不能授予 super_admin 角色或改自定义权限
    if data.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can assign the super_admin role")
    if data.permissions is not None and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can modify custom permissions")

    # 改动留痕：只记本次实际变更字段的新旧值
    _before = {}
    _after = {}
    if data.name is not None:
        _before["name"], _after["name"] = target.name, data.name
        target.name = data.name
    if data.role is not None:
        _before["role"], _after["role"] = target.role, data.role
        target.role = data.role
    if data.status is not None:
        _before["status"], _after["status"] = target.status, data.status
        target.status = data.status
    if data.permissions is not None:
        _before["permissions"], _after["permissions"] = target.permissions, json.dumps(data.permissions, ensure_ascii=False)
        target.permissions = _after["permissions"]

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="UPDATE_ADMIN",
        resource_type="admin",
        resource_id=admin_id,
        before_state=json.dumps(_before, ensure_ascii=False) if _before else None,
        after_state=json.dumps(_after, ensure_ascii=False) if _after else None,
        details=f"Updated admin {target.email}",
        risk_level="high",
        **audit_request_meta(request),
    )
    db.add(log)
    db.commit()
    db.refresh(target)

    return _admin_out(target)


@router.delete("/admins/{admin_id}", summary="Delete admin", description="Delete an admin account.")
async def delete_admin(
    admin_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.ADMINS_MANAGE)),
):
    target = db.query(AdminUser).filter(AdminUser.id == admin_id, AdminUser.status != "deleted").first()
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    if target.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if target.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can delete another super admin")

    # 软删除，保留审计关联与历史责任主体（先留旧值再改，供 before_state）
    _before = {"status": target.status, "email": target.email, "role": target.role}
    target.status = "deleted"

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="DELETE_ADMIN",
        resource_type="admin",
        resource_id=admin_id,
        before_state=json.dumps(_before, ensure_ascii=False),
        after_state=json.dumps({"status": "deleted"}, ensure_ascii=False),
        details=f"Deleted admin {target.email}",
        risk_level="high",
        **audit_request_meta(request),
    )
    db.add(log)
    db.commit()

    return {"message": "Admin deleted"}
