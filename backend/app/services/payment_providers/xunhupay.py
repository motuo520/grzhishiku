"""迅虎支付（虎皮椒）聚合支付 provider.

接口规范：https://www.xunhupay.com/doc/api/pay.html
- 下单：POST https://api.xunhupay.com/payment/do.html (json)
- 查询：POST https://api.xunhupay.com/payment/query.html (json)
- 签名 hash：非空参数按参数名 ASCII 升序拼接 key=value&... 后直接拼接 APPSECRET，MD5(32位小写)；hash 自身不参与签名
- 异步通知：POST form 到 notify_url，应答纯文本 success，否则重试 6 次
"""
import json
import time
import uuid
import hmac
import hashlib
from typing import Dict, Any, Optional
from urllib.parse import parse_qs

import httpx

from .base import BasePaymentProvider, PaymentOrder, PaymentResult, PaymentStatus

# 通知状态映射：OD 已支付 / CD 已退款(或已取消) / RD 退款中 / UD 退款失败 / WP 待支付
_STATUS_MAP = {
    "OD": PaymentStatus.SUCCESS,
    "CD": PaymentStatus.REFUNDED,
    "RD": PaymentStatus.PROCESSING,
    "UD": PaymentStatus.FAILED,
    "WP": PaymentStatus.PENDING,
}


