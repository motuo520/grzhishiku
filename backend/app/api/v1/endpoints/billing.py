from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
import json

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.feature_guard import require_platform_billing
from app.services.billing_service import BillingService, get_billing_service
from app.services.payment_service import PaymentService, get_payment_service
from app.services.payment_providers.factory import PaymentProviderFactory, get_payment_factory
from app.services.payment_providers.base import PaymentProviderType, PaymentStatus
from app.services.llm_billing_service import LLMBillingService, get_balance_summary
from app.services.coupon_service import CouponService, CouponError
from app.models.base import User
from app.models.billing import Payment
from app.models.llm_billing import LLMUsageRecord
from sqlalchemy.orm import Session
from sqlalchemy import desc

router = APIRouter(tags=["billing"])

from app.api.admin.endpoints.auth import get_current_admin

# ─── Schemas ───

class PlanOut(BaseModel):
    id: str
    name: str
    slug: str
    description: Optional[str]
    price_monthly: int
    price_yearly: int
    currency: str
    billing_cycle: str
    features: Optional[Dict[str, Any]]
    limits: Optional[Dict[str, Any]]

    class Config:
        from_attributes = True

class SubscriptionOut(BaseModel):
    id: str
    plan_id: str
    plan_name: Optional[str]
    status: str
    billing_cycle: str
    price_paid: int
    currency: str
    current_period_start: Optional[datetime]
    current_period_end: Optional[datetime]
    auto_renew: bool
    trial_end: Optional[datetime]

    class Config:
        from_attributes = True

class PaymentOut(BaseModel):
    id: str
    amount: int
    currency: str
    status: str
    description: Optional[str]
    paid_at: Optional[datetime]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

class InvoiceOut(BaseModel):
    id: str
    invoice_number: str
    amount: int
    currency: str
    status: str
    title: Optional[str]
    email: Optional[str]
    issued_at: Optional[datetime]

    class Config:
        from_attributes = True

class SubscribeRequest(BaseModel):
    plan_id: str
    billing_cycle: str = Field(default='monthly', pattern='^(monthly|yearly)$')
    payment_method: Optional[str] = Field(default='alipay', pattern='^(alipay|wechat|stripe|xorpay)$')
    pay_params: Optional[Dict[str, Any]] = None  # e.g. {"qr_code": true}, {"jsapi": true, "openid": "xxx"}
    coupon_code: Optional[str] = None


class TopupRequest(BaseModel):
    amount: int = Field(..., ge=1000, description="充值金额，单位：分（最低 10 元）")
    payment_method: str = Field(default='alipay', pattern='^(alipay|wechat|stripe|xorpay)$')
    pay_params: Optional[Dict[str, Any]] = None
    coupon_code: Optional[str] = None


class ValidateCouponRequest(BaseModel):
    code: str
    payment_type: str = Field(default='subscription', pattern='^(subscription|topup|all)$')
    original_amount: int = Field(default=0, description="原始金额，单位：分")
    plan_id: Optional[str] = None

class CreateInvoiceRequest(BaseModel):
    payment_id: str
    title: Optional[str] = None
    email: Optional[str] = None

class PaymentOrderOut(BaseModel):
    order_id: str
    amount: int
    currency: str
    description: str
    provider: str
    status: str
    pay_url: Optional[str] = None
    pay_qr_code: Optional[str] = None
    pay_params: Optional[Dict[str, Any]] = None
    provider_response: Optional[Dict[str, Any]] = None

class CancelRequest(BaseModel):
    reason: Optional[str] = None


class BalanceTransactionOut(BaseModel):
    id: str
    amount: float
    transaction_type: str
    balance_after: float
    reference_id: Optional[str]
    description: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

class RefundRequest(BaseModel):
    amount: Optional[int] = Field(default=None, ge=1, description="退款金额，单位：分；不传则全额退款")
    reason: Optional[str] = Field(default=None, max_length=200)

# ─── Endpoints ───

