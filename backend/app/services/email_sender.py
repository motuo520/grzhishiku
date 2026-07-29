"""SMTP email sender for system notifications and verification codes.

This module provides a small synchronous wrapper around Python's standard
library ``smtplib``.  It is intentionally dependency-free (no aiosmtplib) and
runs the blocking send inside ``asyncio.to_thread`` when called from async
FastAPI endpoints.
"""
import logging
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Optional
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


class EmailConfig(BaseModel):
    """SMTP configuration stored in system_configs."""

    enabled: bool = False
    smtp_host: str = Field(default="", description="SMTP server hostname")
    smtp_port: int = Field(default=587, ge=1, le=65535)
    username: str = Field(default="", description="SMTP login username")
    password: str = Field(default="", description="SMTP login password")
    sender_email: str = Field(default="", description="Envelope From address")
    sender_name: str = Field(default="", description="Friendly From name")
    use_tls: bool = Field(default=True, description="Use STARTTLS on smtp_port")
    use_ssl: bool = Field(default=False, description="Use SSL wrapper (e.g. port 465)")

    @property
    def is_configured(self) -> bool:
        return bool(self.enabled and self.smtp_host and self.username and self.password and self.sender_email)


def _build_message(to_email: str, subject: str, body: str, config: EmailConfig) -> MIMEText:
    sender = formataddr((config.sender_name or config.sender_email.split("@")[0], config.sender_email))
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    return msg


def send_email_sync(
    to_email: str,
    subject: str,
    body: str,
    config: EmailConfig,
) -> None:
    """Synchronous SMTP send. Raises on failure."""
    if not config.is_configured:
        raise RuntimeError("Email is not configured or not enabled")

    msg = _build_message(to_email, subject, body, config)

    if config.use_ssl:
        server = smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, timeout=15)
    else:
        server = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=15)

    try:
        if config.use_tls and not config.use_ssl:
            server.starttls()
        server.login(config.username, config.password)
        server.sendmail(config.sender_email, [to_email], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


def send_verification_email_sync(to_email: str, code: str, config: EmailConfig) -> None:
    """Send a verification code email synchronously. Raises on failure."""
    subject = "【问墨】邮箱验证码"
    body = (
        f"您好，\n\n"
        f"您的邮箱验证码是：{code}\n\n"
        f"该验证码 10 分钟内有效，请勿泄露给他人。\n\n"
        f"如非本人操作，请忽略本邮件。\n\n"
        f"—— 问墨"
    )
    send_email_sync(to_email, subject, body, config)
