from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid
import secrets
import string
import json

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import User, Note, Capsule, AdminAuditLog, AdminUser
from app.models.llm_billing import UserBalance, BalanceTransaction, LLMUsageRecord
from app.models.billing import Subscription, Plan
from app.api.admin.endpoints.auth import get_current_admin
from app.core.security import get_password_hash, validate_password_complexity
from app.services.billing_service import BillingService

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────────────

class UserListItem(BaseModel):
    id: str
    email: str
    username: Optional[str] = ""
    display_name: Optional[str] = ""
    status: str
    subscription_tier: Optional[str] = "free"
    subscription_status: Optional[str] = ""
    balance: float = 0.0
    total_used: float = 0.0
    notes_count: int = 0
    capsules_count: int = 0
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class UserDetailResponse(BaseModel):
    id: str
    email: str
    username: Optional[str] = ""
    display_name: Optional[str] = ""
    avatar: Optional[str] = ""
    status: str
    subscription_tier: Optional[str] = "free"
    subscription_status: Optional[str] = ""
    subscription_expires_at: Optional[datetime] = None
    storage_used: int = 0
    storage_limit: int = 0
    balance: float = 0.0
    frozen: float = 0.0
    total_deposited: float = 0.0
    total_used: float = 0.0
    notes_count: int = 0
    capsules_count: int = 0
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class UserStatusUpdate(BaseModel):
    status: str


class UserTierUpdate(BaseModel):
    tier: str = Field(..., description="Plan slug, e.g. free / storage")


class ResetPasswordResponse(BaseModel):
    temporary_password: str
    message: str


class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[UserListItem]


# ─── Helpers ──────────────────────────────────────────────────────

def _get_user_balance(db: Session, user_id: str) -> UserBalance:
    balance = db.query(UserBalance).filter(UserBalance.user_id == user_id).first()
    if not balance:
        return UserBalance(balance=0, frozen=0, total_deposited=0, total_used=0)
    return balance


def _user_list_item(db: Session, user: User) -> UserListItem:
    notes_count = db.query(func.count(Note.id)).filter(Note.user_id == user.id).scalar() or 0
    capsules_count = db.query(func.count(Capsule.id)).filter(Capsule.user_id == user.id).scalar() or 0
    balance = _get_user_balance(db, user.id)
    return UserListItem(
        id=user.id,
        email=user.email,
        username=user.username or "",
        display_name=user.display_name or "",
        status=user.status,
        subscription_tier=user.subscription_tier or "free",
        subscription_status=user.subscription_status or "",
        balance=float(balance.balance or 0),
        total_used=float(balance.total_used or 0),
        notes_count=notes_count,
        capsules_count=capsules_count,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


# ─── Member list / search ─────────────────────────────────────────

@router.get("/", response_model=UserListResponse, summary="List members", description="List all members (users) with subscription/balance info, search and pagination.")
async def list_users(
    q: Optional[str] = Query(None, description="Search email / username / display_name"),
    status: Optional[str] = Query(None, description="Filter by status: active / inactive / banned"),
    tier: Optional[str] = Query(None, description="Filter by subscription tier"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_READ)),
):
    query = db.query(User)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (User.email.ilike(like))
            | (User.username.ilike(like))
            | (User.display_name.ilike(like))
        )
    if status:
        query = query.filter(User.status == status)
    if tier:
        query = query.filter(User.subscription_tier == tier)

    total = query.count()
    users = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return UserListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[_user_list_item(db, u) for u in users],
    )


# ─── Member detail ────────────────────────────────────────────────

@router.get("/{user_id}", response_model=UserDetailResponse, summary="Get member details", description="Get full member profile including subscription and balance.")
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
    balance = _get_user_balance(db, user.id)

    return UserDetailResponse(
        id=user.id,
        email=user.email,
        username=user.username or "",
        display_name=user.display_name or "",
        avatar=user.avatar or "",
        status=user.status,
        subscription_tier=user.subscription_tier or "free",
        subscription_status=user.subscription_status or "",
        subscription_expires_at=user.subscription_expires_at,
        storage_used=user.storage_used or 0,
        storage_limit=user.storage_limit or 0,
        balance=float(balance.balance or 0),
        frozen=float(balance.frozen or 0),
        total_deposited=float(balance.total_deposited or 0),
        total_used=float(balance.total_used or 0),
        notes_count=notes_count,
        capsules_count=capsules_count,
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


# ─── Member subscription tier ─────────────────────────────────────

@router.patch("/{user_id}/tier", summary="Update member tier", description="Manually update a member's subscription tier/plan.")
async def update_user_tier(
    user_id: str,
    data: UserTierUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_WRITE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    plan = db.query(Plan).filter(Plan.slug == data.tier).first()
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid tier")

    # Cancel any active subscription
    active_sub = db.query(Subscription).filter(
        Subscription.user_id == user_id,
        Subscription.status.in_(["active", "trial"]),
    ).first()
    if active_sub:
        active_sub.status = "cancelled"
        active_sub.cancelled_at = datetime.utcnow()
        active_sub.cancel_reason = "admin_tier_change"
        active_sub.auto_renew = False

    billing = BillingService(db)
    billing.create_subscription(
        user_id=user_id,
        plan_id=plan.id,
        billing_cycle="monthly",
        payment_method="admin_manual",
    )

    log = AdminAuditLog(
        id=str(uuid.uuid4()),
        admin_id=current_admin.id,
        action="UPDATE_USER_TIER",
        resource_type="user",
        resource_id=user_id,
        details=f"Changed tier to {data.tier} for user {user.email}",
        risk_level="high",
    )
    db.add(log)
    db.commit()

    return {"message": "Tier updated", "tier": data.tier}


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

    # Clean up user content and dependent billing records
    db.query(Note).filter(Note.user_id == user_id).delete(synchronize_session=False)
    db.query(Capsule).filter(Capsule.user_id == user_id).delete(synchronize_session=False)
    db.query(LLMUsageRecord).filter(LLMUsageRecord.user_id == user_id).delete(synchronize_session=False)
    db.query(BalanceTransaction).filter(BalanceTransaction.user_id == user_id).delete(synchronize_session=False)
    db.query(UserBalance).filter(UserBalance.user_id == user_id).delete(synchronize_session=False)
    db.query(Subscription).filter(Subscription.user_id == user_id).delete(synchronize_session=False)
    # Keep payment/invoices for audit; delete user record
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

    temp_password = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12))
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
