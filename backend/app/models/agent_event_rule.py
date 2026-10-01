"""智能体事件触发规则（agent 化五期 批④）：事件→自动跑一轮 agent 环的触发配置。

与 cron（时间触发）互补：cron 到点跑，事件规则在事件发生时跑。
v1 首发事件只有 clip_created（新剪藏入库）：
- 剪藏提交后监听器只往 agent_event_pending 塞行（不重活，见 event_trigger_service）；
- drain 调度每 30s 聚合 pending → debounce 防抖 → fire-and-forget run_headless；
- prompt 是模板，支持 {title}/{url}/{count} 占位（渲染口径见 render_prompt）。
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentEventRule"]


class AgentEventRule(Base):
    """事件触发规则：某事件发生且过防抖后，自动跑一轮 agent 环。"""

    __tablename__ = "agent_event_rules"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)  # 规则名（展示+专属会话标题）
    event_type = Column(String, nullable=False, default="clip_created")  # v1 只有 clip_created
    prompt = Column(Text, nullable=False)  # 模板，支持 {title}/{url}/{count} 占位
    enabled = Column(Boolean, default=True)
    debounce_sec = Column(Integer, nullable=False, default=300)  # 防抖：距上次触发不足则跳过
    last_fired_at = Column(DateTime)  # 最近触发时刻（空=从未触发）
    created_at = Column(DateTime, server_default=func.now())
