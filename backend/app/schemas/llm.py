"""Pydantic schemas for LLM endpoints"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict
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
    conversation_id: Optional[str] = Field(None, description="会话 ID（传入则本轮问答落库到该会话）")


class SummarizeRequest(BaseModel):
    text: str = Field(..., min_length=10, max_length=50000, description="Text to summarize")
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
    text: str = Field(..., min_length=5, max_length=50000, description="Text to extract tags from")
    max_tags: int = Field(10, ge=3, le=20, description="Maximum number of tags")
    suggest_categories: bool = Field(False, description="Also suggest categories")
    model: Optional[str] = Field(None, description="Override model for tag extraction")


class ExtractTagsResponse(BaseModel):
    tags: List[str]
    categories: Optional[List[str]] = None
    model_used: str


class CompleteRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=50000, description="Prompt text")
    system_prompt: Optional[str] = Field(None, max_length=50000, description="System prompt")
    model: Optional[str] = Field(None, description="Override model")
    task_type: str = Field("chat", max_length=50, description="Task type")


class CompleteResponse(BaseModel):
    text: str
    model_used: str


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000, description="Text to embed")
    store: bool = Field(False, description="Whether to store in database")
    content_type: str = Field("query", description="Content type for storage")
    content_id: Optional[str] = Field(None, description="Associated content ID")
    model: Optional[str] = Field(None, description="Embedding model label override (defaults to configured Ollama embed model)")


class EmbedBatchRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=50, description="List of texts to embed")
    model: Optional[str] = Field(None, description="Embedding model label override (defaults to configured Ollama embed model)")


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
