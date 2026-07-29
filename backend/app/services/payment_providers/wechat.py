import json
import time
from datetime import datetime
from typing import Dict, Any, Optional
import uuid

from .base import BasePaymentProvider, PaymentOrder, PaymentResult, PaymentStatus

class WechatProvider(BasePaymentProvider):
    """
    微信支付集成
    
    生产环境依赖：
    pip install wechatpayv3
    
    使用方式：
    1. Native 支付：create_order(qr_code=True) → 返回 pay_qr_code（code_url）
    2. JSAPI（微信内）：create_order(jsapi=True, openid=xxx) → 返回 pay_params
    3. H5 支付：create_order(mobile=True) → 返回 pay_url
    """

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.mchid = config.get("mchid", "")           # 商户号
        self.appid = config.get("appid", "")            # 公众号/小程序 AppID
        self.api_key = config.get("api_key", "")        # API v3 密钥
        self.cert_serial_no = config.get("cert_serial_no", "")
        self.private_key = config.get("cert_private_key", "")
        self.notify_url = config.get("notify_url", "")
        self._client = None

    def _get_client(self):
        """延迟加载微信支付客户端"""
        if self._client is not None:
            return self._client

        # Missing credentials: stay in mock mode so dev/tests keep working
        if not self.mchid or not self.api_key or not self.private_key or not self.cert_serial_no:
            return None

        try:
            from wechatpayv3 import WeChatPay
            self._client = WeChatPay(
                wechatpay_type=WeChatPay.TYPE_DIRECT,
                mchid=self.mchid,
                private_key=self.private_key,
                cert_serial_no=self.cert_serial_no,
                apiv3_key=self.api_key,
                appid=self.appid,
                notify_url=self.notify_url,
            )
            return self._client
        except ImportError:
            return None

    async def create_order(self, order: PaymentOrder) -> PaymentOrder:
        """创建微信支付订单"""
        client = self._get_client()
        
        if client is None:
            return self._mock_create_order(order)

        out_trade_no = order.order_id
        description = order.description[:127]  # 微信限制 127 字符
        amount_yuan = self.format_amount(order.amount)

        # 构建请求
        params = {
            "appid": self.appid,
            "mchid": self.mchid,
            "description": description,
            "notify_url": self.notify_url,
            "out_trade_no": out_trade_no,
            "amount": {"total": order.amount, "currency": "CNY"},
        }

        # 根据场景选择 API
        if order.pay_params and order.pay_params.get("jsapi"):
            # JSAPI（微信浏览器内）
            openid = order.pay_params.get("openid", "")
            params["payer"] = {"openid": openid}
            result = client.jsapi(prepay_id=client.prepay(**params))
            if result:
                order.pay_params = result  # 前端调起支付需要的参数
                order.provider_order_id = out_trade_no
            else:
                order.status = PaymentStatus.FAILED
        
        elif order.pay_params and order.pay_params.get("qr_code"):
            # Native 支付（扫码）
            result = client.native(**params)
            if result.get("code_url"):
                order.pay_qr_code = result["code_url"]
                order.provider_order_id = out_trade_no
                order.provider_response = result
            else:
                order.status = PaymentStatus.FAILED
                order.provider_response = result
        
        elif order.pay_params and order.pay_params.get("mobile"):
            # H5 支付
            scene_info = {
                "payer_client_ip": order.pay_params.get("client_ip", "127.0.0.1"),
                "h5_info": {"type": "Wap", "app_name": "问墨", "app_url": "https://psb.app"},
            }
            params["scene_info"] = scene_info
            result = client.h5(**params)
            if result.get("h5_url"):
                order.pay_url = result["h5_url"]
                order.provider_order_id = out_trade_no
            else:
                order.status = PaymentStatus.FAILED
        
        else:
            # 默认 Native 支付
            result = client.native(**params)
            if result.get("code_url"):
                order.pay_qr_code = result["code_url"]
                order.provider_order_id = out_trade_no
                order.provider_response = result
            else:
                order.status = PaymentStatus.FAILED
                order.provider_response = result

        if order.status != PaymentStatus.FAILED:
            order.status = PaymentStatus.PENDING
        
        return order

    def _mock_create_order(self, order: PaymentOrder) -> PaymentOrder:
        """Mock 创建订单 — 用于开发测试"""
        order.provider_order_id = f"WX{uuid.uuid4().hex[:16].upper()}"
        order.status = PaymentStatus.PENDING
        
        if order.pay_params and order.pay_params.get("jsapi"):
            # 模拟 JSAPI 调起参数
            order.pay_params = {
                "appId": self.appid or "mock_appid",
                "timeStamp": str(int(time.time())),
                "nonceStr": uuid.uuid4().hex[:16],
                "package": f"prepay_id=mock_{order.provider_order_id}",
                "signType": "RSA",
                "paySign": "MOCK_SIGNATURE",
            }
        elif order.pay_params and order.pay_params.get("qr_code"):
            order.pay_qr_code = f"weixin://wxpay/bizpayurl?pr=mock{order.provider_order_id}"
        else:
            order.pay_url = f"https://mock.wechat.com/pay?out_trade_no={order.order_id}"
        
        order.provider_response = {
            "return_code": "SUCCESS",
            "result_code": "SUCCESS",
            "out_trade_no": order.order_id,
            "prepay_id": f"mock_{order.provider_order_id}",
        }
        return order

    async def query_payment(self, order_id: str) -> PaymentResult:
        """查询微信支付订单状态"""
        client = self._get_client()
        
        if client is None:
            return self._mock_query(order_id)

        try:
            result = client.query(out_trade_no=order_id)
            
            if result.get("trade_state") is None:
                return PaymentResult(
                    success=False, status=PaymentStatus.FAILED, amount=0,
                    error_message="Query failed", raw_response=result,
                )

            trade_state = result["trade_state"]
            status_map = {
                "NOTPAY": PaymentStatus.PENDING,
                "CLOSED": PaymentStatus.CANCELLED,
                "SUCCESS": PaymentStatus.SUCCESS,
                "REFUND": PaymentStatus.REFUNDED,
                "REVOKED": PaymentStatus.CANCELLED,
                "USERPAYING": PaymentStatus.PROCESSING,
            }
            
            return PaymentResult(
                success=trade_state == "SUCCESS",
                status=status_map.get(trade_state, PaymentStatus.PENDING),
                amount=result.get("amount", {}).get("total", 0),
                provider_transaction_id=result.get("transaction_id"),
                paid_at=result.get("success_time"),
                raw_response=result,
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
        """验证微信支付回调签名"""
        client = self._get_client()
        if client is None:
            try:
                data = json.loads(body.decode("utf-8"))
                return data
            except:
                return None

        try:
            # 微信使用回调验证
            wechatpay_serial = headers.get("Wechatpay-Serial", "")
            wechatpay_nonce = headers.get("Wechatpay-Nonce", "")
            wechatpay_timestamp = headers.get("Wechatpay-Timestamp", "")
            wechatpay_signature = headers.get("Wechatpay-Signature", "")
            
            # 调用 SDK 验证
            verified = client.callback(
                wechatpay_serial=wechatpay_serial,
                wechatpay_nonce=wechatpay_nonce,
                wechatpay_timestamp=wechatpay_timestamp,
                wechatpay_signature=wechatpay_signature,
                body=body,
            )
            
            if verified:
                return json.loads(body.decode("utf-8"))
            return None
        except Exception:
            return None

    async def process_webhook(self, data: Dict[str, Any]) -> PaymentResult:
        """处理微信支付回调"""
        # 微信回调是加密的，需要解密
        resource = data.get("resource", {})
        ciphertext = resource.get("ciphertext", "")
        associated_data = resource.get("associated_data", "")
        nonce = resource.get("nonce", "")
        
        client = self._get_client()
        if client and hasattr(client, 'decrypt'):
            try:
                decrypted = client.decrypt(ciphertext, nonce, associated_data)
                notify_data = json.loads(decrypted)
            except:
                notify_data = data
        else:
            notify_data = data

        trade_state = notify_data.get("trade_state", "")
        status_map = {
            "NOTPAY": PaymentStatus.PENDING,
            "CLOSED": PaymentStatus.CANCELLED,
            "SUCCESS": PaymentStatus.SUCCESS,
            "REFUND": PaymentStatus.REFUNDED,
        }

        return PaymentResult(
            success=trade_state == "SUCCESS",
            status=status_map.get(trade_state, PaymentStatus.PENDING),
            amount=notify_data.get("amount", {}).get("total", 0),
            provider_transaction_id=notify_data.get("transaction_id"),
            paid_at=notify_data.get("success_time"),
            raw_response=notify_data,
        )

    async def refund(self, order_id: str, amount: int, reason: Optional[str] = None) -> PaymentResult:
        """微信退款"""
        client = self._get_client()
        if client is None:
            return PaymentResult(success=True, status=PaymentStatus.REFUNDED, amount=amount)

        try:
            result = client.refund(
                out_refund_no=f"REF{order_id}",
                out_trade_no=order_id,
                amount={"refund": amount, "total": amount, "currency": "CNY"},
                reason=reason or "用户申请退款",
            )
            
            if result.get("status") == "SUCCESS":
                return PaymentResult(
                    success=True, status=PaymentStatus.REFUNDED, amount=amount,
                    provider_transaction_id=result.get("transaction_id"),
                    raw_response=result,
                )
            else:
                return PaymentResult(
                    success=False, status=PaymentStatus.FAILED, amount=amount,
                    error_message=result.get("message", "Refund failed"),
                    raw_response=result,
                )
        except Exception as e:
            return PaymentResult(
                success=False, status=PaymentStatus.FAILED, amount=amount,
                error_message=str(e),
            )
