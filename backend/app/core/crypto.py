"""字段级加密助手：加密落库的敏感凭证（邮箱授权码、OAuth/网盘 token）。

密文带 `enc:v1:` 前缀；读取时无前缀的值按历史明文原样返回（兼容旧数据）。
密钥派生自 settings.DATABASE_ENCRYPT_KEY（SHA-256 后作为 Fernet key）；
未配置密钥时加密为 no-op（开发模式），解密失败返回 None 并记录日志。
"""
import base64
import hashlib
import logging
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet

from app.core.config import settings

logger = logging.getLogger(__name__)

ENC_PREFIX = "enc:v1:"


@lru_cache()
def _fernet() -> Optional[Fernet]:
    key = settings.DATABASE_ENCRYPT_KEY
    if not key:
        return None
    fernet_key = base64.urlsafe_b64encode(hashlib.sha256(key.encode("utf-8")).digest())
    return Fernet(fernet_key)


def encrypt_secret(value: Optional[str]) -> Optional[str]:
    """加密敏感字符串；空值/已加密值原样返回，未配置密钥时返回明文。"""
    if not value or value.startswith(ENC_PREFIX):
        return value
    f = _fernet()
    if f is None:
        return value
    return ENC_PREFIX + f.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    """解密敏感字符串；无 `enc:v1:` 前缀的值按明文原样返回。"""
    if not value or not value.startswith(ENC_PREFIX):
        return value
    f = _fernet()
    if f is None:
        logger.warning("DATABASE_ENCRYPT_KEY 未配置，无法解密已加密的凭证")
        return None
    try:
        return f.decrypt(value[len(ENC_PREFIX):].encode("ascii")).decode("utf-8")
    except Exception:
        logger.exception("凭证解密失败（密钥可能已轮换）")
        return None
