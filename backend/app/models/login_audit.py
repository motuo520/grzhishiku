from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["LoginAudit"]


class LoginAudit(Base):
    """登录事件审计（用户/管理后台双门户）：成功、失败（含原因）、
    refresh 重放检测、密码重置完成均落库。写入失败绝不阻断登录主流程
    （见 app/core/audit.py record_login_event）。"""

    __tablename__ = "login_audits"

    id = Column(String, primary_key=True)
    user_id = Column(String)  # 用户/管理员主键；失败时可能未知，可空
    email = Column(String, nullable=False)
    success = Column(Boolean, nullable=False)
    # wrong_password / user_not_found / token_reuse / password_reset / account_inactive
    reason = Column(String)
    ip = Column(String)
    user_agent = Column(String)
    request_id = Column(String)  # X-Request-ID 中间件挂的关联 id（core/request_id.py）
    portal = Column(String, nullable=False)  # 'user' / 'admin'
    created_at = Column(DateTime, server_default=func.now())
