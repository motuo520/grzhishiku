"""事件触发待处理队列（agent 化五期 批④）：DB 队列，重启不丢。

监听器（event_trigger_service.register_event_trigger_listener）在剪藏提交后
只往本表塞行（rule_id × clip_id）；drain 调度聚合后删行并触发规则。
"""

from sqlalchemy import Column, DateTime, String
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentEventPending"]


class AgentEventPending(Base):
    """待触发事件行：一条剪藏命中一条规则=一行。"""

    __tablename__ = "agent_event_pending"

    id = Column(String, primary_key=True)
    rule_id = Column(String, nullable=False, index=True)
    clip_id = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
