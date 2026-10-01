"""Chat conversation history models."""

from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class ChatConversation(Base):
    """A persisted AI chat conversation owned by a user."""

    __tablename__ = "chat_conversations"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    # 空间归属（NULL=个人空间）：团队在团队空间建的会话打 tenant_id=T，
    # 两个空间互不可见；会话始终是创建者私有（user_id 条件不随空间放宽）
    tenant_id = Column(String)
    # 会话形态：'chat'=普通对话（默认）；'agent'=独立智能体模式（09-22 立项，
    # 无 RAG 自动注入、agent 自主调工具）。列表接口按 mode 过滤，两形态互不混排
    mode = Column(String, default="chat")
    title = Column(String, default="")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ChatMessage(Base):
    """A single message inside a chat conversation."""

    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("chat_conversations.id"), nullable=False, index=True)
    role = Column(String, nullable=False)  # 'user' / 'assistant'
    content = Column(Text, nullable=False)
    refs = Column(Text, nullable=True)  # 引用列表 JSON（与 /llm/chat 的 sources 事件同构）
    model = Column(String, nullable=True)  # 实际出答案的模型 id
    created_at = Column(DateTime, server_default=func.now())
