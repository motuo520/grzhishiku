"""Xorpay (虎皮椒) 聚合支付 provider.

Xorpay 支持个人接入微信/支付宝 Native/JSAPI/H5 等支付方式，
通过统一的 API 创建订单并接收异步通知。

官方文档: https://xorpay.com/api
"""
import json
import time
import uuid
import hmac
import hashlib
from typing import Dict, Any, Optional
from urllib.parse import urlencode

import httpx

from .base import BasePaymentProvider, PaymentOrder, PaymentResult, PaymentStatus


class XorpayProvider(BasePaymentProvider):
    """Xorpay 聚合支付：个人可接入的微信/支付宝统一通道。"""

    API_BASE = "https://xorpay.com/api"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.aid = config.get("aid", "")          # 商户号
        self.app_secret = config.get("app_secret", "")  # 密钥
        self.notify_url = config.get("notify_url", "")
        self.return_url = config.get("return_url", "")
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def _sign(self, params: Dict[str, Any]) -> str:
        """Xorpay 签名：参数按 key 升序拼接 + app_secret 后 MD5。"""
        filtered = {k: v for k, v in params.items() if v not in (None, "") and k != "sign"}
        sorted_items = sorted(filtered.items(), key=lambda x: x[0])
        query = urlencode(sorted_items, doseq=True)
        sign_str = f"{query}{self.app_secret}"
        return hashlib.md5(sign_str.encode("utf-8")).hexdigest()

    def _is_configured(self) -> bool:
        return bool(self.aid and self.app_secret)

    async def create_order(self, order: PaymentOrder) -> PaymentOrder:
        """创建 Xorpay 订单。

        默认使用 Native 支付（返回 code_url 供前端生成二维码）。
        可通过 pay_params 指定：qr_code / jsapi / mobile。
        """
        if not self._is_configured():
            return self._mock_create_order(order)

        pay_type = "native"
        if order.pay_params:
            if order.pay_params.get("jsapi"):
                pay_type = "jsapi"
            elif order.pay_params.get("mobile"):
                pay_type = "h5"
            elif order.pay_params.get("qr_code"):
                pay_type = "native"

        payload = {
            "aid": self.aid,
            "out_trade_no": order.order_id,
            "amount": f"{self.format_amount(order.amount):.2f}",
            "title": order.description[:50],
            "notify_url": self.notify_url,
            "return_url": self.return_url,
            "pay_type": pay_type,
            "nonce_str": uuid.uuid4().hex[:16],
        }
        payload["sign"] = self._sign(payload)

        try:
            client = self._get_client()
            resp = await client.post(f"{self.API_BASE}/pay/create", data=payload)
            data = resp.json()

            if data.get("status") != "success":
                order.status = PaymentStatus.FAILED
                order.provider_response = data
                return order

            result = data.get("info", {})
            order.provider_order_id = result.get("trade_no") or order.order_id
            order.provider_response = data

            if pay_type == "native":
                order.pay_qr_code = result.get("code_url")
            elif pay_type == "h5":
                order.pay_url = result.get("pay_url")
            elif pay_type == "jsapi":
                # JSAPI 参数直接返回给前端调起微信支付
                order.pay_params = result.get("jsapi_params") or result

            order.status = PaymentStatus.PENDING
        except Exception as e:
            order.status = PaymentStatus.FAILED
            order.provider_response = {"error": str(e)}

        return order

    def _mock_create_order(self, order: PaymentOrder) -> PaymentOrder:
        order.provider_order_id = f"XOR{uuid.uuid4().hex[:16].upper()}"
        order.status = PaymentStatus.PENDING
        order.pay_qr_code = f"https://mock.xorpay.com/pay/{order.provider_order_id}"
        order.provider_response = {
            "status": "success",
            "info": {"trade_no": order.provider_order_id, "code_url": order.pay_qr_code},
        }
        return order

    async def query_payment(self, order_id: str) -> PaymentResult:
        if not self._is_configured():
            return self._mock_query(order_id)

        payload = {
            "aid": self.aid,
            "out_trade_no": order_id,
            "nonce_str": uuid.uuid4().hex[:16],
        }
        payload["sign"] = self._sign(payload)

        try:
            client = self._get_client()
            resp = await client.post(f"{self.API_BASE}/pay/query", data=payload)
            data = resp.json()

            if data.get("status") != "success":
                return PaymentResult(
                    success=False,
                    status=PaymentStatus.FAILED,
                    amount=0,
                    raw_response=data,
                )

            info = data.get("info", {})
            status_map = {
                "notpay": PaymentStatus.PENDING,
                "success": PaymentStatus.SUCCESS,
                "closed": PaymentStatus.CANCELLED,
                "refund": PaymentStatus.REFUNDED,
            }
            status = status_map.get(info.get("status"), PaymentStatus.PENDING)
            return PaymentResult(
                success=status == PaymentStatus.SUCCESS,
                status=status,
                amount=self.parse_amount(float(info.get("amount", 0))),
                provider_transaction_id=info.get("transaction_id"),
                paid_at=info.get("paid_at"),
                raw_response=data,
            )
        except Exception as e:
            return PaymentResult(
                success=False,
                status=PaymentStatus.FAILED,
                amount=0,
                error_message=str(e),
            )

    def _mock_query(self, order_id: str) -> PaymentResult:
        return PaymentResult(
            success=False,
            status=PaymentStatus.PENDING,
            amount=0,
            raw_response={"mock": True, "note": "Use webhook to simulate payment"},
        )

    async def verify_webhook(self, headers: Dict[str, str], body: bytes) -> Optional[Dict[str, Any]]:
        """验证 Xorpay 异步通知签名。"""
        try:
            if headers.get("content-type", "").lower().startswith("application/json"):
                data = json.loads(body.decode("utf-8"))
            else:
                from urllib.parse import parse_qs
                parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True)
                data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        except Exception:
            return None

        if not self._is_configured():
            return data

        sign = data.pop("sign", "")
        expected = self._sign(data)
        data["sign"] = sign  # 保留原始 sign 便于调试
        return data if hmac.compare_digest(sign, expected) else None

    async def process_webhook(self, data: Dict[str, Any]) -> PaymentResult:
        """处理 Xorpay 通知。"""
        info = data.get("info", data)
        status_map = {
            "notpay": PaymentStatus.PENDING,
            "success": PaymentStatus.SUCCESS,
            "closed": PaymentStatus.CANCELLED,
            "refund": PaymentStatus.REFUNDED,
        }
        status = status_map.get(info.get("status"), PaymentStatus.PENDING)
        return PaymentResult(
            success=status == PaymentStatus.SUCCESS,
            status=status,
            amount=self.parse_amount(float(info.get("amount", 0))),
            provider_transaction_id=info.get("transaction_id"),
            paid_at=info.get("paid_at"),
            raw_response=data,
        )

    async def refund(self, order_id: str, amount: int, reason: Optional[str] = None) -> PaymentResult:
        """Xorpay 退款（如接口不可用则返回失败）。"""
        # Xorpay 早期版本退款需登录后台操作，这里预留结构
        return PaymentResult(
            success=False,
            status=PaymentStatus.FAILED,
            amount=amount,
            error_message="请登录 Xorpay 商户后台手动退款",
        )
