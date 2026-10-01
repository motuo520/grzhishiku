"""智能体记忆（09-22 期 2 记忆蒸馏）：agent 面向的持久记忆存储。

设计（借鉴 Hermes Agent 记忆层，Molore 化）：
- fact=蒸馏出的用户事实/偏好（可检索、可 pin）；profile_user/profile_agent=
  系统提示 volatile 层的双文档（用户画像/智能体笔记，字符预算硬顶，
  借鉴 Hermes USER.md/MEMORY.md 预算 1375/2200）；
- 记忆是 agent 的私有层，不进四类内容体系（笔记/剪藏/KU/文档）——
  用户想把记忆沉淀为知识走「存为笔记」，两层不混。
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, Integer, Float
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentMemory"]


class AgentMemory(Base):
    """智能体记忆条目：fact（可检索事实）或 profile（volatile 层双文档）。"""

    __tablename__ = "agent_memories"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # NULL=个人空间（与四类内容同口径）
    # fact=用户事实/偏好；profile_user=用户画像；profile_agent=智能体笔记；
    # preference=用户偏好（常驻注入）；task=目标/待办（按 query 召回）；
    # interest=兴趣线索（只条件化检索，不主动注入）——09-29 WeKnora 借鉴④五类分驻
    kind = Column(String, nullable=False, default="fact")
    content = Column(Text, nullable=False, default="")
    # 数据层状态（09-29 WeKnora 借鉴④）：active=生效；pending=蒸馏产物待用户确认
    # （确认前不注入不检索）；superseded=被同 normalized_key 新条目取代（只留痕不进面）
    status = Column(String, nullable=False, default="active", server_default="active")
    # 归一化键：同键新条目=矛盾更新，旧条目转 superseded（WeKnora NormalizedKey 口径）
    normalized_key = Column(String(128), index=True)
    expires_at = Column(Float)  # unix 秒；NULL=不过期；过期不注入不检索
    superseded_by = Column(String)  # 取代者条目 id（审计溯源）
    pinned = Column(Boolean, default=False)  # pin 后蒸馏 fork 不得改写/清理
    source_conversation_id = Column(String)  # 蒸馏来源会话（溯源）
    usage_count = Column(Integer, default=0)  # memory_search 命中次数（Curator 期用）
    last_used_at = Column(Float, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
