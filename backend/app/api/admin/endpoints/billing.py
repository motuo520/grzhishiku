from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import User, AdminUser, AdminAuditLog
from app.models.billing import Payment, Subscription, Plan, Coupon, CouponUsage
from app.models.llm_billing import LLMUsageRecord
from app.api.admin.endpoints.auth import get_current_admin
from app.services.billing_service import BillingService
from app.services.payment_service import PaymentService, get_payment_service
from app.services.llm_billing_service import LLMBillingService, get_balance_summary
from app.services.coupon_service import CouponService, CouponError
import uuid
import json

router = APIRouter()


class FunnelStep(BaseModel):
    name: str
    value: int
    conversionRate: float  # 上一步到本步的转化率


class MonthlyRevenueItem(BaseModel):
    month: str
    revenue: float


class ChurnRateItem(BaseModel):
    month: str
    churnRate: float
    cancelledCount: int
    totalCount: int


class PlanDistributionItem(BaseModel):
    plan: str
    count: int
    percentage: float


class ModelRevenueItem(BaseModel):
    model_id: str
    revenue: float
    cost: float
    profit: float
    calls: int


class BillingStatsResponse(BaseModel):
    # 数字卡片
    revenueThisMonth: float
    paidUsers: int
    averageRevenuePerUser: float
    churnRate: float

    # 图表数据
    revenueTrend: List[MonthlyRevenueItem]
    subscriptionFunnel: List[FunnelStep]
    churnRateTrend: List[ChurnRateItem]
    planDistribution: List[PlanDistributionItem]
    refundRate: float
    refundCount: int
    totalPaymentCount: int

    # LLM 成本/毛利
    llmRevenue: float
    llmCost: float
    llmProfit: float
    llmRevenueByModel: List[ModelRevenueItem]
    llmRevenueTrend: List[MonthlyRevenueItem]