class XunhupayProvider(BasePaymentProvider):
    """迅虎支付（虎皮椒）：个人可接入的微信/支付宝统一通道。"""

    API_DO = "https://api.xunhupay.com/payment/do.html"
    API_QUERY = "https://api.xunhupay.com/payment/query.html"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.appid = config.get("appid", "")
        self.app_secret = config.get("app_secret", "")
        self.notify_url = config.get("notify_url", "")
        self.return_url = config.get("return_url", "")
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def _hash(self, params: Dict[str, Any]) -> str:
        """虎皮椒签名：非空参数 ASCII 升序拼接 + APPSECRET 后 MD5（小写）。"""
        items = sorted(
            (k, v) for k, v in params.items()
            if k != "hash" and v is not None and v != ""
        )
        string_a = "&".join(f"{k}={v}" for k, v in items)
        return hashlib.md5((string_a + self.app_secret).encode("utf-8")).hexdigest()

    def _is_configured(self) -> bool:
        return bool(self.appid and self.app_secret)

    async def create_order(self, order: PaymentOrder) -> PaymentOrder:
        """创建虎皮椒订单：返回 url_qrcode（PC 扫码页）与 url（手机跳转）。"""
        if not self._is_configured():
            return self._mock_create_order(order)

        payload = {
            "version": "1.1",
            "appid": self.appid,
            "trade_order_id": order.order_id,
            "total_fee": f"{self.format_amount(order.amount):.2f}".rstrip("0").rstrip(".") or "0",
            "title": self._sanitize_title(order.description),
            "time": int(time.time()),
            "notify_url": self.notify_url,
            "nonce_str": uuid.uuid4().hex[:16],
        }
        if self.return_url:
            payload["return_url"] = self.return_url
        if order.pay_params and order.pay_params.get("attach"):
            payload["attach"] = order.pay_params["attach"]
        payload["hash"] = self._hash(payload)

        try:
            client = self._get_client()
            resp = await client.post(self.API_DO, json=payload)
            data = resp.json()

            if data.get("errcode") != 0:
                order.status = PaymentStatus.FAILED
                order.provider_response = data
                return order

            # 响应签名也要校验（hash 字段不参与）
            if data.get("hash") and not hmac.compare_digest(data["hash"], self._hash(data)):
                order.status = PaymentStatus.FAILED
                order.provider_response = {"error": "invalid response hash", "raw": data}
                return order

            order.provider_order_id = str(data.get("openid") or order.order_id)
            order.provider_response = data
            order.pay_qr_code = data.get("url_qrcode")  # PC 端扫码页/二维码地址
            order.pay_url = data.get("url")             # 手机端跳转链接
            order.status = PaymentStatus.PENDING
        except Exception as e:
            order.status = PaymentStatus.FAILED
            order.provider_response = {"error": str(e)}

        return order

    @staticmethod
    def _sanitize_title(title: str) -> str:
        """订单标题：不能有表情符号和 %，不超过 42 个汉字。"""
        cleaned = title.replace("%", "").strip()
        return cleaned[:42] or "订单支付"

    def _mock_create_order(self, order: PaymentOrder) -> PaymentOrder:
        order.provider_order_id = f"XH{uuid.uuid4().hex[:16].upper()}"
        order.status = PaymentStatus.PENDING
        order.pay_qr_code = f"https://mock.xunhupay.com/pay/{order.provider_order_id}"
        order.provider_response = {
            "errcode": 0,
            "errmsg": "success!",
            "openid": order.provider_order_id,
            "url_qrcode": order.pay_qr_code,
            "url": order.pay_qr_code,
        }
        return order

    async def query_payment(self, order_id: str) -> PaymentResult:
        if not self._is_configured():
            return PaymentResult(
                success=False,
                status=PaymentStatus.PENDING,
                amount=0,
                raw_response={"mock": True, "note": "Use webhook to simulate payment"},
            )

        payload = {
            "appid": self.appid,
            "out_trade_order": order_id,
            "time": int(time.time()),
            "nonce_str": uuid.uuid4().hex[:16],
        }
        payload["hash"] = self._hash(payload)

        try:
            client = self._get_client()
            resp = await client.post(self.API_QUERY, json=payload)
            data = resp.json()

            if data.get("errcode") != 0:
                return PaymentResult(
                    success=False,
                    status=PaymentStatus.FAILED,
                    amount=0,
                    raw_response=data,
                )

            info = data.get("data", {})
            status = _STATUS_MAP.get(info.get("status"), PaymentStatus.PENDING)
            return PaymentResult(
                success=status == PaymentStatus.SUCCESS,
                status=status,
                amount=self.parse_amount(float(info.get("total_fee", 0) or 0)),
                provider_transaction_id=info.get("transaction_id"),
                paid_at=str(info.get("paid_time") or "") or None,
                raw_response=data,
            )
        except Exception as e:
            return PaymentResult(
                success=False,
                status=PaymentStatus.FAILED,
                amount=0,
                error_message=str(e),
            )

    async def verify_webhook(self, headers: Dict[str, str], body: bytes) -> Optional[Dict[str, Any]]:
        """验证虎皮椒异步通知签名（form 表单）。"""
        try:
            text = body.decode("utf-8")
            if headers.get("content-type", "").lower().startswith("application/json"):
                data = json.loads(text)
            else:
                parsed = parse_qs(text, keep_blank_values=True)
                data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        except Exception:
            return None

        if not self._is_configured():
            return data

        received = str(data.get("hash", ""))
        expected = self._hash(data)
        return data if hmac.compare_digest(received, expected) else None

    async def process_webhook(self, data: Dict[str, Any]) -> PaymentResult:
        """处理虎皮椒通知：status=OD 为已支付。"""
        status = _STATUS_MAP.get(data.get("status"), PaymentStatus.PENDING)
        return PaymentResult(
            success=status == PaymentStatus.SUCCESS,
            status=status,
            amount=self.parse_amount(float(data.get("total_fee", 0) or 0)),
            provider_transaction_id=data.get("transaction_id"),
            paid_at=str(data.get("time") or "") or None,
            raw_response=data,
        )

    async def refund(self, order_id: str, amount: int, reason: Optional[str] = None) -> PaymentResult:
        """虎皮椒退款需在商户后台操作，API 不支持。"""
        return PaymentResult(
            success=False,
            status=PaymentStatus.FAILED,
            amount=amount,
            error_message="请登录迅虎支付商户后台手动退款",
        )
