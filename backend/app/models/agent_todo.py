"""智能体会话任务清单（agent 化五期 批③，Hermes TodoWrite 同款）：每会话一份草稿。

- 纯 agent 自家执行草稿，不碰用户数据——所以 todo_write 不进 WRITE_TOOLS 确认流；
- 一会话一行（conversation_id 唯一），todo_write 整体替换 items（JSON 数组）；
- 当前清单走 volatile 层注入 system prompt（todo_service.todos_context），
  空清单零噪音不注入。
"""

from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentTodo"]


class AgentTodo(Base):
    """智能体会话任务清单：todo_write 整体替换，volatile 层注入。"""

    __tablename__ = "agent_todos"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, nullable=False, unique=True, index=True)  # 一会话一份
    user_id = Column(String, nullable=False, index=True)
    # JSON 数组：[{"content": str, "status": "pending"|"in_progress"|"done"}]
    items = Column(Text, nullable=False, default="[]")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
