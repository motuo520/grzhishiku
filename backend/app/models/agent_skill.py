"""智能体技能（09-22 期 3，借鉴 Hermes Skills）：DB 条目，非文件。

设计（Hermes 机制 Molore 化）：
- 技能=DB 条目（name + ≤60 字 description + body 指令正文），不进文件体系——
  Molore 是 DB 中心，技能与记忆同属 agent 私有层；
- 渐进披露：技能索引（name+desc）直接进 volatile 层（量小免一次工具调用），
  正文靠 skill_view 工具按需取（Hermes skills_list/skill_view 同构）；
- 产生：蒸馏 fork 白名单 skill_manage（create/update）——任务后沉淀可复用流程，
  主环只读（skill_view），创建权收在 fork 保质量（宁缺毋滥）；
- 治理 Curator：确定性周期任务（stale 14d→归档、归档 30d 留档永不删、
  pin 豁免、只碰 agent 创建的），LLM 评审 pass 缓行（血泪#29：判断题不赌小模型）。
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, Integer, Float
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["AgentSkill"]


class AgentSkill(Base):
    """智能体技能条目（agent 私有层，与记忆同层不进四类内容）。"""

    __tablename__ = "agent_skills"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # NULL=个人空间（与四类内容同口径）
    name = Column(String, nullable=False)  # 技能名（用户内唯一，slug 形态）
    description = Column(String, nullable=False, default="")  # ≤60 字（索引用）
    body = Column(Text, nullable=False, default="")  # 指令正文（markdown）
    created_by = Column(String, default="agent")  # agent=蒸馏 fork 沉淀 / user=用户自建
    pinned = Column(Boolean, default=False)  # pin 后 Curator 不归档
    archived = Column(Boolean, default=False)  # 归档=退役留档（永不删除）
    source_conversation_id = Column(String)  # 沉淀来源会话（溯源）
    usage_count = Column(Integer, default=0)  # skill_view 命中次数（Curator 判据）
    last_used_at = Column(Float, default=0)
    archived_at = Column(Float, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