@router.get("/plans", response_model=List[PlanOut])
async def list_plans(
    billing: BillingService = Depends(get_billing_service)
):
    """获取所有定价计划（无需登录）"""
    plans = billing.get_plans(active_only=True)
    import json
    result = []
    for p in plans:
        data = {
            "id": p.id,
            "name": p.name,
            "slug": p.slug,
            "description": p.description,
            "price_monthly": p.price_monthly,
            "price_yearly": p.price_yearly,
            "currency": p.currency,
            "billing_cycle": p.billing_cycle,
        }
        try:
            data["features"] = json.loads(p.features) if p.features else {}
        except (json.JSONDecodeError, TypeError):
            data["features"] = {}
        try:
            data["limits"] = json.loads(p.limits) if p.limits else {}
        except (json.JSONDecodeError, TypeError):
            data["limits"] = {}
        result.append(data)
    return result


@router.get("/payment-methods", summary="Available payment methods")
async def list_payment_methods(
    factory: PaymentProviderFactory = Depends(get_payment_factory)
):
    """返回当前已配置可用的支付方式列表。"""
    available = factory.get_available_providers()
    labels = {
        "alipay": "支付宝",
        "wechat": "微信支付",
        "stripe": "信用卡",
        "xorpay": "虎皮椒",
        "xunhupay": "迅虎支付",
    }
    return [
        {"id": key, "name": labels.get(key, key), "enabled": True}
        for key in available
    ]

@router.get("/subscription", response_model=Optional[SubscriptionOut])
async def get_current_subscription(
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
    db: Session = Depends(get_db),
):
    """获取当前用户订阅"""
    sub = billing.get_user_subscription(user.id)
    if not sub:
        return None

    plan = billing.get_plan(sub.plan_id)
    return {
        "id": sub.id,
        "plan_id": sub.plan_id,
        "plan_name": plan.name if plan else None,
        "status": sub.status,
        "billing_cycle": sub.billing_cycle,
        "price_paid": sub.price_paid,
        "currency": sub.currency,
        "current_period_start": sub.current_period_start,
        "current_period_end": sub.current_period_end,
        "auto_renew": sub.auto_renew,
        "trial_end": sub.trial_end,
    }

@router.post("/subscribe", response_model=PaymentOrderOut)
async def create_payment_order(
    req: SubscribeRequest,
    user: User = Depends(get_current_user),
    payment_service: PaymentService = Depends(get_payment_service),
):
    """
    创建支付订单
    
    返回 PaymentOrder，前端根据 pay_url / pay_qr_code / pay_params 唤起支付
    """
    order = await payment_service.create_payment_order(
        user_id=user.id,
        plan_id=req.plan_id,
        provider=req.payment_method,
        billing_cycle=req.billing_cycle,
        pay_params=req.pay_params,
        coupon_code=req.coupon_code,
    )
    return {
        "order_id": order.order_id,
        "amount": order.amount,
        "currency": order.currency,
        "description": order.description,
        "provider": order.provider.value,
        "status": order.status.value,
        "pay_url": order.pay_url,
        "pay_qr_code": order.pay_qr_code,
        "pay_params": order.pay_params,
        "provider_response": order.provider_response,
    }

