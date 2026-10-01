"""Pydantic schemas for LLM endpoints"""

from pydantic import BaseModel, Field
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from typing import Any, Optional, List, Dict
from enum import Enum


class SummarizeLength(str, Enum):
    SHORT = "short"
    MEDIUM = "medium"
    LONG = "long"


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=100000, description="User message")
    history: Optional[List[Dict[str, str]]] = Field(None, description="Conversation history")
    brain_side: str = Field("both", description="Brain side context")
    sensitivity: str = Field("low", description="Content sensitivity level")
    task_type: str = Field("chat", description="Task type")
    preferred_model: Optional[str] = Field(None, description="Override routing model")
    system_prompt: Optional[str] = Field(None, description="System prompt override")
    attachments: Optional[List[str]] = Field(None, description="附件列表：本地文件路径（仅桌面端，图片走 OCR）/ url: 链接抓取 / note: 笔记引用，三种形态可混用，合计不超过 5 个")
    conversation_id: Optional[str] = Field(None, description="会话 ID（传入则本轮问答落库到该会话）")
    agent: bool = Field(False, description="深度研究 agent 环（仅 BYOK/平台强模型；本地 lite 档静默走单轮）")
    agent_mode: bool = Field(False, description="独立智能体模式（仅 BYOK/平台强模型；无 RAG 自动注入，agent 自主调工具；本地 lite 档 400）")
    web_access: bool = Field(False, description="站外开关（仅 agent_mode）：工具集加 web_fetch，可抓公开网页对照站内内容")
    # raw 纯模型执行形态：桌面 platform: 通道的 agent 环逐轮转发用——不检索/不落库/不拼 RAG
    # prompt，仅限 is_system 平台行（端点内强校验）。messages 含 tool 角色回填。
    raw: bool = Field(False, description="纯模型执行形态（agent 环内部转发，勿手动用）")
    messages: Optional[List[Dict[str, Any]]] = Field(None, description="raw 形态的完整消息数组")
    tools: Optional[List[Dict[str, Any]]] = Field(None, description="raw/agent 形态的 OpenAI tools schema")
    disable_thinking: bool = Field(False, description="agent 环关思考（raw 形态透传，落 GLM payload thinking.disabled）")


class SummarizeRequest(BaseModel):
    # 09-11 拆 5 万字墙：长文档总结/抽标签/补全不再被 schema 上限挡在 422 外
    text: str = Field(..., min_length=10, description="Text to summarize")
    length: SummarizeLength = Field(SummarizeLength.MEDIUM, description="Summary length: short/medium/long")
    model: Optional[str] = Field(None, description="Override model for summarization")


class SummarizeResponse(BaseModel):
    summary: str
    original_length: int
    summary_length: int
    compression_ratio: float
    model_used: str
    cached: bool = False


class ExtractTagsRequest(BaseModel):
    text: str = Field(..., min_length=5, description="Text to extract tags from")
    max_tags: int = Field(10, ge=3, le=20, description="Maximum number of tags")
    suggest_categories: bool = Field(False, description="Also suggest categories")
    model: Optional[str] = Field(None, description="Override model for tag extraction")


class ExtractTagsResponse(BaseModel):
    tags: List[str]
    categories: Optional[List[str]] = None
    model_used: str


class CompleteRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="Prompt text")
    system_prompt: Optional[str] = Field(None, description="System prompt")
    model: Optional[str] = Field(None, description="Override model")
    task_type: str = Field("chat", max_length=50, description="Task type for billing")


class CompleteResponse(BaseModel):
    text: str
    model_used: str


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000, description="Text to embed")
    store: bool = Field(False, description="Whether to store in database")
    content_type: str = Field("query", description="Content type for storage")
    content_id: Optional[str] = Field(None, description="Associated content ID")
    model: Optional[str] = Field("ollama-qwen3.5-0.8b", description="Embedding model id to bill against")


class EmbedBatchRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=50, description="List of texts to embed")
    model: Optional[str] = Field("ollama-qwen3.5-0.8b", description="Embedding model id to bill against")


class EmbedResponse(BaseModel):
    embedding: List[float]
    dimensions: int
    model_used: str


class EmbedBatchResponse(BaseModel):
    embeddings: List[List[float]]
    dimensions: int
    model_used: str
    count: int


class RouteTestRequest(BaseModel):
    message: str = Field(..., min_length=1, description="Message to test routing")
    brain_side: str = "both"
    sensitivity: str = "low"
    task_type: str = "chat"


class RouteTestResponse(BaseModel):
    provider: str
    model: str
    reasoning: str
    features_detected: List[str]
    is_sensitive: bool = False


class ModelInfoResponse(BaseModel):
    name: str
    provider: str
    description: str
    available: bool
    features: List[str]
    context_window: int
    latency_hint: str
    icon_color: str


class OllamaModelsResponse(BaseModel):
    models: List[str]
