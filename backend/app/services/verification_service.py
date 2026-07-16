"""Email verification code service.

Supports both real SMTP delivery and a development fallback that logs codes
locally.  Real email is used when the admin has configured and enabled
``email_config`` in SystemConfig; otherwise codes are logged for developers.
"""
import os
import re
import random
import string
import threading
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict
from pydantic import EmailStr
from sqlalchemy.orm import Session

from app.core.config_loader import get_system_config
from app.services.email_sender import send_verification_email_sync, EmailConfig


logger = logging.getLogger(__name__)

# In-memory store: email -> {"code": str, "expires_at": datetime, "attempts": int}
_store: Dict[str, dict] = {}
_lock = threading.Lock()

CODE_LENGTH = 6
CODE_TTL_SECONDS = 600  # 10 minutes
RESEND_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5


def _generate_code(length: int = CODE_LENGTH) -> str:
    """Generate a numeric verification code."""
    return "".join(random.choices(string.digits, k=length))


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _log_code(email: str, code: str) -> None:
    """Log the verification code locally as a development fallback."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    message = (
        f"\n{'='*60}\n"
        f"[DEV VERIFICATION CODE] {timestamp}\n"
        f"  Email: {email}\n"
        f"  Code:  {code}\n"
        f"  Expires in: {CODE_TTL_SECONDS // 60} minutes\n"
        f"{'='*60}\n"
    )
    logger.info(message)

    # Also append to a local file for easy retrieval
    log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "verification_codes.log")
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(message)
    except Exception as e:
        logger.warning(f"Failed to write verification code log: {e}")


def is_valid_email(email: str) -> bool:
    """Basic email validation compatible with Pydantic's EmailStr fallback."""
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return re.match(pattern, email) is not None


def _send_real_email(email: str, code: str, config: EmailConfig) -> None:
    """Blocking SMTP send. Raises on failure."""
    send_verification_email_sync(email, code, config)


def send_code(email: str, db: Optional[Session] = None) -> Dict[str, str]:
    """Generate and send a verification code to the given email.

    Uses real SMTP when ``email_config`` is enabled and configured; otherwise
    falls back to logging the code locally.
    """
    email = _normalize_email(email)
    if not is_valid_email(email):
        raise ValueError("邮箱格式不正确")

    with _lock:
        now = datetime.utcnow()
        existing = _store.get(email)
        if existing:
            last_sent = existing.get("last_sent")
            if last_sent and (now - last_sent).total_seconds() < RESEND_COOLDOWN_SECONDS:
                remaining = int(RESEND_COOLDOWN_SECONDS - (now - last_sent).total_seconds())
                raise ValueError(f"请 {remaining} 秒后重新获取验证码")

        code = _generate_code()
        _store[email] = {
            "code": code,
            "expires_at": now + timedelta(seconds=CODE_TTL_SECONDS),
            "attempts": 0,
            "last_sent": now,
            "verified": False,
        }

    # Attempt real email delivery when configured
    if db is not None:
        try:
            sys_config = get_system_config(db)
            email_config = sys_config.email_config
            if email_config.is_configured:
                _send_real_email(email, code, email_config)
                return {"email": email, "message": "验证码已发送，请查收邮箱"}
        except Exception as e:
            logger.exception("Failed to send verification email")
            raise RuntimeError(f"邮件发送失败，请检查 SMTP 配置: {e}")

    # Development fallback
    _log_code(email, code)
    return {"email": email, "message": "验证码已发送（开发模式：请查看后端控制台或 logs/verification_codes.log）"}


def verify_code(email: str, code: str, consume: bool = False) -> bool:
    """Check whether the provided code is valid for the email."""
    email = _normalize_email(email)
    code = code.strip()
    if not code or not code.isdigit():
        return False

    with _lock:
        record = _store.get(email)
        if not record:
            return False
        if datetime.utcnow() > record["expires_at"]:
            return False
        if record["attempts"] >= MAX_ATTEMPTS:
            return False
        if record["code"] != code:
            record["attempts"] += 1
            return False

        if consume:
            record["verified"] = True
        return True


def is_verified(email: str) -> bool:
    """Return True if the email has been successfully verified (and not expired)."""
    email = _normalize_email(email)
    with _lock:
        record = _store.get(email)
        if not record:
            return False
        if datetime.utcnow() > record["expires_at"]:
            return False
        return record.get("verified", False)


def clear_code(email: str) -> None:
    """Remove the stored code for an email (e.g. after successful registration)."""
    email = _normalize_email(email)
    with _lock:
        _store.pop(email, None)
