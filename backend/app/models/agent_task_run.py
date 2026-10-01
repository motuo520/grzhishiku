"""子任务派发记录（agent 化五期 批③）：dispatch_task 后台任务的状态账本。

- dispatch_task 工具建行（status=running）后 fire-and-forget 跑 run_headless
  （headless_agent.fire_task_run，660s 看门狗），完成回写 status/answer_preview；
- 每个子任务一个专属 agent 会话（title=任务名，历史页可见）；
- task_status 工具按 user_id 归属校验后读状态。
"""

from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentTaskRun"]


class AgentTaskRun(Base):
    """子任务派发记录：主智能体 dispatch_task 派出的后台独立任务。"""

    __tablename__ = "agent_task_runs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)  # 任务名（展示+专属会话标题）
    prompt = Column(Text, nullable=False)  # 交给子智能体的任务指令
    status = Column(String, nullable=False, default="running")  # running / done / error
    answer_preview = Column(Text, default="")  # 结果前 500 字（错误时为错误摘要）
    conversation_id = Column(String)  # 子任务专属会话
    created_at = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime)