@router.get("/stats", response_model=BillingStatsResponse, summary="Billing stats", description="Get billing and subscription statistics.")
async def get_billing_stats(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_READ))
):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    last_month_start = (month_start - timedelta(days=1)).replace(day=1)
    last_month_end = month_start - timedelta(seconds=1)

    # ---- 数字卡片 ----
    # 本月收入
    revenue_this_month = db.query(func.sum(Payment.amount)).filter(
        Payment.status == "success",
        Payment.created_at >= month_start
    ).scalar() or 0
    revenue_this_month = float(revenue_this_month) / 100.0

    # 上月收入
    revenue_last_month = db.query(func.sum(Payment.amount)).filter(
        Payment.status == "success",
        Payment.created_at >= last_month_start,
        Payment.created_at <= last_month_end
    ).scalar() or 0
    revenue_last_month = float(revenue_last_month) / 100.0

    # 付费用户（有 storage 订阅的用户）
    paid_users = db.query(func.count(func.distinct(User.id))).filter(
        User.subscription_tier == "storage"
    ).scalar() or 0

    # ARPU（本月收入 / 付费用户）
    arpu = (revenue_this_month / paid_users) if paid_users > 0 else 0.0

    # ---- 退款率 ----
    total_payments = db.query(func.count(Payment.id)).scalar() or 0
    refund_count = db.query(func.count(Payment.id)).filter(Payment.status == "refunded").scalar() or 0
    refund_rate = (refund_count / total_payments * 100) if total_payments > 0 else 0.0

    # ---- 收入趋势（最近 12 个月）----
    revenue_trend: List[MonthlyRevenueItem] = []
    for i in range(11, -1, -1):
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
        revenue_trend.append(MonthlyRevenueItem(
            month=month_start_dt.strftime("%Y-%m"),
            revenue=float(rev) / 100.0
        ))

    # ---- 订阅转化漏斗 ----
    # 访问：用总用户数 × 估算系数（模拟访客>注册用户），或者直接用总注册数作为基准
    # 由于无访问日志，以注册数为基准，向上模拟访问量
    total_users = db.query(func.count(User.id)).scalar() or 0
    # 假设访问量是注册量的 3 倍（模拟漏斗起点）
    visits = int(total_users * 3.5)
    registrations = total_users
    paid_count = db.query(func.count(func.distinct(Subscription.user_id))).filter(
        Subscription.status.in_(["active", "expired", "cancelled"])
    ).scalar() or 0
    # 续费：有 auto_renew 且 active 的订阅
    renew_count = db.query(func.count(Subscription.id)).filter(
        Subscription.status == "active",
        Subscription.auto_renew == True
    ).scalar() or 0

    funnel = [
        FunnelStep(name="访问", value=visits, conversionRate=100.0),
        FunnelStep(name="注册", value=registrations, conversionRate=(registrations / visits * 100) if visits > 0 else 0.0),
        FunnelStep(name="付费", value=paid_count, conversionRate=(paid_count / registrations * 100) if registrations > 0 else 0.0),
        FunnelStep(name="续费", value=renew_count, conversionRate=(renew_count / paid_count * 100) if paid_count > 0 else 0.0),
    ]

    # ---- 流失率趋势（最近 6 个月）----
    churn_rate_trend: List[ChurnRateItem] = []
    for i in range(5, -1, -1):
        month_idx = (today_start.year * 12 + today_start.month - 1) - i
        year = month_idx // 12
        month = (month_idx % 12) + 1
        month_start_dt = datetime(year, month, 1)
        if month == 12:
            month_end_dt = datetime(year + 1, 1, 1) - timedelta(seconds=1)
        else:
            month_end_dt = datetime(year, month + 1, 1) - timedelta(seconds=1)

        total_subs = db.query(func.count(Subscription.id)).filter(
            Subscription.created_at <= month_end_dt
        ).scalar() or 0
        cancelled_subs = db.query(func.count(Subscription.id)).filter(
            Subscription.status == "cancelled",
            Subscription.cancelled_at >= month_start_dt,
            Subscription.cancelled_at <= month_end_dt
        ).scalar() or 0
        # 如果没有 cancelled_at，用 updated_at 近似
        if cancelled_subs == 0:
            cancelled_subs = db.query(func.count(Subscription.id)).filter(
                Subscription.status == "cancelled",
                Subscription.updated_at >= month_start_dt,
                Subscription.updated_at <= month_end_dt
            ).scalar() or 0

        rate = (cancelled_subs / total_subs * 100) if total_subs > 0 else 0.0
        churn_rate_trend.append(ChurnRateItem(
            month=month_start_dt.strftime("%Y-%m"),
            churnRate=round(rate, 1),
            cancelledCount=cancelled_subs,
            totalCount=total_subs,
        ))

    # ---- 套餐分布 ----
    free_count = db.query(func.count(User.id)).filter(User.subscription_tier == "free").scalar() or 0
    storage_count = db.query(func.count(User.id)).filter(User.subscription_tier == "storage").scalar() or 0
    total_tier = free_count + storage_count

    plan_distribution = [
        PlanDistributionItem(plan="Free", count=free_count, percentage=(free_count / total_tier * 100) if total_tier > 0 else 0.0),
        PlanDistributionItem(plan="Storage", count=storage_count, percentage=(storage_count / total_tier * 100) if total_tier > 0 else 0.0),
    ]

    # 当前总体流失率（取消 / 总订阅）
    total_subs_all = db.query(func.count(Subscription.id)).scalar() or 0
    total_cancelled = db.query(func.count(Subscription.id)).filter(Subscription.status == "cancelled").scalar() or 0
    overall_churn = (total_cancelled / total_subs_all * 100) if total_subs_all > 0 else 0.0

    # ---- LLM 用量收入/成本/毛利 ----
    llm_revenue = db.query(func.sum(LLMUsageRecord.price)).filter(
        LLMUsageRecord.status == "completed"
    ).scalar() or 0
    llm_cost = db.query(func.sum(LLMUsageRecord.cost)).filter(
        LLMUsageRecord.status == "completed"
    ).scalar() or 0
    llm_revenue = float(llm_revenue)
    llm_cost = float(llm_cost)
    llm_profit = llm_revenue - llm_cost

    # 按模型统计
    model_stats = db.query(
        LLMUsageRecord.model_id,
        func.sum(LLMUsageRecord.price).label("revenue"),
        func.sum(LLMUsageRecord.cost).label("cost"),
        func.count(LLMUsageRecord.id).label("calls"),
    ).filter(
        LLMUsageRecord.status == "completed"
    ).group_by(LLMUsageRecord.model_id).all()

    llm_revenue_by_model = [
        ModelRevenueItem(
            model_id=m.model_id,
            revenue=float(m.revenue or 0),
            cost=float(m.cost or 0),
            profit=float(m.revenue or 0) - float(m.cost or 0),
            calls=int(m.calls or 0),
        )
        for m in model_stats
    ]

    # LLM 收入趋势（最近 12 个月）
    llm_revenue_trend: List[MonthlyRevenueItem] = []
    for i in range(11, -1, -1):
        month_idx = (today_start.year * 12 + today_start.month - 1) - i
        year = month_idx // 12
        month = (month_idx % 12) + 1
        month_start_dt = datetime(year, month, 1)
        if month == 12:
            month_end_dt = datetime(year + 1, 1, 1) - timedelta(seconds=1)
        else:
            month_end_dt = datetime(year, month + 1, 1) - timedelta(seconds=1)

        rev = db.query(func.sum(LLMUsageRecord.price)).filter(
            LLMUsageRecord.status == "completed",
            LLMUsageRecord.created_at >= month_start_dt,
            LLMUsageRecord.created_at <= month_end_dt,
        ).scalar() or 0
        llm_revenue_trend.append(MonthlyRevenueItem(
            month=month_start_dt.strftime("%Y-%m"),
            revenue=float(rev)
        ))

    return BillingStatsResponse(
        revenueThisMonth=round(revenue_this_month, 2),
        paidUsers=paid_users,
        averageRevenuePerUser=round(arpu, 2),
        churnRate=round(overall_churn, 1),
        revenueTrend=revenue_trend,
        subscriptionFunnel=funnel,
        churnRateTrend=churn_rate_trend,
        planDistribution=plan_distribution,
        refundRate=round(refund_rate, 1),
        refundCount=refund_count,
        totalPaymentCount=total_payments,
        llmRevenue=round(llm_revenue, 2),
        llmCost=round(llm_cost, 2),
        llmProfit=round(llm_profit, 2),
        llmRevenueByModel=llm_revenue_by_model,
        llmRevenueTrend=llm_revenue_trend,
    )


