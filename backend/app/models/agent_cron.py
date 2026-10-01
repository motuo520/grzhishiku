"""智能体定时任务（09-23 期 4 通用 cron，借鉴 Hermes cron）：用户级持久任务表。

设计（Hermes cron/jobs.py + scheduler.py 的 Molore 化）：
- 任务存 DB（user_cron_jobs），不存 jobs.json——Molore 是 DB 中心；
- at-most-once：dispatch 前先推进 next_run_at 落库（进程崩了不重复跑）；
- 触发=到期任务在后台线程跑一轮 agent 环（独立会话按任务归档，600s 时长墙），
  结果落任务会话（历史页可见），状态记 last_status/last_error；
- 错过补跑：停机期间的到期任务，启动后首个 tick 补跑一次再推进（不连放）。
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, Float
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentCronJob"]


class AgentCronJob(Base):
    """智能体定时任务：到期自动跑一轮 agent 环。"""

    __tablename__ = "user_cron_jobs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # NULL=个人空间
    name = Column(String, nullable=False)  # 任务名（展示+会话标题）
    prompt = Column(Text, nullable=False)  # 每轮交给智能体的任务指令
    # interval=间隔分钟（schedule_value 存分钟数）/ cron=5 字段表达式 / once=ISO 一次性
    schedule_type = Column(String, nullable=False, default="interval")
    schedule_value = Column(String, nullable=False, default="60")
    model_id = Column(String)  # 空=平台默认（channel_policy 默认平台模型）
    enabled = Column(Boolean, default=True)
    next_run_at = Column(Float, default=0)  # epoch 秒；0=未排期
    last_run_at = Column(Float, default=0)
    last_status = Column(String, default="")  # ok / error
    last_error = Column(Text, default="")
    last_answer_preview = Column(Text, default="")  # 最近一轮回答前 200 字
    conversation_id = Column(String)  # 任务专属会话（每轮追加，历史页可见）
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
