import httpx
import json
import re
import hashlib
import time
from typing import AsyncGenerator, Dict, Any, Optional, List
from enum import Enum
from datetime import datetime

from sqlalchemy import func

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.base import Embedding
from app.services.llm_provider_router import LLMProviderRouter


class ModelProvider(str, Enum):
    OLLAMA = "ollama"
    DEEPSEEK = "deepseek"
    KIMI = "kimi"
    OPENCODE = "opencode"


class SENSITIVE_PATTERNS:
    """Regex patterns for sensitive content detection."""
    PASSWORD = re.compile(r"password[:\s=]+\S+|密码[:\s=]+\S+|passwd[:\s=]+\S+|pwd[:\s=]+\S+", re.I)
    API_KEY = re.compile(r"sk-[a-zA-Z0-9]{48}|sk-[a-zA-Z0-9]{32}|api[_-]?key[:\s=]+\S+|apikey[:\s=]+\S+", re.I)
    ID_CARD = re.compile(r"\d{17}[\dXx]|\d{15}")
    PHONE = re.compile(r"1[3-9]\d{9}")
    BANK_CARD = re.compile(r"\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}")
    PRIVATE_KEY = re.compile(r"-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----")
    SECRET_TOKEN = re.compile(r"token[:\s=]+\S+|bearer[\s:]+\S+|secret[:\s=]+\S+", re.I)

    @classmethod
    def detect(cls, text: str) -> Dict[str, Any]:
        """Detect sensitive content in text. Returns findings and severity."""
        findings = []
        severity = "low"
        if cls.PASSWORD.search(text):
            findings.append("password")
            severity = "high"
        if cls.API_KEY.search(text):
            findings.append("api_key")
            severity = "high"
        if cls.ID_CARD.search(text):
            findings.append("id_card")
            severity = "high"
        if cls.PHONE.search(text):
            findings.append("phone")
            severity = "medium"
        if cls.BANK_CARD.search(text):
            findings.append("bank_card")
            severity = "high"
        if cls.PRIVATE_KEY.search(text):
            findings.append("private_key")
            severity = "high"
        if cls.SECRET_TOKEN.search(text):
            findings.append("secret_token")
            severity = "medium"
        return {"findings": findings, "severity": severity, "has_sensitive": len(findings) > 0}


