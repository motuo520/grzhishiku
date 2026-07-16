from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import json
import uuid

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session
from app.models.billing import Plan, Subscription, Payment, Invoice
from app.models.base import User

class BillingService:
    """订阅与支付服务"""

    def __init__(self, db: Session):
        self.db = db

    # ─── Plans ───

    def get_plans(self, active_only: bool = True) -> List[Plan]:
        query = self.db.query(Plan)
        if active_only:
            query = query.filter(Plan.is_active == True)
        return query.order_by(Plan.sort_order).all()

    def get_plan_by_slug(self, slug: str) -> Optional[Plan]:
        return self.db.query(Plan).filter(Plan.slug == slug, Plan.is_active == True).first()

    def get_plan(self, plan_id: str) -> Optional[Plan]:
        return self.db.query(Plan).filter(Plan.id == plan_id).first()

    def create_plan(self, data: Dict[str, Any]) -> Plan:
        """Create a new plan."""
        if self.db.query(Plan).filter(Plan.slug == data['slug']).first():
            raise ValueError(f"Plan slug already exists: {data['slug']}")

        plan = Plan(
            id=data.get('id') or f"plan_{uuid.uuid4().hex[:16]}",
            name=data['name'],
            slug=data['slug'],
            description=data.get('description'),
            price_monthly=data.get('price_monthly', 0),
            price_yearly=data.get('price_yearly', 0),
            currency=data.get('currency', 'CNY'),
            billing_cycle=data.get('billing_cycle', 'monthly'),
            is_active=data.get('is_active', True),
            sort_order=data.get('sort_order', 0),
            features=json.dumps(data.get('features') or {}, ensure_ascii=False),
            limits=json.dumps(data.get('limits') or {}, ensure_ascii=False),
        )
        self.db.add(plan)
        self.db.commit()
        self.db.refresh(plan)
        return plan

    def update_plan(self, plan_id: str, data: Dict[str, Any]) -> Plan:
        """Update an existing plan."""
        plan = self.get_plan(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        # slug uniqueness check if changing
        new_slug = data.get('slug')
        if new_slug and new_slug != plan.slug:
            if self.db.query(Plan).filter(Plan.slug == new_slug, Plan.id != plan_id).first():
                raise ValueError(f"Plan slug already exists: {new_slug}")
            plan.slug = new_slug

        for field in ['name', 'description', 'currency', 'billing_cycle', 'is_active', 'sort_order']:
            if field in data:
                setattr(plan, field, data[field])

        for field in ['price_monthly', 'price_yearly']:
            if field in data:
                setattr(plan, field, int(data[field]))

        if 'features' in data:
            plan.features = json.dumps(data['features'] or {}, ensure_ascii=False)
        if 'limits' in data:
            plan.limits = json.dumps(data['limits'] or {}, ensure_ascii=False)

        self.db.commit()
        self.db.refresh(plan)
        return plan

    def delete_plan(self, plan_id: str) -> None:
        """Delete a plan if it has no active subscriptions."""
        plan = self.get_plan(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        active_subs = self.db.query(Subscription).filter(
            Subscription.plan_id == plan_id,
            Subscription.status.in_(['active', 'trial'])
        ).count()
        if active_subs > 0:
            raise ValueError("Cannot delete plan with active subscriptions")

        self.db.delete(plan)
        self.db.commit()

    # ─── Subscriptions ───

    def get_user_subscription(self, user_id: str) -> Optional[Subscription]:
        """获取用户当前有效订阅"""
        return self.db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.status.in_(['active', 'trial'])
        ).order_by(Subscription.created_at.desc()).first()

    def get_user_subscription_history(self, user_id: str) -> List[Subscription]:
        return self.db.query(Subscription).filter(
            Subscription.user_id == user_id
        ).order_by(Subscription.created_at.desc()).all()

    def create_subscription(self, user_id: str, plan_id: str, billing_cycle: str = 'monthly',
                            payment_method: Optional[str] = None, trial_days: int = 0) -> Subscription:
        """创建新订阅"""
        plan = self.get_plan(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        now = datetime.utcnow()
        period_start = now

        # 检查是否已有 active/trial 订阅，若存在则先取消
        existing = self.get_user_subscription(user_id)
        if existing:
            existing.status = 'cancelled'
            existing.auto_renew = False
            existing.cancelled_at = now
            existing.cancel_reason = 'switched_plan'
            # 同步 user 表
            user = self.db.query(User).filter(User.id == user_id).first()
            if user:
                user.subscription_status = 'cancelled'

        # 价格计算（分）
        price = plan.price_yearly if billing_cycle == 'yearly' else plan.price_monthly

        if trial_days > 0:
            period_end = now + timedelta(days=trial_days)
            status = 'trial'
        else:
            period_end = now + timedelta(days=365 if billing_cycle == 'yearly' else 30)
            status = 'active'

        sub = Subscription(
            id=f"sub_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            plan_id=plan_id,
            status=status,
            billing_cycle=billing_cycle,
            price_paid=0 if trial_days > 0 else price,
            currency=plan.currency,
            started_at=now,
            current_period_start=period_start,
            current_period_end=period_end,
            payment_method=payment_method,
            auto_renew=(trial_days == 0),
            trial_end=period_end if trial_days > 0 else None,
        )
        self.db.add(sub)

        # 同步到 user 表的快速字段
        user = self.db.query(User).filter(User.id == user_id).first()
        if user:
            user.subscription_tier = plan.slug
            user.subscription_status = status
            user.subscription_expires_at = period_end

        self.db.commit()
        self.db.refresh(sub)
        return sub

    def cancel_subscription(self, user_id: str, reason: Optional[str] = None) -> Optional[Subscription]:
        """取消订阅（当前周期结束前仍可用）"""
        sub = self.get_user_subscription(user_id)
        if not sub:
            return None

        sub.status = 'cancelled'
        sub.cancelled_at = datetime.utcnow()
        sub.cancel_reason = reason
        sub.auto_renew = False

        # 同步 user 表
        user = self.db.query(User).filter(User.id == user_id).first()
        if user:
            user.subscription_status = 'cancelled'

        self.db.commit()
        self.db.refresh(sub)
        return sub

    def check_feature_access(self, user_id: str, feature: str) -> bool:
        """检查用户是否有某个功能权限"""
        sub = self.get_user_subscription(user_id)
        if not sub:
            # 无订阅 = free
            plan = self.get_plan_by_slug('free')
        else:
            plan = self.get_plan(sub.plan_id)

        if not plan or not plan.features:
            return False

        features = json.loads(plan.features) if isinstance(plan.features, str) else plan.features
        if features is None:
            features = {}

        # 布尔特征：未明确配置则默认允许（保持向后兼容）
        if feature in features:
            return bool(features[feature])

        # 未知功能默认允许；只有显式 false 才拒绝
        return True

    def check_limit(self, user_id: str, limit_key: str, current_value: int) -> bool:
        """检查是否超出限额"""
        sub = self.get_user_subscription(user_id)
        if not sub:
            plan = self.get_plan_by_slug('free')
        else:
            plan = self.get_plan(sub.plan_id)

        if not plan or not plan.limits:
            return True

        limits = json.loads(plan.limits) if isinstance(plan.limits, str) else plan.limits
        if limits is None:
            return True

        limit = limits.get(limit_key)
        if limit is None:
            return True  # null = 无限制

        return current_value < limit

    # ─── Payments ───

    def create_payment(self, user_id: str, plan_id: str, amount: int, description: str,
                       subscription_id: Optional[str] = None) -> Payment:
        """创建支付记录（待支付状态）"""
        payment = Payment(
            id=f"pay_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            subscription_id=subscription_id,
            plan_id=plan_id,
            amount=amount,
            status='pending',
            description=description,
        )
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)
        return payment

    def confirm_payment(self, payment_id: str, provider_tx_id: str,
                        provider_response: Optional[str] = None) -> Payment:
        """确认支付成功"""
        payment = self.db.query(Payment).filter(Payment.id == payment_id).first()
        if not payment:
            raise ValueError(f"Payment not found: {payment_id}")

        payment.status = 'success'
        payment.provider_transaction_id = provider_tx_id
        payment.provider_response = provider_response
        payment.paid_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(payment)
        return payment

    def get_user_payments(self, user_id: str) -> List[Payment]:
        return self.db.query(Payment).filter(
            Payment.user_id == user_id
        ).order_by(Payment.created_at.desc()).all()

    # ─── Invoices ───

    def create_invoice(self, user_id: str, payment_id: str, amount: int,
                       title: Optional[str] = None, email: Optional[str] = None) -> Invoice:
        """创建发票"""
        now = datetime.utcnow()
        invoice_number = f"INV-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:6].upper()}"

        invoice = Invoice(
            id=f"inv_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            payment_id=payment_id,
            invoice_number=invoice_number,
            amount=amount,
            title=title,
            email=email,
            status='pending',
        )
        self.db.add(invoice)
        self.db.commit()
        self.db.refresh(invoice)
        return invoice

    def get_user_invoices(self, user_id: str) -> List[Invoice]:
        return self.db.query(Invoice).filter(
            Invoice.user_id == user_id
        ).order_by(Invoice.created_at.desc()).all()

    def _extend_period(self, current_period_end: datetime, billing_cycle: str) -> datetime:
        """Extend a subscription period by one billing cycle."""
        if billing_cycle == "yearly":
            return current_period_end + relativedelta(years=1)
        return current_period_end + relativedelta(months=1)

    # ─── Admin / Cron ───

    def expire_subscriptions(self) -> int:
        """将已过期的 active/trial 订阅统一标记为 expired，返回处理数量"""
        now = datetime.utcnow()
        expired = self.db.query(Subscription).filter(
            Subscription.status.in_(['active', 'trial']),
            Subscription.current_period_end < now,
        ).all()

        count = 0
        for sub in expired:
            sub.status = 'expired'
            sub.auto_renew = False
            user = self.db.query(User).filter(User.id == sub.user_id).first()
            if user:
                user.subscription_tier = 'free'
                user.subscription_status = 'expired'
                user.subscription_expires_at = None
            count += 1

        self.db.commit()
        return count

    def get_subscription_stats(self) -> Dict[str, Any]:
        """订阅统计（Admin 用）"""
        from sqlalchemy import func

        total_active = self.db.query(Subscription).filter(
            Subscription.status.in_(['active', 'trial'])
        ).count()

        total_mrr = self.db.query(func.sum(Subscription.price_paid)).filter(
            Subscription.status == 'active',
            Subscription.billing_cycle == 'monthly'
        ).scalar() or 0

        total_yearly = self.db.query(func.sum(Subscription.price_paid)).filter(
            Subscription.status == 'active',
            Subscription.billing_cycle == 'yearly'
        ).scalar() or 0

        return {
            'active_subscriptions': total_active,
            'mrr_cents': total_mrr,
            'arr_cents': total_yearly + (total_mrr * 12),
            'total_revenue_cents': self.db.query(func.sum(Payment.amount)).filter(
                Payment.status == 'success'
            ).scalar() or 0,
        }

# 依赖注入用
from app.core.database import get_db
from fastapi import Depends

def get_billing_service(db: Session = Depends(get_db)) -> BillingService:
    return BillingService(db)