class SubscriptionItem(BaseModel):
    id: str
    user_email: str
    user_id: str
    tier: str
    status: str
    started_at: datetime
    expires_at: Optional[datetime]


class TierUpdateRequest(BaseModel):
    tier: str


@router.get("/subscriptions", response_model=List[SubscriptionItem], summary="List subscriptions", description="List all user subscriptions.")
async def list_subscriptions(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_READ))
):
    subs = db.query(Subscription).order_by(Subscription.created_at.desc()).all()
    result = []
    for sub in subs:
        user = db.query(User).filter(User.id == sub.user_id).first()
        plan = db.query(Plan).filter(Plan.id == sub.plan_id).first()
        result.append(SubscriptionItem(
            id=sub.id,
            user_email=user.email if user else "",
            user_id=sub.user_id,
            tier=plan.slug if plan else "free",
            status=sub.status,
            started_at=sub.started_at or sub.created_at,
            expires_at=sub.current_period_end,
        ))
    return result


@router.patch("/users/{user_id}/tier", summary="Update user tier", description="Manually update a user's subscription tier.")
async def update_user_tier(
    user_id: str,
    data: TierUpdateRequest,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_WRITE))
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
        Subscription.status.in_(["active", "trial"])
    ).first()
    if active_sub:
        active_sub.status = "cancelled"
        active_sub.cancelled_at = datetime.utcnow()
        active_sub.cancel_reason = "admin_tier_change"
        active_sub.auto_renew = False

    # Create new subscription for the tier
    billing = BillingService(db)
    billing.create_subscription(
        user_id=user_id,
        plan_id=plan.id,
        billing_cycle="monthly",
        payment_method="admin_manual",
    )

    # Audit log
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


# ─── Coupons ───

class CouponCreate(BaseModel):
    code: str
    type: str = "percent"  # percent / fixed
    value: int
    currency: str = "CNY"
    min_amount: int = 0
    max_discount: Optional[int] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    max_uses: Optional[int] = None
    applies_to: str = "all"  # subscription / topup / all
    plan_ids: Optional[List[str]] = None
    description: Optional[str] = None
    is_active: bool = True


class CouponOut(BaseModel):
    id: str
    code: str
    type: str
    value: int
    currency: str
    min_amount: int
    max_discount: Optional[int]
    valid_from: Optional[datetime]
    valid_until: Optional[datetime]
    max_uses: Optional[int]
    used_count: int
    is_active: bool
    applies_to: str
    plan_ids: Optional[List[str]]
    description: Optional[str]
    created_at: Optional[datetime]


class CouponUsageOut(BaseModel):
    id: str
    user_id: str
    coupon_id: str
    payment_id: str
    used_at: Optional[datetime]


