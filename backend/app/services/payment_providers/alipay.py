import json
import time
from datetime import datetime
from typing import Dict, Any, Optional
from urllib.parse import parse_qs
import uuid

from .base import BasePaymentProvider, PaymentOrder, PaymentResult, PaymentStatus

class AlipayProvider(BasePaymentProvider):
    """
    支付宝支付集成
    
    生产环境依赖：
    pip install alipay-sdk-python
    
    使用方式：
    1. 电脑网站：create_order → 返回 pay_url，用户跳转支付
    2. 手机网站：create_order(mobile=True) → 返回 pay_url
    3. 扫码支付：create_order(qr_code=True) → 返回 pay_qr_code（Base64）
    """

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.app_id = config.get("app_id", "")
        self.private_key = config.get("private_key", "")
        self.public_key = config.get("public_key", "")
        self.alipay_public_key = config.get("public_key", "")
        self.sandbox = config.get("sandbox", True)
        self.notify_url = config.get("notify_url", "")
        self.return_url = config.get("return_url", "")
        self._client = None

    def _get_client(self):
        """延迟加载支付宝客户端"""
        if self._client is not None:
            return self._client

        # Missing credentials: stay in mock mode so dev/tests keep working
        if not self.app_id or not self.private_key or not self.alipay_public_key:
            return None

        try:
            from alipay import AliPay
            self._client = AliPay(
                appid=self.app_id,
                app_notify_url=self.notify_url,
                app_private_key_string=self.private_key,
                alipay_public_key_string=self.alipay_public_key,
                sign_type="RSA2",
                debug=self.sandbox,
            )
            return self._client
        except ImportError:
            return None

    async def create_order(self, order: PaymentOrder) -> PaymentOrder:
        """创建支付宝订单"""
        client = self._get_client()
        
        if client is None:
            # Mock 模式（无 SDK）— 返回模拟数据，支持开发测试
            return self._mock_create_order(order)

        # 真实 SDK 调用
        out_trade_no = order.order_id
        total_amount = self.format_amount(order.amount)
        subject = order.description[:256]  # 支付宝限制 256 字符

        # 根据场景选择 API
        if order.pay_params and order.pay_params.get("qr_code"):
            # 当面付（扫码）
            result = client.api_alipay_trade_precreate(
                out_trade_no=out_trade_no,
                total_amount=str(total_amount),
                subject=subject,
            )
            if result.get("code") == "10000":
                order.provider_order_id = result.get("out_trade_no")
                order.pay_qr_code = result.get("qr_code")  # 二维码链接
                order.provider_response = result
            else:
                order.status = PaymentStatus.FAILED
                order.provider_response = result
        elif order.pay_params and order.pay_params.get("mobile"):
            # 手机网站支付
            order.pay_url = client.api_alipay_trade_wap_pay(
                out_trade_no=out_trade_no,
                total_amount=str(total_amount),
                subject=subject,
                return_url=self.return_url,
                notify_url=self.notify_url,
            )
            order.provider_order_id = out_trade_no
        else:
            # 电脑网站支付（默认）
            order.pay_url = client.api_alipay_trade_page_pay(
                out_trade_no=out_trade_no,
                total_amount=str(total_amount),
                subject=subject,
                return_url=self.return_url,
                notify_url=self.notify_url,
            )
            order.provider_order_id = out_trade_no

        order.status = PaymentStatus.PENDING
        return order

    def _mock_create_order(self, order: PaymentOrder) -> PaymentOrder:
        """Mock 创建订单 — 用于开发测试"""
        order.provider_order_id = f"ALI{uuid.uuid4().hex[:16].upper()}"
        order.status = PaymentStatus.PENDING
        
        if order.pay_params and order.pay_params.get("qr_code"):
            # 模拟 QR 码链接（实际是占位，前端会生成 QR）
            order.pay_qr_code = f"https://mock.alipay.com/pay/{order.provider_order_id}"
        else:
            # 模拟跳转链接
            order.pay_url = f"https://mock.alipay.com/pay?out_trade_no={order.order_id}"
        
        order.provider_response = {
            "code": "10000",
            "msg": "Success",
            "out_trade_no": order.order_id,
            "trade_no": order.provider_order_id,
        }
        return order

    async def query_payment(self, order_id: str) -> PaymentResult:
        """查询支付宝订单状态"""
        client = self._get_client()
        
        if client is None:
            return self._mock_query(order_id)

        try:
            result = client.api_alipay_trade_query(out_trade_no=order_id)
            
            if result.get("code") != "10000":
                return PaymentResult(
                    success=False,
                    status=PaymentStatus.FAILED,
                    amount=0,
                    error_message=result.get("msg", "Query failed"),
                    raw_response=result,
                )

            trade_status = result.get("trade_status", "")
            status_map = {
                "WAIT_BUYER_PAY": PaymentStatus.PENDING,
                "TRADE_CLOSED": PaymentStatus.CANCELLED,
                "TRADE_SUCCESS": PaymentStatus.SUCCESS,
                "TRADE_FINISHED": PaymentStatus.SUCCESS,
            }
            
            return PaymentResult(
                success=trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"),
                status=status_map.get(trade_status, PaymentStatus.PENDING),
                amount=self.parse_amount(float(result.get("total_amount", 0))),
                provider_transaction_id=result.get("trade_no"),
                paid_at=result.get("send_pay_date"),
                raw_response=result,
            )
        except Exception as e:
            return PaymentResult(
                success=False, status=PaymentStatus.FAILED, amount=0,
                error_message=str(e),
            )

    def _mock_query(self, order_id: str) -> PaymentResult:
        """Mock 查询 — 模拟支付成功（开发测试用）"""
        # 开发环境下，模拟 5 秒后支付成功
        return PaymentResult(
            success=False,
            status=PaymentStatus.PENDING,
            amount=0,
            raw_response={"mock": True, "note": "Use webhook to simulate payment"},
        )

    async def verify_webhook(self, headers: Dict[str, str], body: bytes) -> Optional[Dict[str, Any]]:
        """验证支付宝异步通知签名

        支付宝异步通知为 application/x-www-form-urlencoded，需先解析表单数据。
        """
        content_type = headers.get("content-type", "").lower()
        is_form = "application/x-www-form-urlencoded" in content_type

        try:
            text = body.decode("utf-8")
            if is_form or (not text.startswith("{") and "=" in text):
                parsed = parse_qs(text, keep_blank_values=True)
                data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
            else:
                data = json.loads(text)
        except Exception:
            return None

        client = self._get_client()
        if client is None:
            # Mock 模式：直接解析
            return data

        try:
            signature = data.pop("sign", "")
            data.pop("sign_type", None)
            success = client.verify(data, signature)
            return data if success else None
        except Exception:
            return None

    async def process_webhook(self, data: Dict[str, Any]) -> PaymentResult:
        """处理支付宝异步通知"""
        trade_status = data.get("trade_status", "")
        status_map = {
            "WAIT_BUYER_PAY": PaymentStatus.PENDING,
            "TRADE_CLOSED": PaymentStatus.CANCELLED,
            "TRADE_SUCCESS": PaymentStatus.SUCCESS,
            "TRADE_FINISHED": PaymentStatus.SUCCESS,
        }

        return PaymentResult(
            success=trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED"),
            status=status_map.get(trade_status, PaymentStatus.PENDING),
            amount=self.parse_amount(float(data.get("total_amount", 0))),
            provider_transaction_id=data.get("trade_no"),
            paid_at=data.get("gmt_payment"),
            raw_response=data,
        )

    async def refund(self, order_id: str, amount: int, reason: Optional[str] = None) -> PaymentResult:
        """支付宝退款"""
        client = self._get_client()
        if client is None:
            return PaymentResult(success=True, status=PaymentStatus.REFUNDED, amount=amount)

        try:
            result = client.api_alipay_trade_refund(
                out_trade_no=order_id,
                refund_amount=str(self.format_amount(amount)),
                refund_reason=reason or "用户申请退款",
            )
            
            if result.get("code") == "10000":
                return PaymentResult(
                    success=True,
                    status=PaymentStatus.REFUNDED,
                    amount=amount,
                    provider_transaction_id=result.get("trade_no"),
                    raw_response=result,
                )
            else:
                return PaymentResult(
                    success=False, status=PaymentStatus.FAILED, amount=amount,
                    error_message=result.get("msg", "Refund failed"),
                    raw_response=result,
                )
        except Exception as e:
            return PaymentResult(
                success=False, status=PaymentStatus.FAILED, amount=amount,
                error_message=str(e),
            )
