"""用户外部 MCP server 配置（agent 化五期 批⑤）：让 agent 调用外部 MCP server 的工具。

- 每条配置是一个外部 MCP server 连接（url + transport + 可选 Bearer token）；
- token_enc 一律 encrypt_secret 加密落库（enc:v1: 前缀，与平台厂商 key 同口径），
  永不明文落库、永不在 API 响应里回显；
- 个人级配置（user_id 归属，不区分租户，与 skills/event_rules 端点同口径）。
"""

from sqlalchemy import Boolean, Column, DateTime, String, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["UserMcpServer"]


class UserMcpServer(Base):
    """外部 MCP server 连接配置：agent 的 mcp_tools/mcp_call 工具按此连外部服务。"""

    __tablename__ = "user_mcp_servers"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)  # 展示名 + agent 工具按名寻址
    url = Column(String, nullable=False)  # http/https 端点
    transport = Column(String, nullable=False, default="streamable_http")  # streamable_http | sse
    token_enc = Column(Text)  # Bearer token，encrypt_secret 加密（enc:v1: 前缀），可空
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
