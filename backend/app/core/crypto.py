"""敏感配置的静态加密（encrypt at rest）。

用于平台厂商账户 API Key（model_provider_accounts.api_key）等落库密值。

- 算法：Fernet（AES-128-CBC + HMAC-SHA256），密钥由 SECRET_KEY 经 SHA-256 派生
- 密文格式：enc:v1:<fernet token>（带前缀便于识别与后续算法升级）
- 向后兼容：读取侧对无前缀的存量明文原样透传；写入侧一律加密，
  存量明文随下次写操作自动完成迁移
- ⚠️ 更换 SECRET_KEY 前必须先全量解密再换新密钥重加密，否则密文不可读
"""
import base64
import hashlib
import logging
import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

_PREFIX = "enc:v1:"
logger = logging.getLogger(__name__)


@lru_cache
def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    """加密密值；空值与已加密值原样返回（幂等）。"""
    if not plain or plain.startswith(_PREFIX):
        return plain
    return _PREFIX + _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    """解密；存量明文（无前缀）原样透传，密钥不匹配/密文损坏返回空串。"""
    if not value or not value.startswith(_PREFIX):
        return value or ""
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("解密静态密值失败：密文损坏或密钥不匹配")
        return ""


# ─── 时间胶囊正文落库加密（BUG-M01）────────────────────────────────
#
# - 算法：AES-256-GCM，密钥由 DATABASE_ENCRYPT_KEY 经 HKDF-SHA256 派生
# - 密文格式：v1:<base64(nonce(12B) + ciphertext+tag)>（带版本前缀便于升级）
# - 向后兼容：读取侧对无前缀的存量明文原样透传；写入侧一律加密
# - DATABASE_ENCRYPT_KEY 为空（仅开发/测试允许）时跳过加密，明文透传
_CAPSULE_PREFIX = "v1:"


@lru_cache
def _capsule_aesgcm(raw_key: str) -> AESGCM:
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"qianji-capsule-at-rest",
        info=b"capsule-content-v1",
    ).derive(raw_key.encode("utf-8"))
    return AESGCM(key)


def capsule_encryption_enabled() -> bool:
    return bool(settings.DATABASE_ENCRYPT_KEY)


def should_encrypt_capsule(privacy_encryption_level: Optional[str]) -> bool:
    """标了隐私加密级别的胶囊才加密落库；'none' 显式关闭。"""
    return (privacy_encryption_level or "local").strip().lower() != "none"


def encrypt_capsule_content(plain: Optional[str]) -> Optional[str]:
    """加密胶囊正文；空值/已加密值原样返回（幂等），无密钥时明文透传。"""
    if not plain or plain.startswith(_CAPSULE_PREFIX):
        return plain
    if not capsule_encryption_enabled():
        return plain
    nonce = os.urandom(12)
    ct = _capsule_aesgcm(settings.DATABASE_ENCRYPT_KEY).encrypt(
        nonce, plain.encode("utf-8"), None
    )
    return _CAPSULE_PREFIX + base64.b64encode(nonce + ct).decode("ascii")


def decrypt_capsule_content(value: Optional[str]) -> str:
    """解密胶囊正文；存量明文（无前缀）原样透传，无密钥/密文损坏返回空串。"""
    if not value or not value.startswith(_CAPSULE_PREFIX):
        return value or ""
    if not capsule_encryption_enabled():
        logger.warning("胶囊正文为密文但 DATABASE_ENCRYPT_KEY 未配置，无法解密")
        return ""
    try:
        raw = base64.b64decode(value[len(_CAPSULE_PREFIX):].encode("ascii"))
        nonce, ct = raw[:12], raw[12:]
        return _capsule_aesgcm(settings.DATABASE_ENCRYPT_KEY).decrypt(
            nonce, ct, None
        ).decode("utf-8")
    except Exception:
        logger.warning("解密胶囊正文失败：密文损坏或密钥不匹配")
        return ""
