from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Dict, Any

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import User, Note, Capsule, BrowserClip, KnowledgeUnit, AdminUser
from app.models.billing import Payment, Subscription
from app.models.llm_billing import UserBalance
from app.api.admin.endpoints.auth import get_current_admin

router = APIRouter()


class DailyPoint(BaseModel):
    date: str
    value: int


class ContentDistributionItem(BaseModel):
    name: str
    value: int


class SubscriptionTierItem(BaseModel):
    name: str
    value: int


class RevenueTrendItem(BaseModel):
    month: str
    revenue: float


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
    paidUserRatio: float

    revenueThisMonth: float
    revenueLastMonth: float
    revenueGrowthRate: float

    totalStorage: float
    avgStoragePerUser: float

    # Recharts 适配数据
    userGrowthTrend: List[DailyPoint]  # 最近 30 天
    contentDistribution: List[ContentDistributionItem]
    subscriptionDistribution: List[SubscriptionTierItem]
    revenueTrend: List[RevenueTrendItem]  # 最近 12 个月


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

    # 付费用户比例
    paid_users = db.query(func.count(User.id)).filter(
        User.subscription_tier == "storage"
    ).scalar() or 0
    paid_user_ratio = (paid_users / total_users * 100) if total_users > 0 else 0

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

    # ---- 收入统计 ----
    # 收入 = 成功支付的金额（分 -> 元）
    revenue_this_month = db.query(func.sum(Payment.amount)).filter(
        Payment.status == "success",
        Payment.created_at >= month_start
    ).scalar() or 0
    revenue_this_month = float(revenue_this_month) / 100.0

    revenue_last_month = db.query(func.sum(Payment.amount)).filter(
        Payment.status == "success",
        Payment.created_at >= last_month_start,
        Payment.created_at <= last_month_end
    ).scalar() or 0
    revenue_last_month = float(revenue_last_month) / 100.0

    revenue_growth_rate = (
        ((revenue_this_month - revenue_last_month) / revenue_last_month * 100)
        if revenue_last_month > 0 else (100 if revenue_this_month > 0 else 0)
    )

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

    # ---- Recharts 数据: 订阅分布 ----
    free_count = db.query(func.count(User.id)).filter(User.subscription_tier == "free").scalar() or 0
    storage_count = db.query(func.count(User.id)).filter(User.subscription_tier == "storage").scalar() or 0
    subscription_distribution = [
        SubscriptionTierItem(name="Free", value=free_count),
        SubscriptionTierItem(name="Storage", value=storage_count),
    ]

    # ---- Recharts 数据: 收入趋势（最近 12 个月）----
    revenue_trend: List[RevenueTrendItem] = []
    for i in range(11, -1, -1):
        # 计算第 i 个月前的那一个月
        month_date = today_start.replace(day=1) - timedelta(days=i * 30)
        # 更精确地计算：回到第 i 个月前
        month_idx = (today_start.year * 12 + today_start.month - 1) - i
        year = month_idx // 12
        month = (month_idx % 12) + 1
        month_start_dt = datetime(year, month, 1)
        if month == 12:
            month_end_dt = datetime(year + 1, 1, 1) - timedelta(seconds=1)
        else:
            month_end_dt = datetime(year, month + 1, 1) - timedelta(seconds=1)

        rev = db.query(func.sum(Payment.amount)).filter(
            Payment.status == "success",
            Payment.created_at >= month_start_dt,
            Payment.created_at <= month_end_dt
        ).scalar() or 0
        revenue_trend.append(RevenueTrendItem(
            month=month_start_dt.strftime("%Y-%m"),
            revenue=float(rev) / 100.0
        ))

    return DashboardStatsResponse(
        totalUsers=total_users,
        newUsersToday=new_users_today,
        newUsersThisWeek=new_users_this_week,
        newUsersThisMonth=new_users_this_month,
        userGrowthRate=round(user_growth_rate, 1),
        totalContent=total_content,
        newContentToday=new_content_today,
        activeUsers7d=active_users_7d,
        paidUserRatio=round(paid_user_ratio, 1),
        revenueThisMonth=round(revenue_this_month, 2),
        revenueLastMonth=round(revenue_last_month, 2),
        revenueGrowthRate=round(revenue_growth_rate, 1),
        totalStorage=float(total_storage),
        avgStoragePerUser=float(avg_storage),
        userGrowthTrend=user_growth_trend,
        contentDistribution=content_distribution,
        subscriptionDistribution=subscription_distribution,
        revenueTrend=revenue_trend,
    )


# ─── Unified admin + membership overview ──────────────────────────

class AdminRoleItem(BaseModel):
    role: str
    count: int


class SystemOverviewResponse(BaseModel):
    totalMembers: int
    activeMembers: int
    bannedMembers: int
    paidMembers: int
    freeMembers: int
    totalAdmins: int
    activeAdmins: int
    pendingAdmins: int
    adminRoleDistribution: List[AdminRoleItem]
    totalBalance: float
    totalRevenue: float


@router.get("/system-overview", response_model=SystemOverviewResponse, summary="System overview", description="Unified overview of members and admin staff.")
async def system_overview(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.USERS_READ)),
):
    total_members = db.query(func.count(User.id)).scalar() or 0
    active_members = db.query(func.count(User.id)).filter(User.status == "active").scalar() or 0
    banned_members = db.query(func.count(User.id)).filter(User.status == "banned").scalar() or 0
    paid_members = db.query(func.count(User.id)).filter(User.subscription_tier == "storage").scalar() or 0
    free_members = db.query(func.count(User.id)).filter(User.subscription_tier == "free").scalar() or 0

    total_admins = db.query(func.count(AdminUser.id)).scalar() or 0
    active_admins = db.query(func.count(AdminUser.id)).filter(AdminUser.status == "active").scalar() or 0
    pending_admins = db.query(func.count(AdminUser.id)).filter(AdminUser.status == "pending").scalar() or 0

    role_dist = (
        db.query(AdminUser.role, func.count(AdminUser.id))
        .group_by(AdminUser.role)
        .all()
    )

    total_balance = db.query(func.sum(UserBalance.balance)).scalar() or 0
    total_revenue = db.query(func.sum(Payment.amount)).filter(Payment.status == "success").scalar() or 0

    return SystemOverviewResponse(
        totalMembers=total_members,
        activeMembers=active_members,
        bannedMembers=banned_members,
        paidMembers=paid_members,
        freeMembers=free_members,
        totalAdmins=total_admins,
        activeAdmins=active_admins,
        pendingAdmins=pending_admins,
        adminRoleDistribution=[AdminRoleItem(role=r, count=c) for r, c in role_dist],
        totalBalance=float(total_balance),
        totalRevenue=float(total_revenue) / 100.0,
    )