@router.post("/validate-coupon")
async def validate_coupon(
    req: ValidateCouponRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """实时校验优惠码并返回折扣后金额。"""
    svc = CouponService(db)
    try:
        summary = svc.apply_coupon(
            code=req.code,
            user_id=user.id,
            payment_type=req.payment_type,
            original_amount_cents=req.original_amount,
            plan_id=req.plan_id,
        )
        return summary
    except CouponError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/subscribe/free")
async def subscribe_free(
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
):
    """直接订阅免费计划（无需支付）"""
    plan = billing.get_plan_by_slug('free')
    if not plan:
        raise HTTPException(status_code=404, detail="Free plan not found")

    sub = billing.create_subscription(user.id, plan.id, 'monthly')
    plan_obj = billing.get_plan(sub.plan_id)
    return {
        "id": sub.id,
        "plan_id": sub.plan_id,
        "plan_name": plan_obj.name if plan_obj else None,
        "status": sub.status,
        "billing_cycle": sub.billing_cycle,
        "price_paid": sub.price_paid,
        "currency": sub.currency,
        "current_period_start": sub.current_period_start,
        "current_period_end": sub.current_period_end,
        "auto_renew": sub.auto_renew,
        "trial_end": sub.trial_end,
    }


@router.post("/topup", response_model=PaymentOrderOut)
async def create_topup_order(
    req: TopupRequest,
    user: User = Depends(get_current_user),
    _: None = Depends(require_platform_billing()),
    payment_service: PaymentService = Depends(get_payment_service),
):
    """创建 LLM 余额充值订单"""
    pay_params = req.pay_params or {}
    if req.payment_method in ("alipay", "wechat") and "qr_code" not in pay_params:
        pay_params["qr_code"] = True

    order = await payment_service.create_topup_order(
        user_id=user.id,
        amount=req.amount,
        provider=req.payment_method,
        pay_params=pay_params,
        coupon_code=req.coupon_code,
    )
    return {
        "order_id": order.order_id,
        "amount": order.amount,
        "currency": order.currency,
        "description": order.description,
        "provider": order.provider.value,
        "status": order.status.value,
        "pay_url": order.pay_url,
        "pay_qr_code": order.pay_qr_code,
        "pay_params": order.pay_params,
        "provider_response": order.provider_response,
    }

@router.delete("/subscription")
async def cancel_subscription(
    req: CancelRequest,
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
):
    """取消订阅（周期结束前仍可用）"""
    sub = billing.cancel_subscription(user.id, reason=req.reason)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription found")
    return {"message": "Subscription cancelled successfully", "subscription_id": sub.id}

@router.get("/payments/{payment_id}", response_model=PaymentOut)
async def get_payment(
    payment_id: str,
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
    payment_service: PaymentService = Depends(get_payment_service),
):
    """获取单个支付订单状态（轮询用）。

    订单未完成时主动向供应商查单并激活——桌面端收不到 webhook 回调，
    全靠这条轮询闭环；网页端也顺带加快到账确认。"""
    payments = billing.get_user_payments(user.id)
    payment = next((p for p in payments if p.id == payment_id), None)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if payment.status not in ("success", "paid", "refunded") and payment.payment_method:
        try:
            result = await payment_service.query_payment_status(payment.id, payment.payment_method)
            if result.success or result.status.value in ("success", "failed", "cancelled", "refunded"):
                payment_service._apply_payment_result(payment, result, payment.payment_method)
                payment_service.db.commit()
        except Exception:
            pass  # 查单失败不阻塞轮询，下轮再试

    return {
        "id": payment.id,
        "amount": payment.amount,
        "currency": payment.currency,
        "status": payment.status,
        "description": payment.description,
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }

@router.get("/payments", response_model=List[PaymentOut])
async def list_payments(
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
):
    """支付历史"""
    payments = billing.get_user_payments(user.id)
    return [
        {
            "id": p.id,
            "amount": p.amount,
            "currency": p.currency,
            "status": p.status,
            "description": p.description,
            "paid_at": p.paid_at,
            "created_at": p.created_at,
        }
        for p in payments
    ]


@router.post("/payments/{payment_id}/refund", response_model=PaymentOut)
async def refund_payment(
    payment_id: str,
    req: RefundRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    payment_service: PaymentService = Depends(get_payment_service),
    billing: BillingService = Depends(get_billing_service),
):
    """用户申请退款（仅允许退自己的成功订单）"""
    payment = db.query(Payment).filter(Payment.id == payment_id, Payment.user_id == user.id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status != "success":
        raise HTTPException(status_code=400, detail="Only successful payments can be refunded")

    result = await payment_service.refund(payment_id, amount=req.amount, reason=req.reason)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error_message or "Refund failed")

    # 退款成功后，如果是订阅订单则取消当前订阅
    if payment.payment_type == "subscription":
        billing.cancel_subscription(user.id, reason=req.reason or "user_refund")

    return {
        "id": payment.id,
        "amount": payment.amount,
        "currency": payment.currency,
        "status": payment.status,
        "description": payment.description,
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }

@router.get("/invoices", response_model=List[InvoiceOut])
async def list_invoices(
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
):
    """发票列表"""
    invoices = billing.get_user_invoices(user.id)
    return [
        {
            "id": inv.id,
            "invoice_number": inv.invoice_number,
            "amount": inv.amount,
            "currency": inv.currency,
            "status": inv.status,
            "title": inv.title,
            "email": inv.email,
            "issued_at": inv.issued_at,
        }
        for inv in invoices
    ]

@router.post("/invoices", response_model=InvoiceOut)
async def create_invoice(
    req: CreateInvoiceRequest,
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
):
    """申请发票"""
    from app.models.billing import Payment as PaymentModel
    payment = billing.db.query(PaymentModel).filter(
        PaymentModel.id == req.payment_id,
        PaymentModel.user_id == user.id,
        PaymentModel.status == 'success'
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found or not paid")

    invoice = billing.create_invoice(
        user_id=user.id,
        payment_id=req.payment_id,
        amount=payment.amount,
        title=req.title,
        email=req.email or user.email,
    )
    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "amount": invoice.amount,
        "currency": invoice.currency,
        "status": invoice.status,
        "title": invoice.title,
        "email": invoice.email,
        "issued_at": invoice.issued_at,
    }

@router.get("/check-feature/{feature}")
async def check_feature(
    feature: str,
    user: User = Depends(get_current_user),
    billing: BillingService = Depends(get_billing_service),
):
    """检查当前用户是否有某功能权限"""
    has_access = billing.check_feature_access(user.id, feature)
    return {"feature": feature, "has_access": has_access}

# ─── Webhook endpoints (公开，无认证) ───

@router.post("/webhook/{provider}")
async def payment_webhook(
    provider: str,
    request: Request,
    payment_service: PaymentService = Depends(get_payment_service),
):
    """
    支付异步通知回调（支付宝/微信/Stripe）
    
    所有支付提供商的异步通知都路由到这里，
    由 PaymentService 根据 provider 参数分发到对应的处理器
    """
    try:
        body = await request.body()
        try:
            body_json = json.loads(body)
        except (json.JSONDecodeError, TypeError):
            body_json = None
        result = await payment_service.handle_webhook(provider, request)
        return {"status": "success" if result.success else "pending", "provider": provider}
    except HTTPException:
        raise
    except Exception as e:
        # Webhook 异常返回非 200 状态码，避免错误被当作成功处理
        raise HTTPException(status_code=500, detail=str(e))

# ─── Admin stats ───

@router.get("/admin/stats")
async def get_billing_stats(
    user: User = Depends(get_current_admin),
    billing: BillingService = Depends(get_billing_service),
):
    """订阅统计（仅 Admin）"""
    return billing.get_subscription_stats()


# ─── LLM balance & usage ──────────────────────────────────────────

@router.get("/balance")
async def get_llm_balance(
    user: User = Depends(get_current_user),
    _: None = Depends(require_platform_billing()),
    db: Session = Depends(get_db),
):
    """获取当前用户的 LLM 预付费余额"""
    return get_balance_summary(db, user.id)


@router.get("/usage")
async def list_llm_usage(
    limit: int = 20,
    user: User = Depends(get_current_user),
    _: None = Depends(require_platform_billing()),
    db: Session = Depends(get_db),
):
    """获取当前用户的 LLM 调用记录"""
    svc = LLMBillingService(db)
    records = svc.list_usage(user_id=user.id, limit=limit)
    return [
        {
            "id": r.id,
            "model_id": r.model_id,
            "task_type": r.task_type,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "estimated_input_tokens": r.estimated_input_tokens,
            "estimated_output_tokens": r.estimated_output_tokens,
            "cost": float(r.cost or 0),
            "price": float(r.price or 0),
            "status": r.status,
            "created_at": r.created_at,
            "completed_at": r.completed_at,
        }
        for r in records
    ]


@router.get("/balance/transactions", response_model=List[BalanceTransactionOut])
async def list_balance_transactions(
    transaction_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    user: User = Depends(get_current_user),
    _: None = Depends(require_platform_billing()),
    db: Session = Depends(get_db),
):
    """获取当前用户的余额交易流水"""
    svc = LLMBillingService(db)
    records = svc.list_transactions(
        user_id=user.id,
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
