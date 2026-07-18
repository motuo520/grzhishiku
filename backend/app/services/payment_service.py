import json
from datetime import datetime
from typing import Optional, Dict, Any
import uuid

from dateutil.relativedelta import relativedelta

from fastapi import Request, HTTPException, status
from sqlalchemy.orm import Session

from app.models.billing import Payment, Subscription, Coupon
from app.models.base import User
from app.services.billing_service import BillingService
from app.services.llm_billing_service import LLMBillingService
from app.services.coupon_service import CouponService, CouponError
from app.services.payment_providers.factory import PaymentProviderFactory, get_payment_factory
from app.services.payment_providers.base import PaymentProviderType, PaymentOrder, PaymentStatus, PaymentResult

class PaymentService:
    """支付服务 — 统一支付流程编排"""

    def __init__(self, db: Session, factory: Optional[PaymentProviderFactory] = None):
        self.db = db
        self.billing = BillingService(db)
        self.factory = factory or get_payment_factory()

    async def create_payment_order(
        self,
        user_id: str,
        plan_id: str,
        provider: str,
        billing_cycle: str = "monthly",
        pay_params: Optional[Dict[str, Any]] = None,
        coupon_code: Optional[str] = None,
    ) -> PaymentOrder:
        """
        创建支付订单
        
        流程：
        1. 获取计划信息
        2. 创建 Payment 数据库记录（pending）
        3. 调用支付提供商创建订单
        4. 更新 Payment 记录
        5. 返回 PaymentOrder（含支付参数）
        """
        # 1. 获取计划
        plan = self.billing.get_plan(plan_id)
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        # 2. 计算价格并应用优惠券
        original_amount = plan.price_yearly if billing_cycle == "yearly" else plan.price_monthly
        coupon_id = None
        discount_amount = 0
        amount = original_amount

        if coupon_code and original_amount > 0:
            coupon_svc = CouponService(self.db)
            try:
                coupon_summary = coupon_svc.apply_coupon(
                    code=coupon_code,
                    user_id=user_id,
                    payment_type="subscription",
                    original_amount_cents=original_amount,
                    plan_id=plan_id,
                )
                coupon_id = coupon_summary["coupon_id"]
                discount_amount = coupon_summary["discount_amount"]
                amount = coupon_summary["final_amount"]
            except CouponError as e:
                raise HTTPException(status_code=400, detail=str(e))

        if amount <= 0:
            # 免费或全额抵扣：直接创建订阅
            sub = self.billing.create_subscription(user_id, plan_id, billing_cycle)
            sub.coupon_id = coupon_id
            self.db.commit()
            return PaymentOrder(
                order_id=sub.id,
                amount=0,
                currency="CNY",
                description=f"{plan.name} ({billing_cycle})",
                user_id=user_id,
                provider=PaymentProviderType(provider),
                status=PaymentStatus.SUCCESS,
            )

        # 3. 创建 Payment 记录
        order_id = f"ORD{datetime.now().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:8].upper()}"
        payment = Payment(
            id=order_id,
            user_id=user_id,
            plan_id=plan_id,
            amount=amount,
            original_amount=original_amount,
            discount_amount=discount_amount,
            currency=plan.currency,
            status="pending",
            description=f"{plan.name} - {billing_cycle}",
            payment_method=provider,
            payment_provider=provider,
            coupon_id=coupon_id,
        )
        self.db.add(payment)
        self.db.commit()

        # 4. 调用支付提供商
        provider_type = PaymentProviderType(provider)
        # 拒绝未配置的 provider（生产环境避免误用 mock）
        if provider_type.value not in self.factory.get_available_providers():
            raise HTTPException(status_code=400, detail=f"支付方式 {provider} 未配置或已禁用")
        payment_provider = self.factory.get_provider(provider_type)

        order = PaymentOrder(
            order_id=order_id,
            amount=amount,
            currency=plan.currency,
            description=f"{plan.name} - {billing_cycle}",
            user_id=user_id,
            provider=provider_type,
            pay_params=pay_params,
        )

        order = await payment_provider.create_order(order)

        # 5. 更新记录
        payment.provider_order_id = order.provider_order_id
        payment.provider_response = json.dumps(order.provider_response) if order.provider_response else None
        self.db.commit()

        return order

    async def create_topup_order(
        self,
        user_id: str,
        amount: int,
        provider: str,
        pay_params: Optional[Dict[str, Any]] = None,
        coupon_code: Optional[str] = None,
    ) -> PaymentOrder:
        """创建 LLM 余额充值订单。amount 单位为分。"""
        if amount <= 0:
            raise HTTPException(status_code=400, detail="充值金额必须大于 0")
        if amount < 100:
            raise HTTPException(status_code=400, detail="充值金额不能少于 1 元")

        original_amount = amount
        coupon_id = None
        discount_amount = 0

        if coupon_code:
            coupon_svc = CouponService(self.db)
            try:
                coupon_summary = coupon_svc.apply_coupon(
                    code=coupon_code,
                    user_id=user_id,
                    payment_type="topup",
                    original_amount_cents=original_amount,
                )
                coupon_id = coupon_summary["coupon_id"]
                discount_amount = coupon_summary["discount_amount"]
                amount = coupon_summary["final_amount"]
            except CouponError as e:
                raise HTTPException(status_code=400, detail=str(e))

        order_id = f"TOP{datetime.now().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:8].upper()}"
        payment = Payment(
            id=order_id,
            user_id=user_id,
            plan_id=None,
            amount=amount,
            original_amount=original_amount,
            discount_amount=discount_amount,
            currency="CNY",
            status="pending",
            description=f"LLM 余额充值 {original_amount / 100:.2f} 元",
            payment_method=provider,
            payment_provider=provider,
            payment_type="topup",
            balance_added=0,
            coupon_id=coupon_id,
        )
        self.db.add(payment)
        self.db.commit()

        provider_type = PaymentProviderType(provider)
        if provider_type.value not in self.factory.get_available_providers():
            raise HTTPException(status_code=400, detail=f"支付方式 {provider} 未配置或已禁用")
        payment_provider = self.factory.get_provider(provider_type)

        order = PaymentOrder(
            order_id=order_id,
            amount=amount,
            currency="CNY",
            description=payment.description,
            user_id=user_id,
            provider=provider_type,
            pay_params=pay_params,
        )

        order = await payment_provider.create_order(order)

        payment.provider_order_id = order.provider_order_id
        payment.provider_response = json.dumps(order.provider_response) if order.provider_response else None
        self.db.commit()

        return order

    async def handle_webhook(self, provider: str, request: Request) -> PaymentResult:
        """
        处理支付异步通知
        
        流程：
        1. 验证签名
        2. 解析数据
        3. 更新 Payment 记录
        4. 支付成功则创建/更新 Subscription
        5. 返回结果
        """
        body = await request.body()
        headers = dict(request.headers)

        provider_type = PaymentProviderType(provider)
        payment_provider = self.factory.get_provider(provider_type)

        # 1. 验证签名
        data = await payment_provider.verify_webhook(headers, body)
        if data is None:
            raise HTTPException(status_code=400, detail="Invalid webhook signature")

        # 2. 处理数据
        result = await payment_provider.process_webhook(data)

        # 3. 查找关联 Payment
        # 不同提供商的订单 ID 字段不同
        order_id = self._extract_order_id(provider, data)
        if not order_id:
            raise HTTPException(status_code=400, detail="Order ID not found in webhook")

        payment = self.db.query(Payment).filter(Payment.id == order_id).first()
        if not payment:
            # 尝试通过 provider_order_id 查找
            provider_order_id = self._extract_provider_order_id(provider, data)
            if provider_order_id:
                payment = self.db.query(Payment).filter(
                    Payment.provider_order_id == provider_order_id
                ).first()

        if payment:
            # 幂等保护：已处理到终态的成功/退款通知不再重复执行充值/续订
            if payment.status == "success" and result.success:
                return result
            if payment.status == "refunded" and result.status.value == "refunded":
                return result

            # 4. 更新 Payment
            payment.status = result.status.value
            payment.provider_transaction_id = result.provider_transaction_id
            payment.paid_at = datetime.utcnow() if result.success else None
            payment.provider_response = json.dumps(result.raw_response) if result.raw_response else None

            # 5. 支付成功 → 创建/续订订阅 或 充值余额
            if result.success and payment.status == "success":
                if payment.coupon_id:
                    coupon_svc = CouponService(self.db)
                    try:
                        coupon_svc.record_usage(
                            user_id=payment.user_id,
                            coupon_id=payment.coupon_id,
                            payment_id=payment.id,
                        )
                    except Exception:
                        pass

                if payment.payment_type == "topup":
                    if not payment.balance_added:
                        llm_billing = LLMBillingService(self.db)
                        llm_billing.deposit_balance(
                            user_id=payment.user_id,
                            amount_cents=payment.amount,
                            reference_id=payment.id,
                            description=f"充值到账 {payment.amount / 100:.2f} 元",
                            commit=False,
                        )
                        payment.balance_added = payment.amount
                else:
                    # 检查是否已有订阅
                    existing = self.billing.get_user_subscription(payment.user_id)
                    if existing and existing.plan_id == payment.plan_id and existing.auto_renew:
                        # 续订：更新周期
                        existing.current_period_end = self._extend_period(
                            existing.current_period_end or datetime.utcnow(),
                            existing.billing_cycle,
                        )
                        existing.status = "active"
                        # 同步更新用户订阅过期时间
                        user = self.db.query(User).filter(User.id == payment.user_id).first()
                        if user:
                            user.subscription_expires_at = existing.current_period_end
                    else:
                        # 新订阅
                        sub = self.billing.create_subscription(
                            user_id=payment.user_id,
                            plan_id=payment.plan_id,
                            billing_cycle="monthly" if payment.amount < 10000 else "yearly",  # 粗略判断
                            payment_method=provider,
                        )
                        # 修正价格（因为 create_subscription 会重新计算）
                        sub.price_paid = payment.amount
                        sub.coupon_id = payment.coupon_id
                        sub.current_period_start = datetime.utcnow()
                        sub.current_period_end = self._extend_period(datetime.utcnow(), sub.billing_cycle)

            self.db.commit()

        return result

    async def query_payment_status(self, order_id: str, provider: str) -> PaymentResult:
        """查询支付状态"""
        provider_type = PaymentProviderType(provider)
        payment_provider = self.factory.get_provider(provider_type)
        # 对于 Stripe 等使用 provider_order_id（第三方订单号）查询
        payment = self.db.query(Payment).filter(Payment.id == order_id).first()
        query_id = payment.provider_order_id if payment and payment.provider_order_id else order_id
        return await payment_provider.query_payment(query_id)

    async def refund(self, order_id: str, amount: Optional[int] = None, reason: Optional[str] = None) -> PaymentResult:
        """发起退款"""
        payment = self.db.query(Payment).filter(Payment.id == order_id).first()
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        if payment.status != "success":
            raise HTTPException(status_code=400, detail="Only successful payments can be refunded")

        refund_amount = amount or payment.amount
        if refund_amount > payment.amount:
            raise HTTPException(status_code=400, detail="Refund amount exceeds payment amount")

        provider_type = PaymentProviderType(payment.payment_provider or "alipay")
        payment_provider = self.factory.get_provider(provider_type)

        # 对于 Stripe 等使用 provider_order_id（第三方订单号）退款
        refund_id = payment.provider_order_id if payment.provider_order_id else order_id
        result = await payment_provider.refund(refund_id, refund_amount, reason)

        if result.success:
            payment.status = "refunded"
            payment.refund_amount = refund_amount
            payment.refunded_at = datetime.utcnow()
            self.db.commit()

        return result

    def _extract_order_id(self, provider: str, data: Dict[str, Any]) -> Optional[str]:
        """从不同提供商的回调数据中提取订单号"""
        if provider == "alipay":
            return data.get("out_trade_no")
        elif provider == "wechat":
            # 微信解密后的数据
            resource = data.get("resource", {})
            if "out_trade_no" in resource:
                return resource["out_trade_no"]
            return data.get("out_trade_no")
        elif provider == "stripe":
            # Stripe metadata
            metadata = data.get("data", {}).get("object", {}).get("metadata", {})
            return metadata.get("order_id")
        elif provider == "xorpay":
            # Xorpay 回调 info 或顶层都有 out_trade_no
            info = data.get("info", {})
            return info.get("out_trade_no") or data.get("out_trade_no")
        elif provider == "xunhupay":
            # 虎皮椒回调顶层 trade_order_id
            return data.get("trade_order_id")
        return None

    def _extract_provider_order_id(self, provider: str, data: Dict[str, Any]) -> Optional[str]:
        """提取第三方订单号"""
        if provider == "alipay":
            return data.get("trade_no")
        elif provider == "wechat":
            resource = data.get("resource", {})
            if "transaction_id" in resource:
                return resource["transaction_id"]
            return data.get("transaction_id")
        elif provider == "stripe":
            return data.get("data", {}).get("object", {}).get("id")
        elif provider == "xorpay":
            info = data.get("info", {})
            return info.get("trade_no") or data.get("trade_no")
        elif provider == "xunhupay":
            return data.get("open_order_id") or data.get("transaction_id")
        return None

    def _extend_period(self, from_date: datetime, billing_cycle: str) -> datetime:
        """延长订阅周期"""
        if billing_cycle == "yearly":
            return from_date + relativedelta(years=1)
        return from_date + relativedelta(months=1)

# Dependency injection
from app.core.database import get_db
from fastapi import Depends

def get_payment_service(db: Session = Depends(get_db)) -> PaymentService:
    factory = get_payment_factory()
    return PaymentService(db, factory)
