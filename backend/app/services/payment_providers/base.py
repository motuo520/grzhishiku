from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum

class PaymentProviderType(str, Enum):
    ALIPAY = "alipay"
    WECHAT = "wechat"
    STRIPE = "stripe"
    XORPAY = "xorpay"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCESS = "success"
    FAILED = "failed"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"

@dataclass
class PaymentOrder:
    """统一支付订单"""
    order_id: str
    amount: int              # 分
    currency: str
    description: str
    user_id: str
    provider: PaymentProviderType
    provider_order_id: Optional[str] = None  # 第三方订单号
    provider_response: Optional[Dict[str, Any]] = None
    pay_url: Optional[str] = None            # 跳转支付链接
    pay_qr_code: Optional[str] = None        # Base64 QR 图
    pay_params: Optional[Dict[str, Any]] = None  # JSAPI 参数
    status: PaymentStatus = PaymentStatus.PENDING
    created_at: Optional[str] = None
    paid_at: Optional[str] = None

@dataclass
class PaymentResult:
    """支付结果查询"""
    success: bool
    status: PaymentStatus
    amount: int
    provider_transaction_id: Optional[str] = None
    paid_at: Optional[str] = None
    raw_response: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

class BasePaymentProvider(ABC):
    """支付提供商抽象基类"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.name = self.__class__.__name__.replace("Provider", "").lower()

    @abstractmethod
    async def create_order(self, order: PaymentOrder) -> PaymentOrder:
        """创建支付订单，返回带支付参数的订单"""
        pass

    @abstractmethod
    async def query_payment(self, order_id: str) -> PaymentResult:
        """查询支付结果"""
        pass

    @abstractmethod
    async def verify_webhook(self, headers: Dict[str, str], body: bytes) -> Optional[Dict[str, Any]]:
        """验证 Webhook 签名，返回解析后的数据或 None"""
        pass

    @abstractmethod
    async def process_webhook(self, data: Dict[str, Any]) -> PaymentResult:
        """处理 Webhook 通知，返回支付结果"""
        pass

    @abstractmethod
    async def refund(self, order_id: str, amount: int, reason: Optional[str] = None) -> PaymentResult:
        """发起退款"""
        pass

    def format_amount(self, amount_cents: int) -> float:
        """分转元"""
        return amount_cents / 100

    def parse_amount(self, amount_yuan: float) -> int:
        """元转分"""
        return int(amount_yuan * 100)
