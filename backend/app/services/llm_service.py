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
        async for chunk in self.chat(prompt, task_type="summarize", preferred_model="ollama-qwen2.5-0.5b"):
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
        async for chunk in self.chat(prompt, task_type="tag_extraction", preferred_model="ollama-qwen2.5-0.5b"):
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