def _coupon_to_dict(coupon: Coupon) -> Dict[str, Any]:
    plan_ids = None
    if coupon.plan_ids:
        try:
            plan_ids = json.loads(coupon.plan_ids)
        except (json.JSONDecodeError, TypeError):
            plan_ids = None
    return {
        "id": coupon.id,
        "code": coupon.code,
        "type": coupon.type,
        "value": coupon.value,
        "currency": coupon.currency,
        "min_amount": coupon.min_amount or 0,
        "max_discount": coupon.max_discount,
        "valid_from": coupon.valid_from,
        "valid_until": coupon.valid_until,
        "max_uses": coupon.max_uses,
        "used_count": coupon.used_count or 0,
        "is_active": coupon.is_active,
        "applies_to": coupon.applies_to,
        "plan_ids": plan_ids,
        "description": coupon.description,
        "created_at": coupon.created_at,
    }


@router.get("/coupons", response_model=List[CouponOut], summary="List coupons")
async def list_coupons(
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.COUPONS_MANAGE)),
):
    svc = CouponService(db)
    return [_coupon_to_dict(c) for c in svc.list_coupons(active_only=active_only)]


@router.post("/coupons", response_model=CouponOut, summary="Create coupon")
async def create_coupon(
    data: CouponCreate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.COUPONS_MANAGE)),
):
    svc = CouponService(db)
    try:
        coupon = svc.create_coupon(data.model_dump())
        db.commit()
        db.refresh(coupon)
        return _coupon_to_dict(coupon)
    except CouponError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建优惠码失败: {e}")


@router.patch("/coupons/{coupon_id}/toggle", response_model=CouponOut, summary="Toggle coupon active state")
async def toggle_coupon(
    coupon_id: str,
    is_active: bool,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.COUPONS_MANAGE)),
):
    svc = CouponService(db)
    try:
        coupon = svc.toggle_coupon(coupon_id, is_active)
        db.commit()
        db.refresh(coupon)
        return _coupon_to_dict(coupon)
    except CouponError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新优惠码失败: {e}")


@router.get("/coupon-usages", response_model=List[CouponUsageOut], summary="List coupon usages")
async def list_coupon_usages(
    coupon_id: Optional[str] = None,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.COUPONS_MANAGE)),
):
    q = db.query(CouponUsage)
    if coupon_id:
        q = q.filter(CouponUsage.coupon_id == coupon_id)
    if user_id:
        q = q.filter(CouponUsage.user_id == user_id)
    usages = q.order_by(CouponUsage.used_at.desc()).limit(200).all()
    return [
        {
            "id": u.id,
            "user_id": u.user_id,
            "coupon_id": u.coupon_id,
            "payment_id": u.payment_id,
            "used_at": u.used_at,
        }
        for u in usages
    ]


class AdminPaymentOut(BaseModel):
    id: str
    user_id: str
    user_email: Optional[str]
    amount: int
    currency: str
    status: str
    payment_type: Optional[str]
    description: Optional[str]
    paid_at: Optional[datetime]
    created_at: Optional[datetime]


@router.get("/payments", response_model=List[AdminPaymentOut], summary="List payments")
async def list_all_payments(
    status: Optional[str] = None,
    payment_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_READ)),
):
    q = db.query(Payment)
    if status:
        q = q.filter(Payment.status == status)
    if payment_type:
        q = q.filter(Payment.payment_type == payment_type)
    payments = q.order_by(Payment.created_at.desc()).limit(200).all()
    result = []
    for p in payments:
        user = db.query(User).filter(User.id == p.user_id).first()
        result.append({
            "id": p.id,
            "user_id": p.user_id,
            "user_email": user.email if user else None,
            "amount": p.amount,
            "currency": p.currency,
            "status": p.status,
            "payment_type": p.payment_type,
            "description": p.description,
            "paid_at": p.paid_at,
            "created_at": p.created_at,
        })
    return result


class AdminRefundRequest(BaseModel):
    amount: Optional[int] = None
    reason: Optional[str] = None


@router.post("/payments/{payment_id}/refund", response_model=AdminPaymentOut, summary="Refund payment")
async def admin_refund_payment(
    payment_id: str,
    req: AdminRefundRequest,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_WRITE)),
    payment_service: PaymentService = Depends(get_payment_service),
):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status != "success":
        raise HTTPException(status_code=400, detail="Only successful payments can be refunded")

    result = await payment_service.refund(payment_id, amount=req.amount, reason=req.reason)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error_message or "Refund failed")

    if payment.payment_type == "subscription":
        billing = BillingService(db)
        billing.cancel_subscription(payment.user_id, reason=req.reason or "admin_refund")

    db.refresh(payment)
    user = db.query(User).filter(User.id == payment.user_id).first()
    return {
        "id": payment.id,
        "user_id": payment.user_id,
        "user_email": user.email if user else None,
        "amount": payment.amount,
        "currency": payment.currency,
        "status": payment.status,
        "payment_type": payment.payment_type,
        "description": payment.description,
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }


class BalanceAdjustRequest(BaseModel):
    amount_yuan: float
    reason: str = Field(..., min_length=1, max_length=200)


class AdminBalanceTransactionOut(BaseModel):
    id: str
    amount: float
    transaction_type: str
    balance_after: float
    reference_id: Optional[str]
    description: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ─── Plans ───

class PlanCreate(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = None
    price_monthly: int = Field(default=0, ge=0)
    price_yearly: int = Field(default=0, ge=0)
    currency: str = "CNY"
    billing_cycle: str = "monthly"
    is_active: bool = True
    sort_order: int = 0
    features: Optional[Dict[str, Any]] = None
    limits: Optional[Dict[str, Any]] = None


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    price_monthly: Optional[int] = None
    price_yearly: Optional[int] = None
    currency: Optional[str] = None
    billing_cycle: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    features: Optional[Dict[str, Any]] = None
    limits: Optional[Dict[str, Any]] = None


class PlanOut(BaseModel):
    id: str
    name: str
    slug: str
    description: Optional[str]
    price_monthly: int
    price_yearly: int
    currency: str
    billing_cycle: str
    is_active: bool
    sort_order: int
    features: Optional[Dict[str, Any]]
    limits: Optional[Dict[str, Any]]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


def _plan_to_dict(plan: Plan) -> Dict[str, Any]:
    return {
        "id": plan.id,
        "name": plan.name,
        "slug": plan.slug,
        "description": plan.description,
        "price_monthly": plan.price_monthly,
        "price_yearly": plan.price_yearly,
        "currency": plan.currency,
        "billing_cycle": plan.billing_cycle,
        "is_active": plan.is_active,
        "sort_order": plan.sort_order,
        "features": json.loads(plan.features) if plan.features else {},
        "limits": json.loads(plan.limits) if plan.limits else {},
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
    }


@router.get("/plans", response_model=List[PlanOut], summary="List plans")
async def list_plans(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.PLANS_MANAGE)),
):
    billing = BillingService(db)
    return [_plan_to_dict(p) for p in billing.get_plans(active_only=False)]


@router.post("/plans", response_model=PlanOut, summary="Create plan")
async def create_plan(
    data: PlanCreate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.PLANS_MANAGE)),
):
    billing = BillingService(db)
    try:
        plan = billing.create_plan(data.model_dump(exclude_unset=True))
        return _plan_to_dict(plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建套餐失败: {e}")


@router.patch("/plans/{plan_id}", response_model=PlanOut, summary="Update plan")
async def update_plan(
    plan_id: str,
    data: PlanUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.PLANS_MANAGE)),
):
    billing = BillingService(db)
    try:
        plan = billing.update_plan(plan_id, data.model_dump(exclude_unset=True))
        return _plan_to_dict(plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新套餐失败: {e}")


@router.delete("/plans/{plan_id}", summary="Delete plan")
async def delete_plan(
    plan_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.PLANS_MANAGE)),
):
    billing = BillingService(db)
    try:
        billing.delete_plan(plan_id)
        return {"message": "Plan deleted"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除套餐失败: {e}")


@router.get("/users/{user_id}/balance", summary="Get user balance")
async def admin_get_user_balance(
    user_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_READ)),
):
    return get_balance_summary(db, user_id)


@router.post("/users/{user_id}/balance/adjust", summary="Adjust user balance")
async def admin_adjust_user_balance(
    user_id: str,
    req: BalanceAdjustRequest,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_WRITE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    svc = LLMBillingService(db)
    tx = svc.admin_adjust_balance(
        user_id=user_id,
        amount_yuan=req.amount_yuan,
        reason=req.reason,
        admin_id=str(current_admin.id),
    )
    return {
        "transaction_id": tx.id,
        "amount": float(tx.amount),
        "balance_after": float(tx.balance_after),
        "reason": req.reason,
    }


@router.get("/users/{user_id}/balance/transactions", response_model=List[AdminBalanceTransactionOut], summary="List user balance transactions")
async def admin_list_user_balance_transactions(
    user_id: str,
    transaction_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.BILLING_READ)),
):
    """Get balance transaction history for a specific user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    svc = LLMBillingService(db)
    records = svc.list_transactions(
        user_id=user_id,
        transaction_type=transaction_type,
        skip=skip,
        limit=limit,
    )
    return [
        {
            "id": r.id,
            "amount": float(r.amount),
            "transaction_type": r.transaction_type,
            "balance_after": float(r.balance_after),
            "reference_id": r.reference_id,
            "description": r.description,
            "created_at": r.created_at,
        }
        for r in records
    ]
