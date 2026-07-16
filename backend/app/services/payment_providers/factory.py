from typing import Dict, Any, Type
from .base import BasePaymentProvider, PaymentProviderType
from .alipay import AlipayProvider
from .wechat import WechatProvider
from .stripe import StripeProvider
from .xorpay import XorpayProvider

# 支付提供商注册表
_PROVIDER_REGISTRY: Dict[PaymentProviderType, Type[BasePaymentProvider]] = {
    PaymentProviderType.ALIPAY: AlipayProvider,
    PaymentProviderType.WECHAT: WechatProvider,
    PaymentProviderType.STRIPE: StripeProvider,
    PaymentProviderType.XORPAY: XorpayProvider,
}

class PaymentProviderFactory:
    """支付提供商工厂 — 统一管理所有支付渠道"""

    def __init__(self, config: Dict[str, Any]):
        """
        config 格式：
        {
            "alipay": {"app_id": "xxx", "private_key": "xxx", ...},
            "wechat": {"mchid": "xxx", "appid": "xxx", ...},
            "stripe": {"api_key": "sk_xxx", "webhook_secret": "whsec_xxx", ...},
        }
        """
        self.config = config
        self._providers: Dict[PaymentProviderType, BasePaymentProvider] = {}

    def get_provider(self, provider_type: PaymentProviderType) -> BasePaymentProvider:
        """获取或创建支付提供商实例（单例）"""
        if provider_type not in self._providers:
            provider_class = _PROVIDER_REGISTRY.get(provider_type)
            if not provider_class:
                raise ValueError(f"Unknown payment provider: {provider_type}")
            
            provider_config = self.config.get(provider_type.value, {})
            self._providers[provider_type] = provider_class(provider_config)
        
        return self._providers[provider_type]

    def get_available_providers(self) -> Dict[str, str]:
        """Return available payment providers based on credential presence and enabled flag."""
        available = {}
        credential_fields = {
            PaymentProviderType.ALIPAY: ["app_id", "private_key", "public_key"],
            PaymentProviderType.WECHAT: ["mchid", "api_key", "private_key", "cert_serial_no"],
            PaymentProviderType.STRIPE: ["api_key"],
            PaymentProviderType.XORPAY: ["aid", "app_secret"],
        }
        for pt in PaymentProviderType:
            provider_config = self.config.get(pt.value, {})
            if not provider_config.get("enabled", False):
                continue
            fields = credential_fields.get(pt, [])
            if any(provider_config.get(f) for f in fields):
                available[pt.value] = pt.value
        return available

    def list_all(self) -> Dict[str, str]:
        """返回所有支持的支付提供商"""
        return {pt.value: pt.value for pt in PaymentProviderType}

# 全局单例（由 FastAPI dependency 注入）
_payment_factory: PaymentProviderFactory = None

def init_payment_factory(config: Dict[str, Any]) -> PaymentProviderFactory:
    """初始化全局支付工厂"""
    global _payment_factory
    _payment_factory = PaymentProviderFactory(config)
    return _payment_factory

def get_payment_factory() -> PaymentProviderFactory:
    """获取全局支付工厂"""
    if _payment_factory is None:
        raise RuntimeError("Payment factory not initialized. Call init_payment_factory first.")
    return _payment_factory
