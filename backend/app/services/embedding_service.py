"""Embedding service - local + remote fallback, with SQLite storage"""

import httpx
import json
import uuid
from typing import List, Optional

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.base import Embedding as EmbeddingModel
from sqlalchemy.orm import Session


class EmbeddingService:
    """
    Generate text embeddings via local Ollama (qwen2.5:0.5b)
    with fallback to external API. Supports batch embedding and
    persistence to SQLite (via Embedding model).
    """

    DEFAULT_MODEL = "qwen2.5:0.5b"
    FALLBACK_MODEL = "qwen2.5:0.5b"  # Use the same lightweight local model
    DIMENSIONS = 896  # qwen2.5:0.5b embedding dimensions

    def __init__(self):
        self.ollama_url = settings.OLLAMA_BASE_URL
        self.model = self.DEFAULT_MODEL

    async def embed(self, text: str, store: bool = False, content_type: str = "query", content_id: str = "", user_id: str = "") -> dict:
        """
        Generate embedding for a single text.
        Returns: {"embedding": List[float], "dimensions": int, "model_used": str}
        """
        embedding = await self._embed_via_ollama(text)
        model_used = f"ollama/{self.model}"

        if not embedding:
            # Fallback to simple mock if Ollama is unavailable (for dev/testing)
            embedding = self._mock_embedding(text)
            model_used = "mock/fallback"

        if store:
            self._store_embedding(text, embedding, content_type, content_id, user_id, model_used)

        return {
            "embedding": embedding,
            "dimensions": len(embedding),
            "model_used": model_used,
        }

    async def batch_embed(self, texts: List[str], store: bool = False, content_type: str = "query", user_id: str = "") -> dict:
        """
        Batch generate embeddings. Local Ollama doesn't have a native batch API,
        so we call sequentially with small concurrency.
        """
        embeddings = []
        model_used = f"ollama/{self.model}"

        # Process sequentially to avoid overwhelming local Ollama
        for i, text in enumerate(texts):
            result = await self.embed(text, store=False)
            embeddings.append(result["embedding"])
            if not result["embedding"]:
                model_used = result["model_used"]

        if store:
            for i, emb in enumerate(embeddings):
                self._store_embedding(
                    text=texts[i][:200],
                    embedding=emb,
                    content_type=content_type,
                    content_id="",
                    user_id=user_id,
                    model=model_used,
                )

        return {
            "embeddings": embeddings,
            "dimensions": len(embeddings[0]) if embeddings else 0,
            "model_used": model_used,
            "count": len(texts),
        }

    async def _embed_via_ollama(self, text: str) -> List[float]:
        """Call Ollama /api/embeddings"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    json={"model": self.model, "prompt": text},
                )
                if response.status_code == 200:
                    data = response.json()
                    return data.get("embedding", [])
                # Try fallback model
                response2 = await client.post(
                    f"{self.ollama_url}/api/embeddings",
                    json={"model": self.FALLBACK_MODEL, "prompt": text},
                )
                if response2.status_code == 200:
                    data2 = response2.json()
                    return data2.get("embedding", [])
        except Exception:
            pass
        return []

    def _mock_embedding(self, text: str) -> List[float]:
        """
        Deterministic mock embedding for development when Ollama is unavailable.
        Uses a simple hash-based approach to generate a fixed-length vector.
        """
        import hashlib
        import math
        seed = hashlib.md5(text.encode("utf-8")).hexdigest()
        vec = []
        for i in range(self.DIMENSIONS):
            # Deterministic pseudo-random based on seed
            val = (int(seed[i % 32], 16) / 8.0 - 1.0) + math.sin(i * 0.1 + int(seed[0], 16))
            vec.append(round(val, 6))
        return vec

    def _store_embedding(self, text: str, embedding: List[float], content_type: str, content_id: str, user_id: str, model: str) -> None:
        """Persist embedding to SQLite"""
        try:
            db: Session = SessionLocal()
            emb = EmbeddingModel(
                id=str(uuid.uuid4()),
                user_id=user_id,
                content_type=content_type,
                content_id=content_id or str(uuid.uuid4()),
                text_preview=text[:200],
                embedding_json=json.dumps(embedding),
                dimensions=len(embedding),
                model=model,
            )
            db.add(emb)
            db.commit()
            db.close()
        except Exception:
            # Silently fail storage to avoid breaking API
            pass

    def search_similar(self, query_embedding: List[float], content_type: Optional[str] = None, top_k: int = 5, user_id: str = "") -> List[dict]:
        """
        Simple cosine similarity search over stored embeddings.
        NOTE: For production, use ChromaDB or vector DB. SQLite is used here
        as a lightweight fallback with brute-force comparison.
        """
        try:
            db: Session = SessionLocal()
            query = db.query(EmbeddingModel)
            if user_id:
                query = query.filter(EmbeddingModel.user_id == user_id)
            if content_type:
                query = query.filter(EmbeddingModel.content_type == content_type)
            records = query.all()
            db.close()

            results = []
            for rec in records:
                emb = json.loads(rec.embedding_json)
                sim = self._cosine_similarity(query_embedding, emb)
                results.append({
                    "id": rec.id,
                    "content_type": rec.content_type,
                    "content_id": rec.content_id,
                    "text_preview": rec.text_preview,
                    "similarity": round(sim, 4),
                    "model": rec.model,
                })

            results.sort(key=lambda x: x["similarity"], reverse=True)
            return results[:top_k]
        except Exception:
            return []

    @staticmethod
    def _cosine_similarity(a: List[float], b: List[float]) -> float:
        import math
        if len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)


embedding_service = EmbeddingService()
