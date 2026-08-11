import httpx
import json
import re
import hashlib
import time
from typing import AsyncGenerator, Dict, Any, Optional, List
from enum import Enum

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.base import Embedding


class ModelProvider(str, Enum):
    OLLAMA = "ollama"


class SENSITIVE_PATTERNS:
    """Regex patterns for sensitive content detection."""
    PASSWORD = re.compile(r"password[:\s=]+\S+|密码[:\s=]+\S+|passwd[:\s=]+\S+|pwd[:\s=]+\S+", re.I)
    API_KEY = re.compile(r"sk-[a-zA-Z0-9]{48}|sk-[a-zA-Z0-9]{32}|api[_-]?key[:\s=]+\S+|apikey[:\s=]+\S+", re.I)
    ID_CARD = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)|(?<!\d)\d{15}(?!\d)")
    PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
    BANK_CARD = re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
    PRIVATE_KEY = re.compile(r"-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----")
    SECRET_TOKEN = re.compile(r"\btoken[:\s=]+\S+|\bbearer[\s:]+\S+|\bsecret[:\s=]+\S+", re.I)

    SEVERITY_LEVELS = {"low": 1, "medium": 2, "high": 3}

    @classmethod
    def detect(cls, text: str) -> Dict[str, Any]:
        """Detect sensitive content in text. Returns findings and severity."""
        findings = []
        severity = "low"

        def update_severity(level: str) -> None:
            nonlocal severity
            if cls.SEVERITY_LEVELS.get(level, 0) > cls.SEVERITY_LEVELS.get(severity, 0):
                severity = level

        if cls.PASSWORD.search(text):
            findings.append("password")
            update_severity("high")
        if cls.API_KEY.search(text):
            findings.append("api_key")
            update_severity("high")
        if cls.ID_CARD.search(text):
            findings.append("id_card")
            update_severity("high")
        if cls.PHONE.search(text):
            findings.append("phone")
            update_severity("medium")
        if cls.BANK_CARD.search(text):
            findings.append("bank_card")
            update_severity("high")
        if cls.PRIVATE_KEY.search(text):
            findings.append("private_key")
            update_severity("high")
        if cls.SECRET_TOKEN.search(text):
            findings.append("secret_token")
            update_severity("medium")
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
        2. Default -> local Ollama (only provider in this build; sensitive
           content therefore always stays on-device)
        """
        # 1. User override
        if preferred_model and preferred_model in ModelConfig.MODELS:
            cfg = ModelConfig.get(preferred_model)
            return {
                "model_name": preferred_model,
                "provider": cfg["provider"],
                "model_id": cfg["model_id"],
                "reason": "user_override",
            }

        # 2. Default -> local Ollama. Sensitive content is kept local by
        # construction, since Ollama is the only provider available.
        return {
            "model_name": "ollama-qwen2.5-0.5b",
            "provider": ModelProvider.OLLAMA,
            "model_id": "qwen2.5:0.5b",
            "reason": "default",
            "token_count": LLMRouterService.estimate_tokens(content),
        }


class LLMService:
    def __init__(self):
        self.ollama_url = settings.OLLAMA_BASE_URL

    def _get_user_llm_config(self, user_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract LLM-related config from a user settings dict."""
        if not user_settings:
            return {}
        ai = user_settings.get("ai", {}) or {}
        cfg = {
            "active_provider": ai.get("active_provider"),
            "active_model": ai.get("active_model"),
            "ollama_url": ai.get("ollama_url"),
        }
        # 校验用户提供的 Ollama URL 协议/主机，防 SSRF/内网探测；非法则回退默认
        user_ollama_url = cfg.get("ollama_url")
        if user_ollama_url:
            import urllib.parse
            parsed = urllib.parse.urlparse(user_ollama_url)
            if parsed.scheme in ("http", "https") and parsed.hostname in ("localhost", "127.0.0.1", "::1", "host.docker.internal"):
                pass
            elif parsed.scheme != "unix":
                cfg["ollama_url"] = None
        return cfg

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

        # Fallback: treat the saved values as a custom Ollama route
        if provider == ModelProvider.OLLAMA.value:
            return {
                "model_name": model,
                "provider": ModelProvider.OLLAMA,
                "model_id": model,
                "reason": "user_active_setting",
            }
        return None

    # ─────────────────────────── Health Checks ───────────────────────────

    async def health_check(self, user_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Check health status of the configured Ollama server.

        Uses the Ollama URL from ``user_settings`` when present, falling back
        to the environment-level URL configured at startup.
        """
        cfg = self._get_user_llm_config(user_settings)
        ollama_url = cfg.get("ollama_url") or self.ollama_url

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
        results = [ollama_status]

        # Active model: user setting first, then Ollama default
        active = ollama_status
        if cfg.get("active_model"):
            active = {**ollama_status, "model": cfg["active_model"]}

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
    ) -> AsyncGenerator[str, None]:
        """Stream chat response from the routed LLM.

        Resolution order:
        1. ``preferred_model`` overrides everything if it is a known model.
        2. User's active provider/model from ``user_settings``.
        3. Intelligent routing via ``LLMRouterService``.

        The Ollama URL from ``user_settings`` takes precedence over the
        environment-level URL.
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

        model = route["model_id"]
        ollama_url = cfg.get("ollama_url") or self.ollama_url

        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"LLM chat routed to provider=ollama model={model} reason={route.get('reason', 'unknown')}")

        async for chunk in self._chat_ollama(
            message, history, model, system_prompt, base_url=ollama_url
        ):
            yield chunk

    async def _chat_ollama(
        self, message, history, model, system_prompt, base_url: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        # 保活策略：常驻小模型（快记/问答秒回）永久驻留；大模型用 30m 闲置自动卸载省内存
        keep_alive = -1 if any(s in model for s in ("0.5b", "1.5b")) else "30m"
        payload = {"model": model, "messages": messages, "stream": True, "keep_alive": keep_alive}
        ollama_url = base_url or self.ollama_url
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST", f"{ollama_url}/api/chat", json=payload
                ) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        yield f"[Error: Ollama HTTP {response.status_code} - {error_text.decode('utf-8', errors='ignore')[:200]}]"
                        return
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

    # ─────────────────────────── Embeddings ───────────────────────────

    async def embed(self, text: str) -> List[float]:
        """Generate text embedding via Ollama（可用 OLLAMA_EMBED_MODEL 配置专用模型）or fallback."""
        model = getattr(settings, "OLLAMA_EMBED_MODEL", "") or "nomic-embed-text"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    # 嵌入模型检索期高频调用，永久驻留避免反复加载
                    json={"model": model, "prompt": text, "keep_alive": -1}
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
            # Upsert: delete existing then insert（按 user_id 隔离，防跨用户覆盖）
            db.query(Embedding).filter(
                Embedding.user_id == user_id,
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


async def chat_completion(
    prompt: str,
    task_type: str = "chat",
    system_prompt: Optional[str] = None,
    preferred_model: Optional[str] = None,
) -> str:
    """Non-streaming helper: run a single chat call and return the full text."""
    chunks: List[str] = []
    async for chunk in llm_service.chat(
        message=prompt,
        task_type=task_type,
        system_prompt=system_prompt,
        preferred_model=preferred_model,
    ):
        chunks.append(chunk)
    return "".join(chunks)
