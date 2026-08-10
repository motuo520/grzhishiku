from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime
import uuid
import secrets
import string

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import User, Note, Capsule, AdminAuditLog, AdminUser
from app.models.sync import SyncDevice, SyncSnapshot
from app.core.security import get_password_hash, validate_password_complexity

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────────────

class UserListItem(BaseModel):
    id: str
    email: str
    username: Optional[str] = ""
    display_name: Optional[str] = ""
    status: str
    notes_count: int = 0
    capsules_count: int = 0
    sync_devices_count: int = 0
    last_sync_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class UserDetailResponse(BaseModel):
    id: str
    email: str
    username: Optional[str] = ""
    display_name: Optional[str] = ""
    avatar: Optional[str] = ""
    status: str
    storage_used: int = 0
    storage_limit: int = 0
    notes_count: int = 0
    capsules_count: int = 0
    sync_devices_count: int = 0
    last_sync_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class UserStatusUpdate(BaseModel):
    status: Literal["active", "inactive", "banned"]


class ResetPasswordResponse(BaseModel):
    temporary_password: str
    message: str


class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[UserListItem]


# ─── Helpers ──────────────────────────────────────────────────────

def _get_sync_stats(db: Session, user_id: str):
    devices_count = (
        db.query(func.count(SyncDevice.id)).filter(SyncDevice.user_id == user_id).scalar() or 0
    )
    latest_snapshot = (
        db.query(SyncSnapshot)
        .filter(SyncSnapshot.user_id == user_id)
        .order_by(SyncSnapshot.created_at.desc())
        .first()
    )
    last_sync_at = latest_snapshot.created_at if latest_snapshot else None
    return devices_count, last_sync_at


def _user_list_item(db: Session, user: User) -> UserListItem:
    notes_count = db.query(func.count(Note.id)).filter(Note.user_id == user.id).scalar() or 0
    capsules_count = db.query(func.count(Capsule.id)).filter(Capsule.user_id == user.id).scalar() or 0
    sync_devices_count, last_sync_at = _get_sync_stats(db, user.id)
    return UserListItem(
        id=user.id,
        email=user.email,
        username=user.username or "",
        display_name=user.display_name or "",
        status=user.status,
        notes_count=notes_count,
        capsules_count=capsules_count,
        sync_devices_count=sync_devices_count,
        last_sync_at=last_sync_at,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


# ─── Member list / search ─────────────────────────────────────────

@router.get("/", response_model=UserListResponse, summary="List members", description="List all members (users) with content/sync stats, search and pagination.")
async def list_users(
    q: Optional[str] = Query(None, description="Search email / username / display_name"),
    status: Optional[str] = Query(None, description="Filter by status: active / inactive / banned"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_READ)),
):
    query = db.query(User)
    if q:
        escaped_q = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped_q}%"
        query = query.filter(
            (User.email.ilike(like, escape="\\"))
            | (User.username.ilike(like, escape="\\"))
            | (User.display_name.ilike(like, escape="\\"))
        )
    if status:
        query = query.filter(User.status == status)

    total = query.count()
    users = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # 批量聚合统计数据，避免 N+1
    user_ids = [u.id for u in users]
    notes_counts = dict(db.query(Note.user_id, func.count(Note.id)).filter(Note.user_id.in_(user_ids)).group_by(Note.user_id).all()) if user_ids else {}
    capsules_counts = dict(db.query(Capsule.user_id, func.count(Capsule.id)).filter(Capsule.user_id.in_(user_ids)).group_by(Capsule.user_id).all()) if user_ids else {}
    sync_devices_counts = dict(db.query(SyncDevice.user_id, func.count(SyncDevice.id)).filter(SyncDevice.user_id.in_(user_ids)).group_by(SyncDevice.user_id).all()) if user_ids else {}
    last_syncs = dict(db.query(SyncSnapshot.user_id, func.max(SyncSnapshot.created_at)).filter(SyncSnapshot.user_id.in_(user_ids)).group_by(SyncSnapshot.user_id).all()) if user_ids else {}

    items = [
        UserListItem(
            id=u.id,
            email=u.email,
            username=u.username or "",
            display_name=u.display_name or "",
            status=u.status,
            notes_count=notes_counts.get(u.id, 0),
            capsules_count=capsules_counts.get(u.id, 0),
            sync_devices_count=sync_devices_counts.get(u.id, 0),
            last_sync_at=last_syncs.get(u.id),
            created_at=u.created_at,
            last_login_at=u.last_login_at,
        )
        for u in users
    ]

    return UserListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items,
    )


# ─── Member detail ────────────────────────────────────────────────

@router.get("/{user_id}", response_model=UserDetailResponse, summary="Get member details", description="Get full member profile with content/sync stats.")
async def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_READ)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    notes_count = db.query(func.count(Note.id)).filter(Note.user_id == user.id).scalar() or 0
    capsules_count = db.query(func.count(Capsule.id)).filter(Capsule.user_id == user.id).scalar() or 0
    sync_devices_count, last_sync_at = _get_sync_stats(db, user.id)

    return UserDetailResponse(
        id=user.id,
        email=user.email,
        username=user.username or "",
        display_name=user.display_name or "",
        avatar=user.avatar or "",
        status=user.status,
        storage_used=user.storage_used or 0,
        storage_limit=user.storage_limit or 0,
        notes_count=notes_count,
        capsules_count=capsules_count,
        sync_devices_count=sync_devices_count,
        last_sync_at=last_sync_at,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


# ─── Member status ────────────────────────────────────────────────

@router.patch("/{user_id}/status", summary="Update member status", description="Update member status (active / inactive / banned).")
async def update_user_status(
    user_id: str,
    data: UserStatusUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_WRITE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_status = user.status
    user.status = data.status

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="UPDATE_USER_STATUS",
        resource_type="user",
        resource_id=user_id,
        details=f"Changed status from {old_status} to {data.status}",
        risk_level="medium" if data.status == "banned" else "low",
    )
    db.add(log)
    db.commit()

    return {"message": "User status updated", "new_status": data.status}


# ─── Delete member ────────────────────────────────────────────────

@router.delete("/{user_id}", summary="Delete member", description="Delete a member and their associated content.")
async def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_WRITE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Clean up user content
    db.query(Note).filter(Note.user_id == user_id).delete(synchronize_session=False)
    db.query(Capsule).filter(Capsule.user_id == user_id).delete(synchronize_session=False)
    db.delete(user)

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="DELETE_USER",
        resource_type="user",
        resource_id=user_id,
        details=f"Deleted user {user.email}",
        risk_level="high",
    )
    db.add(log)
    db.commit()

    return {"message": "User deleted"}


# ─── Reset password ───────────────────────────────────────────────

@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse, summary="Reset member password", description="Generate a temporary password for a member.")
async def reset_user_password(
    user_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_WRITE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 生成满足复杂度要求的临时密码
    while True:
        temp_password = "".join(secrets.choice(string.ascii_letters + string.digits + string.punctuation) for _ in range(12))
        if validate_password_complexity(temp_password):
            break
    user.password_hash = get_password_hash(temp_password)

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="RESET_USER_PASSWORD",
        resource_type="user",
        resource_id=user_id,
        details=f"Reset password for user {user.email}",
        risk_level="high",
    )
    db.add(log)
    db.commit()

    return {"temporary_password": temp_password, "message": "Password reset successfully"}
