from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base

class Plan(Base):
    __tablename__ = "plans"
    
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True)
    description = Column(Text)
    price_monthly = Column(Integer, default=0)       # 分
    price_yearly = Column(Integer, default=0)          # 分
    currency = Column(String, default='CNY')
    billing_cycle = Column(String, default='monthly')  # monthly / yearly / both / none
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    features = Column(Text)     # JSON
    limits = Column(Text)       # JSON
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Subscription(Base):
    __tablename__ = "subscriptions"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    plan_id = Column(String, nullable=False)
    coupon_id = Column(String, ForeignKey("coupons.id"))
    status = Column(String, default='active')  # active / cancelled / expired / paused / trial
    billing_cycle = Column(String, default='monthly')
    price_paid = Column(Integer, default=0)
    currency = Column(String, default='CNY')
    started_at = Column(DateTime, nullable=False)
    current_period_start = Column(DateTime, nullable=False)
    current_period_end = Column(DateTime, nullable=False)
    cancelled_at = Column(DateTime)
    cancel_reason = Column(String)
    payment_method = Column(String)
    payment_provider_id = Column(String)
    auto_renew = Column(Boolean, default=True)
    trial_end = Column(DateTime)
    extra_data = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Coupon(Base):
    __tablename__ = "coupons"

    id = Column(String, primary_key=True)
    code = Column(String, nullable=False, unique=True)
    type = Column(String, nullable=False, default='percent')  # percent / fixed
    value = Column(Integer, nullable=False)  # percent: 1-100; fixed: cents
    currency = Column(String, default='CNY')
    min_amount = Column(Integer, default=0)  # minimum original amount in cents
    max_discount = Column(Integer)           # maximum discount in cents (for percent coupons)
    valid_from = Column(DateTime)
    valid_until = Column(DateTime)
    max_uses = Column(Integer)               # null = unlimited
    used_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    applies_to = Column(String, default='all')  # subscription / topup / all
    plan_ids = Column(Text)                  # JSON list of plan ids, null = all plans
    description = Column(String)
    extra_data = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CouponUsage(Base):
    __tablename__ = "coupon_usages"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    coupon_id = Column(String, ForeignKey("coupons.id"), nullable=False)
    payment_id = Column(String, ForeignKey("payments.id"), nullable=False)
    used_at = Column(DateTime, server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    subscription_id = Column(String)
    plan_id = Column(String)
    amount = Column(Integer, nullable=False)              # final amount in cents
    original_amount = Column(Integer, default=0)          # before discount
    discount_amount = Column(Integer, default=0)          # coupon discount in cents
    currency = Column(String, default='CNY')
    status = Column(String, default='pending')  # pending / success / failed / refunded / cancelled
    payment_type = Column(String, default='subscription')  # subscription / topup
    payment_method = Column(String)
    payment_provider = Column(String)
    provider_transaction_id = Column(String)
    provider_order_id = Column(String)
    provider_response = Column(Text)
    balance_added = Column(Integer, default=0)  # cents, only meaningful for topup
    coupon_id = Column(String, ForeignKey("coupons.id"))
    paid_at = Column(DateTime)
    refunded_at = Column(DateTime)
    refund_amount = Column(Integer, default=0)
    invoice_id = Column(String)
    description = Column(String)
    extra_data = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Invoice(Base):
    __tablename__ = "invoices"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    subscription_id = Column(String)
    payment_id = Column(String)
    invoice_number = Column(String, nullable=False, unique=True)
    amount = Column(Integer, nullable=False)
    tax_amount = Column(Integer, default=0)
    currency = Column(String, default='CNY')
    status = Column(String, default='pending')  # pending / issued / paid / void
    invoice_type = Column(String, default='personal')  # personal / enterprise / vat
    title = Column(String)
    tax_number = Column(String)
    email = Column(String)
    issued_at = Column(DateTime)
    paid_at = Column(DateTime)
    items = Column(Text)
    extra_data = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
