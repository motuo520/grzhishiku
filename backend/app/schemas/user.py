from pydantic import BaseModel, Field, EmailStr
from app.schemas.base import BaseModel  # BUG-A01：统一 naive datetime 按 UTC 序列化
from typing import Optional, List, Dict, Any

# Username/display name regex: letters, digits, underscore, Chinese characters
USERNAME_PATTERN = r'^[a-zA-Z0-9_\u4e00-\u9fff]+$'

class UserBase(BaseModel):
    email: EmailStr = Field(..., description="User email address (unique)")
    name: Optional[str] = Field(None, max_length=200, description="Display name")

class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200, pattern=USERNAME_PATTERN, description="New display name")
    avatar: Optional[str] = Field(None, max_length=2048, description="Avatar URL or base64")
    display_name: Optional[str] = Field(None, max_length=200, pattern=USERNAME_PATTERN, description="Display name")
    username: Optional[str] = Field(None, max_length=200, pattern=USERNAME_PATTERN, description="Username")

class TokenResponse(BaseModel):
    access_token: str = Field(..., description="JWT access token")
    token_type: str = Field("bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiry in seconds")

class UserLogin(BaseModel):
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=1, max_length=128, description="User password")


class AISettings(BaseModel):
    active_provider: Optional[str] = Field(None, description="Active LLM provider slug")
    active_model: Optional[str] = Field(None, description="Active LLM model identifier")
    model: Optional[str] = Field(None, description="Legacy selected model id, e.g. ollama, gpt-4")
    temperature: Optional[float] = Field(None, description="Sampling temperature (0.0 - 1.0)")
    max_tokens: Optional[int] = Field(None, description="Maximum tokens per generation")
    local_enabled: Optional[bool] = Field(None, description="Whether local/Ollama models are enabled")
    model_routing_enabled: Optional[bool] = Field(None, description="Whether intelligent model routing is enabled")
    byok_enabled: Optional[bool] = Field(None, description="BYOK 总开关：关闭后外部模型在控制台/各选择器隐藏")
    disabled_models: Optional[List[str]] = Field(None, description="用户级单模型开关：被关闭（隐藏）的 BYOK 模型 catalog id 列表")
    ollama_url: Optional[str] = Field(None, description="User-level Ollama base URL")
    ollama_model: Optional[str] = Field(None, description="User-level selected Ollama model name")
    auto_tag: Optional[bool] = Field(None, description="入库自动打标签开关，默认开")
    auto_tag_model: Optional[str] = Field(None, max_length=100, description="自动打标模型（ollama 原始模型名，本机已安装的本地型号；空/缺省=默认 qwen3.5:0.8b）")
    kimi_api_key: Optional[str] = Field(None, description="User-level Kimi API key")
    deepseek_api_key: Optional[str] = Field(None, description="User-level DeepSeek API key")
    opencode_api_key: Optional[str] = Field(None, description="User-level OpenCode API key")
    glm_api_key: Optional[str] = Field(None, description="User-level GLM (智谱) API key")
    dashscope_api_key: Optional[str] = Field(None, description="User-level DashScope (阿里) API key")
    openai_api_key: Optional[str] = Field(None, description="User-level OpenAI API key")
    anthropic_api_key: Optional[str] = Field(None, description="User-level Anthropic API key")
    google_api_key: Optional[str] = Field(None, description="User-level Google (Gemini) API key")
    byok_keys: Optional[Dict[str, str]] = Field(None, description="BYOK 预设目录新供应商的用户级 key（slug → key；老 8 家走各自 legacy 字段）")
    byok_models: Optional[Dict[str, List[str]]] = Field(None, description="BYOK 用户已选模型清单（slug → 目录行 id 列表；选择器/控制台只显示清单内的行）")
    byok_custom_url: Optional[str] = Field(None, description="自定义中转站厂商的 base_url（slug=custom 专用）")
    api_key: Optional[str] = Field(None, description="Legacy fallback API key")


class SettingsUpdate(BaseModel):
    ai: Optional[AISettings] = None
    privacy: Optional[Dict[str, Any]] = None
    sync: Optional[Dict[str, Any]] = None
    appearance: Optional[Dict[str, Any]] = None
    plugins: Optional[Dict[str, Any]] = None
    # 来源追溯页：用户手动信誉档覆盖 {域名: 'trusted'|'normal'|'review'}（血泪 #24：加设置项必须同步本 schema）
    source_tiers: Optional[Dict[str, str]] = None
    # 百科页「不看重」标记 {topics: ['tag:{id}'...], entries: ['{entry_id}'...]}；
    # dict 浅合并口径下前端每次发某个子键的全量列表（非增量）
    wiki_dismissed: Optional[Dict[str, List[str]]] = None
