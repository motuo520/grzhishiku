"""审计落库共用助手。

- audit_request_meta：AdminAuditLog / LoginAudit 统一取 IP / UA / request_id。
  IP 与全站限流同口径（security_middleware._get_client_ip：仅在可信代理时取
  XFF 末段），不用裸 request.client.host；UA 截断 256 字符防巨串。
  request_id：由 RequestIdMiddleware（core/request_id.py）挂 request.state，
  中间件顺序异常缺位时留 None 不硬造。
- record_login_event：登录事件落 login_audits。任何异常只 warning 留痕，
  绝不阻断登录主流程。
"""
import logging
import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

UA_MAX_LEN = 256


def audit_request_meta(request: Optional[Request]) -> dict:
    """取审计元数据 dict，键与 AdminAuditLog 列同名：ip_address/user_agent/request_id。"""
    meta = {"ip_address": None, "user_agent": None, "request_id": None}
    if request is None:
        return meta
    try:
        from app.core.security_middleware import _get_client_ip
        meta["ip_address"] = _get_client_ip(request)
    except Exception:
        # 口径解析自身故障时退化为直连 IP，不因此丢审计行
        meta["ip_address"] = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    if ua:
        meta["user_agent"] = ua[:UA_MAX_LEN]
    meta["request_id"] = getattr(request.state, "request_id", None)
    return meta


def record_login_event(
    db: Session,
    request: Optional[Request],
    *,
    email: str,
    success: bool,
    portal: str,
    user_id: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """登录事件落库；写入失败绝不阻断登录主流程，只 warning 留痕。"""
    try:
        from app.models.login_audit import LoginAudit

        meta = audit_request_meta(request)
        db.add(LoginAudit(
            id=str(uuid.uuid4()),
            user_id=user_id,
            email=email,
            success=success,
            reason=reason,
            ip=meta["ip_address"],
            user_agent=meta["user_agent"],
            request_id=meta["request_id"],
            portal=portal,
        ))
        db.commit()
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning(
            "login_audit 写入失败（不影响登录主流程） email=%s portal=%s: %s",
            email, portal, e,
        )
