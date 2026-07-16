"""Coupon validation, discount calculation and usage tracking."""
import uuid
import json
from datetime import datetime
from decimal import Decimal
from typing import Optional, Dict, Any, List

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.billing import Coupon, CouponUsage, Payment


class CouponError(ValueError):
    """Raised when a coupon cannot be applied."""


class CouponService:
    """Manage coupon lifecycle and discount calculation."""

    def __init__(self, db: Session):
        self.db = db

    def get_coupon_by_code(self, code: str) -> Optional[Coupon]:
        return self.db.query(Coupon).filter(Coupon.code == code).first()

    def validate_code(
        self,
        code: str,
        user_id: str,
        payment_type: str,
        original_amount_cents: int,
        plan_id: Optional[str] = None,
    ) -> Coupon:
        """Validate a coupon for a given context. Raises CouponError if invalid."""
        coupon = self.get_coupon_by_code(code)
        if not coupon:
            raise CouponError("优惠码不存在")
        if not coupon.is_active:
            raise CouponError("优惠码已停用")

        now = datetime.utcnow()
        if coupon.valid_from and coupon.valid_from > now:
            raise CouponError("优惠码尚未生效")
        if coupon.valid_until and coupon.valid_until < now:
            raise CouponError("优惠码已过期")

        if coupon.max_uses is not None and (coupon.used_count or 0) >= coupon.max_uses:
            raise CouponError("优惠码使用次数已达上限")

        if coupon.applies_to != "all" and coupon.applies_to != payment_type:
            raise CouponError(f"该优惠码不适用于 {payment_type}")

        if original_amount_cents < (coupon.min_amount or 0):
            raise CouponError(f"订单金额未满 {self._fmt_amount(coupon.min_amount)} 元")

        if coupon.plan_ids:
            allowed = json.loads(coupon.plan_ids) if isinstance(coupon.plan_ids, str) else coupon.plan_ids
            if plan_id and allowed and plan_id not in allowed:
                raise CouponError("该优惠码不适用于当前套餐")

        # One use per user per coupon
        existing_usage = (
            self.db.query(CouponUsage)
            .filter(CouponUsage.user_id == user_id, CouponUsage.coupon_id == coupon.id)
            .first()
        )
        if existing_usage:
            raise CouponError("您已经使用过该优惠码")

        return coupon

    def calculate_discount(
        self,
        coupon: Coupon,
        original_amount_cents: int,
    ) -> int:
        """Return discount amount in cents (rounded)."""
        if coupon.type == "fixed":
            return min(coupon.value, original_amount_cents)

        if coupon.type == "percent":
            discount = int(Decimal(original_amount_cents) * Decimal(coupon.value) / Decimal(100))
            if coupon.max_discount:
                discount = min(discount, coupon.max_discount)
            return min(discount, original_amount_cents)

        return 0

    def apply_coupon(
        self,
        code: str,
        user_id: str,
        payment_type: str,
        original_amount_cents: int,
        plan_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Validate and calculate discount. Returns summary dict."""
        coupon = self.validate_code(
            code=code,
            user_id=user_id,
            payment_type=payment_type,
            original_amount_cents=original_amount_cents,
            plan_id=plan_id,
        )
        discount = self.calculate_discount(coupon, original_amount_cents)
        final_amount = max(original_amount_cents - discount, 0)
        return {
            "coupon_id": coupon.id,
            "code": coupon.code,
            "type": coupon.type,
            "value": coupon.value,
            "original_amount": original_amount_cents,
            "discount_amount": discount,
            "final_amount": final_amount,
            "currency": coupon.currency,
        }

    def record_usage(
        self,
        user_id: str,
        coupon_id: str,
        payment_id: str,
    ) -> CouponUsage:
        """Record that a coupon was used and increment its usage count."""
        usage = CouponUsage(
            id=f"cu_{uuid.uuid4().hex[:16]}",
            user_id=user_id,
            coupon_id=coupon_id,
            payment_id=payment_id,
        )
        self.db.add(usage)

        coupon = self.db.query(Coupon).filter(Coupon.id == coupon_id).first()
        if coupon:
            coupon.used_count = (coupon.used_count or 0) + 1

        self.db.flush()
        return usage

    def create_coupon(self, data: Dict[str, Any]) -> Coupon:
        """Admin helper to create a coupon."""
        if self.get_coupon_by_code(data["code"]):
            raise CouponError(f"优惠码已存在: {data['code']}")

        coupon = Coupon(
            id=f"coupon_{uuid.uuid4().hex[:16]}",
            code=data["code"],
            type=data.get("type", "percent"),
            value=data["value"],
            currency=data.get("currency", "CNY"),
            min_amount=data.get("min_amount", 0),
            max_discount=data.get("max_discount"),
            valid_from=data.get("valid_from"),
            valid_until=data.get("valid_until"),
            max_uses=data.get("max_uses"),
            used_count=0,
            is_active=data.get("is_active", True),
            applies_to=data.get("applies_to", "all"),
            plan_ids=json.dumps(data["plan_ids"]) if data.get("plan_ids") else None,
            description=data.get("description"),
            extra_data=json.dumps(data.get("extra_data", {})) if data.get("extra_data") else None,
        )
        self.db.add(coupon)
        self.db.flush()
        return coupon

    def list_coupons(
        self,
        active_only: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Coupon]:
        q = self.db.query(Coupon)
        if active_only:
            q = q.filter(Coupon.is_active == True)
        return q.order_by(Coupon.created_at.desc()).offset(skip).limit(limit).all()

    def toggle_coupon(self, coupon_id: str, is_active: bool) -> Coupon:
        coupon = self.db.query(Coupon).filter(Coupon.id == coupon_id).first()
        if not coupon:
            raise CouponError("Coupon not found")
        coupon.is_active = is_active
        self.db.flush()
        return coupon

    @staticmethod
    def _fmt_amount(cents: Optional[int]) -> str:
        if cents is None:
            return "0"
        return f"{cents / 100:.2f}"
