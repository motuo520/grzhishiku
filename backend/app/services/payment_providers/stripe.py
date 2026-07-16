import json
from datetime import datetime
from typing import Dict, Any, Optional
import uuid

from .base import BasePaymentProvider, PaymentOrder, PaymentResult, PaymentStatus

class StripeProvider(BasePaymentProvider):
    """
    Stripe 支付集成
    
    生产环境依赖：
    pip install stripe
    
    使用方式：
    1. Checkout Session：create_order → 返回 pay_url（Stripe 托管页面）
    2. Elements（内嵌）：前端直接调 Stripe.js，后端只创建 PaymentIntent
    """

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get("secret_key", "")
        self.webhook_secret = config.get("webhook_secret", "")
        self.success_url = config.get("success_url", "")
        self.cancel_url = config.get("cancel_url", "")
        self._client = None

    def _get_client(self):
        """延迟加载 Stripe 客户端"""
        if self._client is not None:
            return self._client

        # Missing credentials: stay in mock mode so dev/tests keep working
        if not self.api_key:
            return None

        try:
            import stripe
            stripe.api_key = self.api_key
            self._client = stripe
            return self._client
        except ImportError:
            return None

    async def create_order(self, order: PaymentOrder) -> PaymentOrder:
        """创建 Stripe Checkout Session 或 PaymentIntent"""
        stripe = self._get_client()
        
        if stripe is None:
            return self._mock_create_order(order)

        # Stripe 金额单位：分（和本系统一致）
        # 但 Stripe 要求最低金额因货币而异，CNY 最低 1 元 = 100 分

        if order.pay_params and order.pay_params.get("elements"):
            # PaymentIntent 模式（前端 Stripe Elements 内嵌）
            intent = stripe.PaymentIntent.create(
                amount=order.amount,
                currency=order.currency.lower(),
                description=order.description,
                metadata={"order_id": order.order_id, "user_id": order.user_id},
                automatic_payment_methods={"enabled": True},
            )
            order.provider_order_id = intent.id
            order.pay_params = {"client_secret": intent.client_secret}
            order.status = PaymentStatus.PENDING
        else:
            # Checkout Session 模式（Stripe 托管页面）
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[{
                    "price_data": {
                        "currency": order.currency.lower(),
                        "product_data": {"name": order.description},
                        "unit_amount": order.amount,
                    },
                    "quantity": 1,
                }],
                mode="payment",
                success_url=f"{self.success_url}?session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=self.cancel_url,
                metadata={"order_id": order.order_id, "user_id": order.user_id},
            )
            order.provider_order_id = session.id
            order.pay_url = session.url
            order.status = PaymentStatus.PENDING

        return order

    def _mock_create_order(self, order: PaymentOrder) -> PaymentOrder:
        """Mock 创建订单"""
        order.provider_order_id = f"pi_mock_{uuid.uuid4().hex[:16]}"
        order.status = PaymentStatus.PENDING
        
        if order.pay_params and order.pay_params.get("elements"):
            order.pay_params = {
                "client_secret": f"{order.provider_order_id}_secret_mock",
            }
        else:
            order.pay_url = f"https://mock.stripe.com/checkout/{order.provider_order_id}"
        
        order.provider_response = {
            "id": order.provider_order_id,
            "status": "requires_payment_method",
            "amount": order.amount,
            "currency": order.currency.lower(),
        }
        return order

    async def query_payment(self, order_id: str) -> PaymentResult:
        """查询 Stripe 支付状态"""
        stripe = self._get_client()
        
        if stripe is None:
            return self._mock_query(order_id)

        try:
            # order_id 在 Stripe 中是 PaymentIntent ID 或 Checkout Session ID
            # 先尝试 PaymentIntent
            if order_id.startswith("pi_"):
                intent = stripe.PaymentIntent.retrieve(order_id)
                status_map = {
                    "requires_payment_method": PaymentStatus.PENDING,
                    "requires_confirmation": PaymentStatus.PENDING,
                    "requires_action": PaymentStatus.PROCESSING,
                    "processing": PaymentStatus.PROCESSING,
                    "succeeded": PaymentStatus.SUCCESS,
                    "canceled": PaymentStatus.CANCELLED,
                }
                
                return PaymentResult(
                    success=intent.status == "succeeded",
                    status=status_map.get(intent.status, PaymentStatus.PENDING),
                    amount=intent.amount,
                    provider_transaction_id=intent.charges.data[0].id if intent.charges.data else None,
                    paid_at=datetime.fromtimestamp(intent.charges.data[0].created).isoformat() if intent.charges.data else None,
                    raw_response={"id": intent.id, "status": intent.status},
                )
            else:
                # Checkout Session
                session = stripe.checkout.Session.retrieve(order_id)
                if session.payment_intent:
                    return await self.query_payment(session.payment_intent)
                return PaymentResult(
                    success=False, status=PaymentStatus.PENDING, amount=0,
                    raw_response={"session_id": order_id, "status": session.status},
                )
        except Exception as e:
            return PaymentResult(
                success=False, status=PaymentStatus.FAILED, amount=0,
                error_message=str(e),
            )

    def _mock_query(self, order_id: str) -> PaymentResult:
        """Mock 查询"""
        return PaymentResult(
            success=False, status=PaymentStatus.PENDING, amount=0,
            raw_response={"mock": True, "note": "Use webhook to simulate payment"},
        )

    async def verify_webhook(self, headers: Dict[str, str], body: bytes) -> Optional[Dict[str, Any]]:
        """验证 Stripe Webhook 签名"""
        stripe = self._get_client()
        if stripe is None:
            try:
                return json.loads(body.decode("utf-8"))
            except:
                return None

        try:
            sig_header = headers.get("stripe-signature", "")
            event = stripe.Webhook.construct_event(
                body, sig_header, self.webhook_secret
            )
            return event
        except Exception:
            return None

    async def process_webhook(self, data: Dict[str, Any]) -> PaymentResult:
        """处理 Stripe Webhook"""
        event_type = data.get("type", "")
        event_data = data.get("data", {}).get("object", {})

        if event_type == "payment_intent.succeeded":
            return PaymentResult(
                success=True,
                status=PaymentStatus.SUCCESS,
                amount=event_data.get("amount", 0),
                provider_transaction_id=event_data.get("charges", {}).get("data", [{}])[0].get("id"),
                paid_at=datetime.fromtimestamp(event_data.get("created", 0)).isoformat() if event_data.get("created") else None,
                raw_response=data,
            )
        elif event_type == "payment_intent.payment_failed":
            error = event_data.get("last_payment_error", {})
            return PaymentResult(
                success=False,
                status=PaymentStatus.FAILED,
                amount=event_data.get("amount", 0),
                error_message=error.get("message", "Payment failed"),
                raw_response=data,
            )
        elif event_type == "charge.refunded":
            return PaymentResult(
                success=True,
                status=PaymentStatus.REFUNDED,
                amount=event_data.get("amount_refunded", 0),
                provider_transaction_id=event_data.get("id"),
                raw_response=data,
            )
        else:
            return PaymentResult(
                success=False,
                status=PaymentStatus.PENDING,
                amount=0,
                raw_response=data,
            )

    async def refund(self, order_id: str, amount: int, reason: Optional[str] = None) -> PaymentResult:
        """Stripe 退款"""
        stripe = self._get_client()
        if stripe is None:
            return PaymentResult(success=True, status=PaymentStatus.REFUNDED, amount=amount)

        try:
            # order_id 是 PaymentIntent ID
            intent = stripe.PaymentIntent.retrieve(order_id)
            charge_id = intent.charges.data[0].id if intent.charges.data else None
            
            if not charge_id:
                return PaymentResult(
                    success=False, status=PaymentStatus.FAILED, amount=amount,
                    error_message="No charge found for refund",
                )

            refund = stripe.Refund.create(
                charge=charge_id,
                amount=amount,
                reason="requested_by_customer" if reason else None,
            )
            
            if refund.status == "succeeded":
                return PaymentResult(
                    success=True, status=PaymentStatus.REFUNDED, amount=amount,
                    provider_transaction_id=refund.id,
                    raw_response={"refund_id": refund.id, "status": refund.status},
                )
            else:
                return PaymentResult(
                    success=False, status=PaymentStatus.FAILED, amount=amount,
                    error_message=f"Refund status: {refund.status}",
                    raw_response={"refund_id": refund.id, "status": refund.status},
                )
        except Exception as e:
            return PaymentResult(
                success=False, status=PaymentStatus.FAILED, amount=amount,
                error_message=str(e),
            )