class ModelConfig:
    """Configuration for each LLM model."""

    MODELS = {
        # ─── Local / Ollama ───
        "ollama-qwen2.5-0.5b": {
            "provider": ModelProvider.OLLAMA,
            "name": "Ollama / Qwen 2.5 0.5B",
            "description": "本地轻量小模型，约 400MB",
            "capabilities": ["privacy", "chinese", "fast", "offline"],
            "context_length": 32000,
            "temperature": 0.7,
            "endpoint": settings.OLLAMA_BASE_URL,
            "model_id": "qwen2.5:0.5b",
            "available": True,
        },
        "ollama-smollm2": {
            "provider": ModelProvider.OLLAMA,
            "name": "Ollama / SmolLM2 135M",
            "description": "本地玩具级模型，英文为主",
            "capabilities": ["privacy", "fast", "offline"],
            "context_length": 8192,
            "temperature": 0.7,
            "endpoint": settings.OLLAMA_BASE_URL,
            "model_id": "smollm2:135m",
            "available": True,
        },

        # ─── Supplier models (auto-generated from 模型接口和价格供应商.md) ───
        "opencode-gpt-5-6-sol": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.6 Sol",
            "description": "GPT 5.6 Sol via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.6-sol",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-6-terra": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.6 Terra",
            "description": "GPT 5.6 Terra via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.6-terra",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-6-luna": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.6 Luna",
            "description": "GPT 5.6 Luna via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.6-luna",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.5",
            "description": "GPT 5.5 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-5-pro": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.5 Pro",
            "description": "GPT 5.5 Pro via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.5-pro",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-4": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.4",
            "description": "GPT 5.4 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.4",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-4-pro": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.4 Pro",
            "description": "GPT 5.4 Pro via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.4-pro",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-4-mini": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.4 Mini",
            "description": "GPT 5.4 Mini via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.4-mini",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-4-nano": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.4 Nano",
            "description": "GPT 5.4 Nano via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.4-nano",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-3-codex": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.3 Codex",
            "description": "GPT 5.3 Codex via opencode",
            "capabilities": ['cloud', 'coding'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.3-codex",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-3-codex-spark": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.3 Codex Spark",
            "description": "GPT 5.3 Codex Spark via opencode",
            "capabilities": ['cloud', 'coding'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.3-codex-spark",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-2": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.2",
            "description": "GPT 5.2 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.2",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-2-codex": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.2 Codex",
            "description": "GPT 5.2 Codex via opencode",
            "capabilities": ['cloud', 'coding'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.2-codex",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-1": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.1",
            "description": "GPT 5.1 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.1",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-1-codex": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.1 Codex",
            "description": "GPT 5.1 Codex via opencode",
            "capabilities": ['cloud', 'coding'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.1-codex",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-1-codex-max": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.1 Codex Max",
            "description": "GPT 5.1 Codex Max via opencode",
            "capabilities": ['cloud', 'coding', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.1-codex-max",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-1-codex-mini": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5.1 Codex Mini",
            "description": "GPT 5.1 Codex Mini via opencode",
            "capabilities": ['cloud', 'coding', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5.1-codex-mini",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5",
            "description": "GPT 5 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-codex": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5 Codex",
            "description": "GPT 5 Codex via opencode",
            "capabilities": ['cloud', 'coding'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5-codex",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gpt-5-nano": {
            "provider": ModelProvider.OPENCODE,
            "name": "GPT 5 Nano",
            "description": "GPT 5 Nano via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gpt-5-nano",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-fable-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Fable 5",
            "description": "Claude Fable 5 via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-fable-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-opus-4-8": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Opus 4.8",
            "description": "Claude Opus 4.8 via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-opus-4-8",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-opus-4-7": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Opus 4.7",
            "description": "Claude Opus 4.7 via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-opus-4-7",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-opus-4-6": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Opus 4.6",
            "description": "Claude Opus 4.6 via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-opus-4-6",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-opus-4-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Opus 4.5",
            "description": "Claude Opus 4.5 via opencode",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-opus-4-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-sonnet-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Sonnet 5",
            "description": "Claude Sonnet 5 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-sonnet-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-sonnet-4-6": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Sonnet 4.6",
            "description": "Claude Sonnet 4.6 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-sonnet-4-6",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-sonnet-4-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Sonnet 4.5",
            "description": "Claude Sonnet 4.5 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-sonnet-4-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-claude-haiku-4-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "Claude Haiku 4.5",
            "description": "Claude Haiku 4.5 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/claude-haiku-4-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gemini-3-5-flash": {
            "provider": ModelProvider.OPENCODE,
            "name": "Gemini 3.5 Flash",
            "description": "Gemini 3.5 Flash via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gemini-3.5-flash",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gemini-3-1-pro": {
            "provider": ModelProvider.OPENCODE,
            "name": "Gemini 3.1 Pro",
            "description": "Gemini 3.1 Pro via opencode",
            "capabilities": ['cloud', 'fast', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gemini-3.1-pro",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-gemini-3-flash": {
            "provider": ModelProvider.OPENCODE,
            "name": "Gemini 3 Flash",
            "description": "Gemini 3 Flash via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/gemini-3-flash",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-qwen3-7-max": {
            "provider": ModelProvider.OPENCODE,
            "name": "Qwen3.7 Max",
            "description": "Qwen3.7 Max via opencode",
            "capabilities": ['cloud', 'chinese', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/qwen3.7-max",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-qwen3-7-plus": {
            "provider": ModelProvider.OPENCODE,
            "name": "Qwen3.7 Plus",
            "description": "Qwen3.7 Plus via opencode",
            "capabilities": ['cloud', 'chinese'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/qwen3.7-plus",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-qwen3-6-plus": {
            "provider": ModelProvider.OPENCODE,
            "name": "Qwen3.6 Plus",
            "description": "Qwen3.6 Plus via opencode",
            "capabilities": ['cloud', 'chinese'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/qwen3.6-plus",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-qwen3-5-plus": {
            "provider": ModelProvider.OPENCODE,
            "name": "Qwen3.5 Plus",
            "description": "Qwen3.5 Plus via opencode",
            "capabilities": ['cloud', 'chinese'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/qwen3.5-plus",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-minimax-m3": {
            "provider": ModelProvider.OPENCODE,
            "name": "MiniMax M3",
            "description": "MiniMax M3 via opencode",
            "capabilities": ['cloud', 'fast', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/minimax-m3",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-minimax-m2-7": {
            "provider": ModelProvider.OPENCODE,
            "name": "MiniMax M2.7",
            "description": "MiniMax M2.7 via opencode",
            "capabilities": ['cloud', 'fast', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/minimax-m2.7",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-minimax-m2-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "MiniMax M2.5",
            "description": "MiniMax M2.5 via opencode",
            "capabilities": ['cloud', 'fast', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/minimax-m2.5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-glm-5-2": {
            "provider": ModelProvider.OPENCODE,
            "name": "GLM 5.2",
            "description": "GLM 5.2 via opencode",
            "capabilities": ['cloud', 'chinese'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/glm-5.2",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-glm-5-1": {
            "provider": ModelProvider.OPENCODE,
            "name": "GLM 5.1",
            "description": "GLM 5.1 via opencode",
            "capabilities": ['cloud', 'chinese'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/glm-5.1",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-glm-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "GLM 5",
            "description": "GLM 5 via opencode",
            "capabilities": ['cloud', 'chinese'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/glm-5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-grok-4-5": {
            "provider": ModelProvider.OPENCODE,
            "name": "Grok 4.5",
            "description": "Grok 4.5 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/grok-4.5",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-grok-build-0-1": {
            "provider": ModelProvider.OPENCODE,
            "name": "Grok Build 0.1",
            "description": "Grok Build 0.1 via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/grok-build-0.1",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-big-pickle": {
            "provider": ModelProvider.OPENCODE,
            "name": "Big Pickle",
            "description": "Big Pickle via opencode",
            "capabilities": ['cloud'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/big-pickle",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-mimo-v2-5-free": {
            "provider": ModelProvider.OPENCODE,
            "name": "MiMo-V2.5 Free",
            "description": "MiMo-V2.5 Free via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/mimo-v2.5-free",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-north-mini-code-free": {
            "provider": ModelProvider.OPENCODE,
            "name": "North Mini Code Free",
            "description": "North Mini Code Free via opencode",
            "capabilities": ['cloud', 'coding', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/north-mini-code-free",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "opencode-nemotron-3-ultra-free": {
            "provider": ModelProvider.OPENCODE,
            "name": "Nemotron 3 Ultra Free",
            "description": "Nemotron 3 Ultra Free via opencode",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.OPENCODE_BASE_URL,
            "model_id": "opencode/nemotron-3-ultra-free",
            "available": bool(settings.OPENCODE_API_KEY),
        },
        "kimi-k2-7-code": {
            "provider": ModelProvider.KIMI,
            "name": "Kimi K2.7 Code",
            "description": "Kimi K2.7 Code via kimi",
            "capabilities": ['cloud', 'coding', 'chinese', 'long_context'],
            "context_length": 256000,
            "temperature": 0.7,
            "endpoint": settings.KIMI_BASE_URL,
            "model_id": "kimi-k2-7-code",
            "available": bool(settings.KIMI_API_KEY),
        },
        "kimi-k2-6": {
            "provider": ModelProvider.KIMI,
            "name": "Kimi K2.6",
            "description": "Kimi K2.6 via kimi",
            "capabilities": ['cloud', 'chinese', 'long_context'],
            "context_length": 256000,
            "temperature": 0.7,
            "endpoint": settings.KIMI_BASE_URL,
            "model_id": "kimi-k2-6",
            "available": bool(settings.KIMI_API_KEY),
        },
        "kimi-k2-5": {
            "provider": ModelProvider.KIMI,
            "name": "Kimi K2.5",
            "description": "Kimi K2.5 via kimi",
            "capabilities": ['cloud', 'chinese', 'long_context'],
            "context_length": 256000,
            "temperature": 0.7,
            "endpoint": settings.KIMI_BASE_URL,
            "model_id": "kimi-k2-5",
            "available": bool(settings.KIMI_API_KEY),
        },
        "deepseek-v4-pro": {
            "provider": ModelProvider.DEEPSEEK,
            "name": "DeepSeek V4 Pro",
            "description": "DeepSeek V4 Pro via deepseek",
            "capabilities": ['cloud', 'reasoning'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.DEEPSEEK_BASE_URL,
            "model_id": "deepseek-v4-pro",
            "available": bool(settings.DEEPSEEK_API_KEY),
        },
        "deepseek-v4-flash": {
            "provider": ModelProvider.DEEPSEEK,
            "name": "DeepSeek V4 Flash",
            "description": "DeepSeek V4 Flash via deepseek",
            "capabilities": ['cloud', 'fast'],
            "context_length": 128000,
            "temperature": 0.7,
            "endpoint": settings.DEEPSEEK_BASE_URL,
            "model_id": "deepseek-v4-flash",
            "available": bool(settings.DEEPSEEK_API_KEY),
        },
    }

    @classmethod
    def get(cls, model_name: str) -> Optional[Dict[str, Any]]:
        return cls.MODELS.get(model_name)

    @classmethod
    def get_all(cls) -> List[Dict[str, Any]]:
        return [
            {**cfg, "model_name": name}
            for name, cfg in cls.MODELS.items()
        ]

    @classmethod
    def get_by_provider(cls, provider: ModelProvider) -> List[Dict[str, Any]]:
        return [
            {**cfg, "model_name": name}
            for name, cfg in cls.MODELS.items()
            if cfg["provider"] == provider
        ]


class ProviderStatus:
    """Health status for each LLM provider"""

    PROVIDER_CONFIG = {
        ModelProvider.OLLAMA: {
            "name": "Ollama",
            "base_url": settings.OLLAMA_BASE_URL,
            "health_endpoint": "/api/tags",
            "default_model": "qwen2.5:0.5b",
            "icon_color": "from-emerald-400 to-teal-500",
        },
        ModelProvider.DEEPSEEK: {
            "name": "DeepSeek",
            "base_url": settings.DEEPSEEK_BASE_URL,
            "health_endpoint": "/models",
            "default_model": "deepseek-v4-pro",
            "icon_color": "from-rose-400 to-pink-500",
        },
        ModelProvider.KIMI: {
            "name": "Kimi",
            "base_url": settings.KIMI_BASE_URL,
            "health_endpoint": "/v1/models",
            "default_model": "kimi-k2-7-code",
            "icon_color": "from-violet-400 to-purple-500",
        },
        ModelProvider.OPENCODE: {
            "name": "OpenCode",
            "base_url": settings.OPENCODE_BASE_URL,
            "health_endpoint": "/v1/models",
            "default_model": "glm-5",
            "icon_color": "from-cyan-400 to-blue-500",
        },
    }

    @staticmethod
    def get_status(provider: ModelProvider, available: bool = False) -> Dict[str, Any]:
        config = ProviderStatus.PROVIDER_CONFIG.get(provider, {})
        return {
            "provider": config.get("name", provider.value),
            "model": config.get("default_model", "unknown"),
            "connected": False,
            "latency": -1,
            "icon_color": config.get("icon_color", "from-gray-400 to-gray-500"),
            "available": available,
        }


class LLMRouterService:
    """Routes LLM requests to the most appropriate model based on content features."""

    # Token estimation: ~1.5 chars per token for Chinese, ~4 for English
    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Rough token estimation."""
        chinese_chars = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
        other_chars = len(text) - chinese_chars
        return int(chinese_chars * 1.5 + other_chars / 4)

    @staticmethod
    def route(
        content: str,
        context: Optional[Dict[str, Any]] = None,
        preferred_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Route content to the best LLM model.

        Rules (priority order):
        1. User override -> preferred_model
        2. Sensitive content -> local Ollama (privacy)
        3. Code/technical -> Kimi K2.7 Code
        4. Chinese content -> available cloud Chinese-capable provider
        5. Long text (>4000 tokens) -> Kimi K2.6
        6. Short query (<100 tokens) -> local Ollama (speed)
        7. Complex reasoning -> DeepSeek V4 Pro
        8. Default -> local Ollama
        """
        context = context or {}

        # 1. User override
        if preferred_model and preferred_model in ModelConfig.MODELS:
            cfg = ModelConfig.get(preferred_model)
            return {
                "model_name": preferred_model,
                "provider": cfg["provider"],
                "model_id": cfg["model_id"],
                "reason": "user_override",
            }

        # 2. Sensitive content detection -> local Ollama (offline)
        sensitive = SENSITIVE_PATTERNS.detect(content)
        if sensitive["has_sensitive"] and sensitive["severity"] == "high":
            return {
                "model_name": "ollama-qwen2.5-0.5b",
                "provider": ModelProvider.OLLAMA,
                "model_id": "qwen2.5:0.5b",
                "reason": "sensitive_content_detected",
                "findings": sensitive["findings"],
            }

        # 3. Code/technical content -> Kimi K2.7 Code
        code_keywords = [
            "code", "programming", "debug", "function", "class", "api", "error",
            "bug", "编译", "代码", "函数", "调试", "class", "def ", "import ",
            "javascript", "python", "typescript", "rust", "go", "java", "c++",
            "react", "vue", "angular", "sql", "database", "算法", "leetcode",
        ]
        lower = content.lower()
        if any(kw in lower for kw in code_keywords):
            if ModelConfig.get("kimi-k2-7-code")["available"]:
                return {
                    "model_name": "kimi-k2-7-code",
                    "provider": ModelProvider.KIMI,
                    "model_id": "kimi-k2-7-code",
                    "reason": "coding_task",
                }

        # 4. Chinese content -> prefer available cloud Chinese-capable providers,
        #    fallback to local Ollama only when no cloud key is configured.
        is_chinese = any("\u4e00" <= c <= "\u9fff" for c in content)
        if is_chinese:
            chinese_cloud_candidates = [
                "kimi-k2-6",
                "kimi-k2-7-code",
                "deepseek-v4-pro",
                "opencode-qwen-3-7-max",
                "opencode-qwen-3-7-plus-256k",
                "opencode-qwen-3-6-plus-256k",
                "opencode-glm-5",
                "opencode-glm-5-1",
            ]
            for model_name in chinese_cloud_candidates:
                cfg = ModelConfig.get(model_name)
                if cfg and cfg["available"]:
                    return {
                        "model_name": model_name,
                        "provider": cfg["provider"],
                        "model_id": cfg["model_id"],
                        "reason": "chinese_content_cloud",
                    }
            return {
                "model_name": "ollama-qwen2.5-0.5b",
                "provider": ModelProvider.OLLAMA,
                "model_id": "qwen2.5:0.5b",
                "reason": "chinese_content_local_fallback",
            }

        # 5. Long text (>4000 tokens) -> Kimi K2.6
        token_count = LLMRouterService.estimate_tokens(content)
        if token_count > 4000:
            if ModelConfig.get("kimi-k2-6")["available"]:
                return {
                    "model_name": "kimi-k2-6",
                    "provider": ModelProvider.KIMI,
                    "model_id": "kimi-k2-6",
                    "reason": "long_context",
                    "token_count": token_count,
                }
            elif ModelConfig.get("deepseek-v4-pro")["available"]:
                return {
                    "model_name": "deepseek-v4-pro",
                    "provider": ModelProvider.DEEPSEEK,
                    "model_id": "deepseek-v4-pro",
                    "reason": "long_context_fallback",
                    "token_count": token_count,
                }

        # 6. Short query (<100 tokens) -> local Ollama (speed)
        if token_count < 100:
            return {
                "model_name": "ollama-qwen2.5-0.5b",
                "provider": ModelProvider.OLLAMA,
                "model_id": "qwen2.5:0.5b",
                "reason": "fast_short_query",
                "token_count": token_count,
            }

        # 7. Complex reasoning / multi-step -> DeepSeek V4 Pro
        reasoning_keywords = [
            "analyze", "compare", "evaluate", "reason", "step by step", "explain",
            "why", "how to", "what if", "分析", "比较", "评估", "推理",
            "步骤", "详细解释", "深入研究", "总结", "归纳", "演绎",
        ]
        if any(kw in lower for kw in reasoning_keywords):
            if ModelConfig.get("deepseek-v4-pro")["available"]:
                return {
                    "model_name": "deepseek-v4-pro",
                    "provider": ModelProvider.DEEPSEEK,
                    "model_id": "deepseek-v4-pro",
                    "reason": "complex_reasoning",
                }

        # 8. Default -> local Ollama
        return {
            "model_name": "ollama-qwen2.5-0.5b",
            "provider": ModelProvider.OLLAMA,
            "model_id": "qwen2.5:0.5b",
            "reason": "default",
            "token_count": token_count,
        }


class SummaryCache:
    """In-memory cache for summaries to avoid duplicate LLM calls."""

    def __init__(self, max_size: int = 1000):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._max_size = max_size

    def _key(self, text: str, length: str) -> str:
        return hashlib.sha256(f"{text}:{length}".encode()).hexdigest()[:32]

    def get(self, text: str, length: str) -> Optional[str]:
        key = self._key(text, length)
        entry = self._cache.get(key)
        if entry and (time.time() - entry["ts"]) < 3600:  # 1 hour TTL
            return entry["summary"]
        return None

    def set(self, text: str, length: str, summary: str) -> None:
        key = self._key(text, length)
        if len(self._cache) >= self._max_size:
            # Evict oldest
            oldest = min(self._cache, key=lambda k: self._cache[k]["ts"])
            del self._cache[oldest]
        self._cache[key] = {"summary": summary, "ts": time.time()}


class LLMService:
    def __init__(self):
        self.ollama_url = settings.OLLAMA_BASE_URL
        self.deepseek_key = settings.DEEPSEEK_API_KEY
        self.kimi_key = settings.KIMI_API_KEY
        self.opencode_key = settings.OPENCODE_API_KEY
        self.summary_cache = SummaryCache()
        self.tags_cache = SummaryCache(max_size=2000)  # Re-use cache structure for tags

    def _get_user_llm_config(self, user_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract LLM-related config from a user settings dict."""
        if not user_settings:
            return {}
        ai = user_settings.get("ai", {}) or {}
        return {
            "active_provider": ai.get("active_provider"),
            "active_model": ai.get("active_model"),
            "kimi_api_key": ai.get("kimi_api_key"),
            "deepseek_api_key": ai.get("deepseek_api_key"),
            "opencode_api_key": ai.get("opencode_api_key"),
            "ollama_url": ai.get("ollama_url"),
        }

    def _resolve_user_active_model(
        self, user_settings: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Return a route dict if the user has an active provider/model configured."""
        cfg = self._get_user_llm_config(user_settings)
        provider = cfg.get("active_provider")
        model = cfg.get("active_model")
        if not provider or not model:
            return None

        # Try to match a known model config by provider + model_id/model_name
        for model_name, model_cfg in ModelConfig.MODELS.items():
            if model_cfg["provider"].value == provider and (
                model_cfg["model_id"] == model or model_name == model
            ):
                return {
                    "model_name": model_name,
                    "provider": model_cfg["provider"],
                    "model_id": model_cfg["model_id"],
                    "reason": "user_active_setting",
                }

        # Fallback: treat the saved values as a custom route if provider is known
        try:
            provider_enum = ModelProvider(provider)
            return {
                "model_name": model,
                "provider": provider_enum,
                "model_id": model,
                "reason": "user_active_setting",
            }
        except ValueError:
            return None

    # ─────────────────────────── Health Checks ───────────────────────────

    async def health_check(self, user_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Check health status of all configured LLM providers.

        Uses API keys / Ollama URL from ``user_settings`` when present, falling back
        to environment-level keys configured at startup.
        """
        cfg = self._get_user_llm_config(user_settings)
        ollama_url = cfg.get("ollama_url") or self.ollama_url
        keys = {
            ModelProvider.DEEPSEEK: cfg.get("deepseek_api_key") or self.deepseek_key,
            ModelProvider.KIMI: cfg.get("kimi_api_key") or self.kimi_key,
            ModelProvider.OPENCODE: cfg.get("opencode_api_key") or self.opencode_key,
        }

        results = []

        # Check Ollama - local default service
        ollama_status = ProviderStatus.get_status(ModelProvider.OLLAMA, available=True)
        try:
            start = time.time()
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
                if resp.status_code == 200:
                    ollama_status["latency"] = round((time.time() - start) * 1000)
                    ollama_status["connected"] = True
                else:
                    ollama_status["latency"] = -1
                    ollama_status["connected"] = False
        except Exception:
            ollama_status["latency"] = -1
            ollama_status["connected"] = False
        results.append(ollama_status)

        # Check cloud providers
        for provider in (
            ModelProvider.DEEPSEEK,
            ModelProvider.KIMI,
            ModelProvider.OPENCODE,
        ):
            api_key = keys.get(provider, "")
            status = ProviderStatus.get_status(provider, available=bool(api_key))
            if api_key:
                try:
                    start = time.time()
                    config = ProviderStatus.PROVIDER_CONFIG[provider]
                    headers = {"Authorization": f"Bearer {api_key}"}
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        resp = await client.get(
                            f"{config['base_url']}{config['health_endpoint']}",
                            headers=headers,
                        )
                        status["connected"] = resp.status_code == 200
                        status["latency"] = round((time.time() - start) * 1000)
                except Exception:
                    status["connected"] = False
            results.append(status)

        # Pick active provider/model: user setting first, then Ollama default
        user_active_provider = cfg.get("active_provider")
        if user_active_provider:
            active = next(
                (r for r in results if r["provider"].lower() == user_active_provider.lower()),
                None,
            )
            if not active:
                try:
                    active_cfg = ProviderStatus.PROVIDER_CONFIG.get(
                        ModelProvider(user_active_provider), {}
                    )
                except ValueError:
                    active_cfg = {}
                active = {
                    "provider": active_cfg.get("name", user_active_provider),
                    "model": cfg.get("active_model") or active_cfg.get("default_model", "unknown"),
                    "connected": False,
                    "latency": -1,
                }
            if cfg.get("active_model"):
                active["model"] = cfg["active_model"]
        else:
            ollama_result = next((r for r in results if r["provider"] == "Ollama"), None)
            active = ollama_result if ollama_result else (results[0] if results else None)

        return {
            "active_provider": active["provider"] if active else None,
            "active_model": active["model"] if active else None,
            "connected": active["connected"] if active else False,
            "latency": active["latency"] if active else -1,
            "providers": results,
        }

    async def list_ollama_models(
        self, user_settings: Optional[Dict[str, Any]] = None
    ) -> List[str]:
        """List models available on the configured Ollama server."""
        cfg = self._get_user_llm_config(user_settings)
        ollama_url = cfg.get("ollama_url") or self.ollama_url
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{ollama_url}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    models = data.get("models", [])
                    return [m.get("name") for m in models if m.get("name")]
        except Exception:
            pass
        return []

    async def test_provider(
        self, provider: ModelProvider, user_settings: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Test connectivity for a single provider and return latency."""
        cfg = self._get_user_llm_config(user_settings)
        config = ProviderStatus.PROVIDER_CONFIG.get(provider, {})
        result = {
            "provider": config.get("name", provider.value),
            "model": config.get("default_model", "unknown"),
            "connected": False,
            "latency": -1,
        }

        if provider == ModelProvider.OLLAMA:
            ollama_url = cfg.get("ollama_url") or self.ollama_url
            try:
                start = time.time()
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get(f"{ollama_url}/api/tags")
                    result["connected"] = resp.status_code == 200
                    if result["connected"]:
                        result["latency"] = round((time.time() - start) * 1000)
            except Exception:
                result["connected"] = False
            return result

        key_map = {
            ModelProvider.DEEPSEEK: cfg.get("deepseek_api_key") or self.deepseek_key,
            ModelProvider.KIMI: cfg.get("kimi_api_key") or self.kimi_key,
            ModelProvider.OPENCODE: cfg.get("opencode_api_key") or self.opencode_key,
        }
        api_key = key_map.get(provider, "")
        if not api_key:
            return result

        headers = {"Authorization": f"Bearer {api_key}"}

        try:
            start = time.time()
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{config['base_url']}{config['health_endpoint']}",
                    headers=headers,
                )
                result["connected"] = resp.status_code == 200
                if result["connected"]:
                    result["latency"] = round((time.time() - start) * 1000)
        except Exception:
            result["connected"] = False

        return result

    @staticmethod
    def _normalize_history(
        history: Optional[List[Dict[str, str]]]
    ) -> List[Dict[str, str]]:
        """Normalize frontend history roles to provider-expected values."""
        if not history:
            return []
        normalized = []
        for msg in history:
            role = msg.get("role", "").lower()
            content = msg.get("content", "")
            if not content:
                continue
            # Map frontend 'ai' role to OpenAI-compatible 'assistant'
            if role == "ai":
                role = "assistant"
            normalized.append({"role": role, "content": content})
        return normalized

    # ─────────────────────────── Chat ───────────────────────────

    def resolve_route(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
        preferred_model: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        user_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Resolve which model/provider will handle a chat request without streaming."""
        history = self._normalize_history(history)

        if preferred_model and preferred_model in ModelConfig.MODELS:
            return LLMRouterService.route(
                content=message,
                context=context,
                preferred_model=preferred_model,
            )

        route = self._resolve_user_active_model(user_settings)
        if route:
            return route

        return LLMRouterService.route(
            content=message,
            context=context,
            preferred_model=None,
        )

    async def chat(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
        brain_side: str = "both",
        sensitivity: str = "low",
        task_type: str = "chat",
        preferred_model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        user_settings: Optional[Dict[str, Any]] = None,
        db: Optional[Any] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream chat response from the routed LLM.

        Resolution order:
        1. ``preferred_model`` overrides everything if it is a known model.
        2. User's active provider/model from ``user_settings``.
        3. Intelligent routing via ``LLMRouterService``.

        API keys / Ollama URL from ``user_settings`` take precedence over platform
        accounts, which in turn take precedence over environment variables.
        """
        route = self.resolve_route(
            message=message,
            history=history,
            preferred_model=preferred_model,
            context=context,
            user_settings=user_settings,
        )

        cfg = self._get_user_llm_config(user_settings)
        history = self._normalize_history(history)

        provider = route["provider"]
        model = route["model_id"]

        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"LLM chat routed to provider={provider.value} model={model} reason={route.get('reason', 'unknown')}")

        creds = self._resolve_credentials(provider, cfg, db)
        api_key = creds.get("api_key")
        base_url = creds.get("base_url")
        account_id = creds.get("account_id")
        ollama_url = base_url or (cfg.get("ollama_url") or self.ollama_url)

        chat_generator = self._route_chat(
            provider=provider,
            message=message,
            history=history,
            model=model,
            system_prompt=system_prompt,
            api_key=api_key,
            base_url=base_url,
            ollama_url=ollama_url,
        )

        if account_id and db is not None:
            chat_generator = self._track_provider_health(chat_generator, account_id, db)

        async for chunk in chat_generator:
            yield chunk

    def _resolve_credentials(
        self,
        provider: ModelProvider,
        cfg: Dict[str, Any],
        db: Optional[Any],
    ) -> Dict[str, Any]:
        """Resolve API key and base_url for a provider.

        Priority:
        1. User-provided key in settings.
        2. Active platform account (if db session available).
        3. Environment / default key.
        """
        user_key = None
        env_key = None
        default_base_url = None

        if provider == ModelProvider.KIMI:
            user_key = cfg.get("kimi_api_key")
            env_key = self.kimi_key
            default_base_url = settings.KIMI_BASE_URL
        elif provider == ModelProvider.DEEPSEEK:
            user_key = cfg.get("deepseek_api_key")
            env_key = self.deepseek_key
            default_base_url = settings.DEEPSEEK_BASE_URL
        elif provider == ModelProvider.OPENCODE:
            user_key = cfg.get("opencode_api_key")
            env_key = self.opencode_key
            default_base_url = settings.OPENCODE_BASE_URL

        if user_key:
            return {"api_key": user_key, "base_url": default_base_url}

        if db is not None:
            try:
                router = LLMProviderRouter(db)
                account_creds = router.get_credentials(provider.value, default_base_url=default_base_url)
                if account_creds and account_creds.get("api_key"):
                    return account_creds
            except Exception:
                # Don't let account lookup break the chat flow
                pass

        return {"api_key": env_key, "base_url": default_base_url}

    async def _route_chat(
        self,
        provider: ModelProvider,
        message: str,
        history: Optional[List[Dict[str, str]]],
        model: str,
        system_prompt: Optional[str],
        api_key: Optional[str],
        base_url: Optional[str],
        ollama_url: Optional[str],
    ) -> AsyncGenerator[str, None]:
        if provider == ModelProvider.OLLAMA:
            async for chunk in self._chat_ollama(
                message, history, model, system_prompt, base_url=ollama_url
            ):
                yield chunk
        elif provider == ModelProvider.DEEPSEEK and api_key:
            async for chunk in self._chat_deepseek(
                message, history, model, system_prompt, api_key=api_key, base_url=base_url
            ):
                yield chunk
        elif provider == ModelProvider.KIMI and api_key:
            async for chunk in self._chat_openai_compatible(
                message, history, model, system_prompt, api_key=api_key, base_url=base_url,
                provider_name="Kimi"
            ):
                yield chunk
        elif provider == ModelProvider.OPENCODE and api_key:
            async for chunk in self._chat_openai_compatible(
                message, history, model, system_prompt, api_key=api_key, base_url=base_url,
                provider_name="OpenCode"
            ):
                yield chunk
        else:
            async for chunk in self._chat_ollama(
                message, history, model, system_prompt, base_url=ollama_url
            ):
                yield chunk

    async def _track_provider_health(
        self,
        generator: AsyncGenerator[str, None],
        account_id: str,
        db: Any,
    ) -> AsyncGenerator[str, None]:
        """Wrap a chat generator to record success/failure on platform accounts."""
        try:
            async for chunk in generator:
                yield chunk
            try:
                LLMProviderRouter(db).touch_success(account_id)
            except Exception:
                pass
        except Exception:
            try:
                LLMProviderRouter(db).touch_failure(account_id)
            except Exception:
                pass
            raise

    async def _chat_ollama(
        self, message, history, model, system_prompt, base_url: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        payload = {"model": model, "messages": messages, "stream": True}
        ollama_url = base_url or self.ollama_url
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST", f"{ollama_url}/api/chat", json=payload
                ) as response:
                    async for line in response.aiter_lines():
                        if line.strip():
                            try:
                                data = json.loads(line)
                                if "message" in data and "content" in data["message"]:
                                    yield data["message"]["content"]
                                elif "done" in data and data["done"]:
                                    break
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            yield f"[Error: Ollama connection failed - {str(e)}]"

    async def _chat_openai_compatible(
        self, message, history, model, system_prompt, api_key: Optional[str] = None,
        base_url: Optional[str] = None, provider_name: str = "OpenAI-compatible"
    ) -> AsyncGenerator[str, None]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        payload = {"model": model, "messages": messages, "stream": True}
        key = api_key
        base = (base_url or "https://api.openai.com").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{base}/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json=payload,
                ) as response:
                    async for line in response.aiter_lines():
                        if line.strip().startswith("data: "):
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                if "choices" in data and len(data["choices"]) > 0:
                                    delta = data["choices"][0].get("delta", {})
                                    if "content" in delta:
                                        yield delta["content"]
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            yield f"[Error: {provider_name} connection failed - {str(e)}]"

    async def _chat_deepseek(
        self, message, history, model, system_prompt, api_key: Optional[str] = None, base_url: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        # deepseek-v4 默认开启思考，reasoning 散文会污染所有 JSON 消费方
        # （验证/摘要/标签/管线抽取），按官方参数关闭思考输出
        payload = {"model": model, "messages": messages, "stream": True, "thinking": {"type": "disabled"}}
        key = api_key or self.deepseek_key
        base = (base_url or settings.DEEPSEEK_BASE_URL or "https://api.deepseek.com").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    f"{base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                ) as response:
                    async for line in response.aiter_lines():
                        if line.strip().startswith("data: "):
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                if "choices" in data and len(data["choices"]) > 0:
                                    delta = data["choices"][0].get("delta", {})
                                    if delta.get("content"):
                                        yield delta["content"]
                                    # reasoning_content 不再混入正文流（见上方 thinking 开关）
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            yield f"[Error: DeepSeek connection failed - {str(e)}]"

    # ─────────────────────────── Summarize ───────────────────────────

    async def summarize(self, text: str, length: str = "medium") -> Dict[str, Any]:
        """Summarize text with 3 length options and caching.

        length: 'short' (1-2 sentences), 'medium' (3-5 sentences), 'long' (detailed paragraph)
        Returns dict with summary, original_length, compression_ratio.
        """
        # Validate length
        if length not in ("short", "medium", "long"):
            length = "medium"

        # Check cache
        cached = self.summary_cache.get(text, length)
        if cached:
            return {
                "summary": cached,
                "original_length": len(text),
                "compression_ratio": round(len(cached) / max(len(text), 1), 4),
                "cached": True,
                "length": length,
            }

        # Build prompt based on length
        length_prompts = {
            "short": "请用1-2句话总结以下内容的要点：",
            "medium": "请用3-5句话总结以下内容的主要观点和结论：",
            "long": "请详细总结以下内容，包含主要观点、关键论据、结论和背景：",
        }
        prompt = f"{length_prompts[length]}\n\n{text}"

        result = []
        async for chunk in self.chat(prompt, task_type="summarize", preferred_model="deepseek-v4-flash"):
            result.append(chunk)
        summary = "".join(result).strip()

        # Store in cache
        self.summary_cache.set(text, length, summary)

        return {
            "summary": summary,
            "original_length": len(text),
            "compression_ratio": round(len(summary) / max(len(text), 1), 4),
            "cached": False,
            "length": length,
        }

    # ─────────────────────────── Extract Tags ───────────────────────────

    async def extract_tags(self, text: str) -> Dict[str, Any]:
        """Extract 3-10 keyword tags from text using LLM.

        Returns dict with tags, suggested_category, and original_length.
        """
        # Check cache using hash key (ignore length for tags)
        cache_key = hashlib.sha256(text.encode()).hexdigest()[:32]
        cached = self.tags_cache._cache.get(cache_key, {}).get("tags")
        if cached:
            return {
                "tags": cached["tags"],
                "suggested_category": cached.get("suggested_category"),
                "original_length": len(text),
                "cached": True,
            }

        prompt = (
            "请从以下文本中提取3-10个关键词标签。要求："
            "1. 标签应简洁（1-3个词）"
            "2. 全部小写"
            "3. 去除停用词（如'的'、'是'、'和'）"
            "4. 返回格式：仅逗号分隔的标签列表，不要有其他内容\n\n"
            f"文本：\n{text}"
        )
        result = []
        async for chunk in self.chat(prompt, task_type="tag_extraction", preferred_model="deepseek-v4-flash"):
            result.append(chunk)
        raw = "".join(result).strip()

        # Parse and clean tags
        tags = []
        for tag in re.split(r"[,，、]", raw):
            tag = tag.strip().lower()
            tag = re.sub(r"^[\s\d\.\-•]+", "", tag)  # Remove leading numbers/bullets
            tag = re.sub(r"[\s\d\.\-•]+$", "", tag)  # Remove trailing numbers/bullets
            if tag and len(tag) <= 20 and tag not in tags:
                tags.append(tag)

        tags = tags[:10]  # Cap at 10

        # Suggest category based on known tags
        categories = {
            "技术": ["code", "编程", "python", "javascript", "api", "数据库", "算法", "debug", "前端", "后端"],
            "学术": ["论文", "研究", "理论", "实验", "分析", "数据", "文献"],
            "商业": ["市场", "产品", "用户", "增长", "营收", "战略", "竞争"],
            "生活": ["健康", "饮食", "运动", "旅行", "家庭", "心理"],
            "创意": ["设计", "艺术", "写作", "音乐", "摄影", "灵感"],
        }
        suggested_category = None
        for cat, cat_tags in categories.items():
            if any(t in cat_tags for t in tags):
                suggested_category = cat
                break

        # Store in cache
        self.tags_cache._cache[cache_key] = {"tags": tags, "suggested_category": suggested_category}
        # Limit cache size
        if len(self.tags_cache._cache) > self.tags_cache._max_size:
            self.tags_cache._cache.pop(next(iter(self.tags_cache._cache)))

        return {
            "tags": tags,
            "suggested_category": suggested_category,
            "original_length": len(text),
            "cached": False,
        }

    # ─────────────────────────── Embeddings ───────────────────────────

    async def embed(self, text: str) -> List[float]:
        """Generate text embedding via Ollama (qwen2.5:0.5b) or fallback."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    json={"model": "qwen2.5:0.5b", "prompt": text}
                )
                data = response.json()
                embedding = data.get("embedding", [])
                if embedding and len(embedding) > 0:
                    return embedding
        except Exception:
            pass

        return []

    async def batch_embed(self, texts: List[str]) -> List[List[float]]:
        """Batch embed multiple texts."""
        if not texts:
            return []

        # Try Ollama batch via parallel requests (Ollama doesn't have native batch API for embeddings)
        results = []
        for text in texts:
            emb = await self.embed(text)
            results.append(emb)
        return results

    async def store_embedding(
        self,
        text: str,
        content_type: str,
        content_id: str,
        user_id: str = "default",
    ) -> Dict[str, Any]:
        """Generate embedding and store in SQLite."""
        embedding = await self.embed(text)
        if not embedding:
            return {"success": False, "error": "embedding_generation_failed"}

        emb_id = hashlib.sha256(f"{user_id}:{content_type}:{content_id}:{text[:100]}".encode()).hexdigest()[:32]

        try:
            db = SessionLocal()
            # Upsert: delete existing then insert
            db.query(Embedding).filter(
                Embedding.content_type == content_type,
                Embedding.content_id == content_id,
            ).delete()
            db.add(Embedding(
                id=emb_id,
                user_id=user_id,
                content_type=content_type,
                content_id=content_id,
                embedding_json=json.dumps(embedding),
                dimensions=len(embedding),
                model_name="qwen2.5:0.5b",
            ))
            db.commit()
            db.close()
            return {
                "success": True,
                "id": emb_id,
                "dimensions": len(embedding),
                "model": "qwen2.5:0.5b",
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ─────────────────────────── Model Info ───────────────────────────

    def get_model_info(self, model_name: Optional[str] = None) -> Dict[str, Any]:
        """Get model description and availability status."""
        if model_name:
            cfg = ModelConfig.get(model_name)
            if not cfg:
                return {"error": f"Model {model_name} not found"}
            return {
                "model_name": model_name,
                **cfg,
            }
        return {
            "models": ModelConfig.get_all(),
            "active_provider": "ollama",
            "routing_enabled": True,
        }

    def test_route(self, content: str, preferred_model: Optional[str] = None) -> Dict[str, Any]:
        """Preview routing decision for a given content."""
        route = LLMRouterService.route(content, preferred_model=preferred_model)
        cfg = ModelConfig.get(route["model_name"])
        return {
            "route": route,
            "model_info": cfg,
            "content_preview": content[:200] + "..." if len(content) > 200 else content,
            "estimated_tokens": LLMRouterService.estimate_tokens(content),
        }


llm_service = LLMService()
