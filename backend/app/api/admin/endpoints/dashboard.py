from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import User, Note, Capsule, BrowserClip, KnowledgeUnit, AdminUser
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()


class DailyPoint(BaseModel):
    date: str
    value: int


class ContentDistributionItem(BaseModel):
    name: str
    value: int


class DashboardStatsResponse(BaseModel):
    # 核心数字
    totalUsers: int
    newUsersToday: int
    newUsersThisWeek: int
    newUsersThisMonth: int
    userGrowthRate: float  # 较昨日/上周/上月，这里用较上月

    totalContent: int
    newContentToday: int

    activeUsers7d: int

    totalStorage: float
    avgStoragePerUser: float

    # Recharts 适配数据
    userGrowthTrend: List[DailyPoint]  # 最近 30 天
    contentDistribution: List[ContentDistributionItem]


@router.get("/stats", response_model=DashboardStatsResponse, summary="Dashboard statistics", description="Get system overview statistics with chart-ready data.")
async def get_stats(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(get_current_admin)
):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    week_start = today_start - timedelta(days=now.weekday())
    month_start = today_start.replace(day=1)
    last_month_start = (month_start - timedelta(days=1)).replace(day=1)
    last_month_end = month_start - timedelta(seconds=1)
    days_7_ago = today_start - timedelta(days=7)
    days_30_ago = today_start - timedelta(days=30)

    # ---- 用户统计 ----
    total_users = db.query(func.count(User.id)).scalar() or 0

    new_users_today = db.query(func.count(User.id)).filter(
        User.created_at >= today_start
    ).scalar() or 0

    new_users_this_week = db.query(func.count(User.id)).filter(
        User.created_at >= week_start
    ).scalar() or 0

    new_users_this_month = db.query(func.count(User.id)).filter(
        User.created_at >= month_start
    ).scalar() or 0

    new_users_last_month = db.query(func.count(User.id)).filter(
        User.created_at >= last_month_start,
        User.created_at <= last_month_end
    ).scalar() or 0

    user_growth_rate = (
        ((new_users_this_month - new_users_last_month) / new_users_last_month * 100)
        if new_users_last_month > 0 else (100 if new_users_this_month > 0 else 0)
    )

    # 活跃用户（7 天内登录）
    active_users_7d = db.query(func.count(func.distinct(User.id))).filter(
        User.last_login_at >= days_7_ago
    ).scalar() or 0

    # ---- 内容统计 ----
    total_notes = db.query(func.count(Note.id)).scalar() or 0
    total_clips = db.query(func.count(BrowserClip.id)).scalar() or 0
    total_knowledge = db.query(func.count(KnowledgeUnit.id)).scalar() or 0
    total_capsules = db.query(func.count(Capsule.id)).scalar() or 0
    total_content = total_notes + total_clips + total_knowledge + total_capsules

    new_notes_today = db.query(func.count(Note.id)).filter(Note.created_at >= today_start).scalar() or 0
    new_clips_today = db.query(func.count(BrowserClip.id)).filter(BrowserClip.created_at >= today_start).scalar() or 0
    new_knowledge_today = db.query(func.count(KnowledgeUnit.id)).filter(KnowledgeUnit.created_at >= today_start).scalar() or 0
    new_capsules_today = db.query(func.count(Capsule.id)).filter(Capsule.created_at >= today_start).scalar() or 0
    new_content_today = new_notes_today + new_clips_today + new_knowledge_today + new_capsules_today

    # ---- 存储 ----
    total_storage = db.query(func.sum(User.storage_used)).scalar() or 0
    avg_storage = (total_storage / total_users) if total_users > 0 else 0

    # ---- Recharts 数据: 用户增长趋势（最近 30 天）----
    user_growth_trend: List[DailyPoint] = []
    for i in range(29, -1, -1):
        day_start = today_start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        count = db.query(func.count(User.id)).filter(
            User.created_at >= day_start,
            User.created_at < day_end
        ).scalar() or 0
        user_growth_trend.append(DailyPoint(
            date=day_start.strftime("%m-%d"),
            value=count
        ))

    # ---- Recharts 数据: 内容分布 ----
    content_distribution = [
        ContentDistributionItem(name="笔记", value=total_notes),
        ContentDistributionItem(name="剪藏", value=total_clips),
        ContentDistributionItem(name="知识", value=total_knowledge),
        ContentDistributionItem(name="胶囊", value=total_capsules),
    ]

    return DashboardStatsResponse(
        totalUsers=total_users,
        newUsersToday=new_users_today,
        newUsersThisWeek=new_users_this_week,
        newUsersThisMonth=new_users_this_month,
        userGrowthRate=round(user_growth_rate, 1),
        totalContent=total_content,
        newContentToday=new_content_today,
        activeUsers7d=active_users_7d,
        totalStorage=float(total_storage),
        avgStoragePerUser=float(avg_storage),
        userGrowthTrend=user_growth_trend,
        contentDistribution=content_distribution,
    )


# ─── Unified admin + membership overview ──────────────────────────

class AdminRoleItem(BaseModel):
    role: str
    count: int


class SystemOverviewResponse(BaseModel):
    totalMembers: int
    activeMembers: int
    bannedMembers: int
    totalAdmins: int
    activeAdmins: int
    pendingAdmins: int
    adminRoleDistribution: List[AdminRoleItem]


@router.get("/system-overview", response_model=SystemOverviewResponse, summary="System overview", description="Unified overview of members and admin staff.")
async def system_overview(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_READ)),
):
    total_members = db.query(func.count(User.id)).scalar() or 0
    active_members = db.query(func.count(User.id)).filter(User.status == "active").scalar() or 0
    banned_members = db.query(func.count(User.id)).filter(User.status == "banned").scalar() or 0

    total_admins = db.query(func.count(AdminUser.id)).scalar() or 0
    active_admins = db.query(func.count(AdminUser.id)).filter(AdminUser.status == "active").scalar() or 0
    pending_admins = db.query(func.count(AdminUser.id)).filter(AdminUser.status == "pending").scalar() or 0

    role_dist = (
        db.query(AdminUser.role, func.count(AdminUser.id))
        .group_by(AdminUser.role)
        .all()
    )

    return SystemOverviewResponse(
        totalMembers=total_members,
        activeMembers=active_members,
        bannedMembers=banned_members,
        totalAdmins=total_admins,
        activeAdmins=active_admins,
        pendingAdmins=pending_admins,
        adminRoleDistribution=[AdminRoleItem(role=r, count=c) for r, c in role_dist],
    )
