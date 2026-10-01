"""Embedding service - local + remote fallback, with SQLite storage"""

import httpx
import json
import logging
import uuid
from typing import List, Optional

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.base import Embedding as EmbeddingModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Generate text embeddings via local Ollama (model from OLLAMA_EMBED_MODEL,
    default nomic-embed-text) with fallback to external API. Supports batch
    embedding and persistence to SQLite (via Embedding model).
    """

    # 嵌入线遗留常量：仅在 OLLAMA_EMBED_MODEL 未配置时兜底，以及
    # Ollama 嵌入 500 时的二次尝试（:101）；正常部署走 bge-m3（08-28 换代）。
    DEFAULT_MODEL = "qwen3.5:0.8b"
    FALLBACK_MODEL = "qwen3.5:0.8b"  # Use the same lightweight local model
    DIMENSIONS = 896  # mock 向量长度（与 EMBEDDING_DIMENSION 口径一致），非某模型真实维度
    # 嵌入模型换代过渡：配置的模型未安装时的降级目标（老部署普遍装着）
    LEGACY_EMBED_MODEL = "nomic-embed-text"

    def __init__(self):
        self.ollama_url = settings.OLLAMA_BASE_URL
        # 优先用配置里的专用 embedding 模型（如 bge-m3）；
        # 未配置时退回轻量聊天模型（部分 Ollama 版本不支持其做 embedding）
        self.model = getattr(settings, "OLLAMA_EMBED_MODEL", "") or self.DEFAULT_MODEL
        self._configured_model = self.model  # 配置原值：降级后周期重探升回用
        self._last_reprobe = 0.0
        self.model_available: Optional[bool] = None  # None=未探测
        self._resolve_model_availability()

    _REPROBE_INTERVAL = 1800.0  # 降级后的重探间隔（秒）：降级链双向化

    def _maybe_reprobe(self) -> None:
        """降级（沿用旧模型/判未安装）后周期性重探配置模型是否已就位（09-22：
        降级链只降不升——模型管家装完新模型要重启才生效的口径补齐）。
        只在「已被降级过」时干活，热路径每 30 分钟最多一次 /api/tags（3s 超时）。
        探测失败/配置模型仍不可用时不改现状（别把可用的旧模型升回配置空挂）。"""
        if self.model == self._configured_model and self.model_available is not False:
            return  # 未降级：无需重探
        import time
        now = time.time()
        if now - self._last_reprobe < self._REPROBE_INTERVAL:
            return
        self._last_reprobe = now
        prev = self.model
        self.model = self._configured_model
        self._resolve_model_availability()
        if self.model == self._configured_model and self.model_available is not True:
            # 配置模型仍不可用（含探测失败）：回到降级前状态，不升反降
            self.model = prev
        elif self.model != prev:
            logger.info("嵌入模型重探升回：%s → %s", prev, self.model)

    def _resolve_model_availability(self) -> None:
        """启动探测配置的嵌入模型是否已安装；未安装且 nomic-embed-text 在场
        则降级沿用旧模型（换 bge-m3 后老用户/老服务器还没拉新模型的过渡期，
        避免嵌入全落 mock 向量污染索引）。探测失败（ollama 没起）保持配置不变。
        """
        try:
            resp = httpx.get(f"{self.ollama_url.rstrip('/')}/api/tags", timeout=3.0, trust_env=False)
            if resp.status_code != 200:
                return
            names = [m.get("name", "") for m in resp.json().get("models", [])]
            prefix = self.model.split(":")[0]
            if any(n == self.model or n.startswith(prefix) for n in names):
                self.model_available = True
                return
            if self.model != self.LEGACY_EMBED_MODEL and any(
                n == self.LEGACY_EMBED_MODEL or n.startswith(self.LEGACY_EMBED_MODEL.split(":")[0])
                for n in names
            ):
                logger.warning(
                    "嵌入模型 %s 未安装，过渡期降级沿用 %s（请通过模型管家/ollama pull 安装新模型）",
                    self.model, self.LEGACY_EMBED_MODEL,
                )
                self.model = self.LEGACY_EMBED_MODEL
                self.model_available = True
                return
            self.model_available = False
            logger.warning("嵌入模型 %s 未安装且无旧模型可降级，嵌入将落 mock 兜底", self.model)
        except Exception:
            # ollama 未启动/网络异常：保持配置，按既有失败链路走（查询 mock 兜底）
            self.model_available = None

    async def embed(self, text: str, store: bool = False, content_type: str = "query", content_id: str = "", user_id: str = "") -> dict:
        """
        Generate embedding for a single text.
        Returns: {"embedding": List[float], "dimensions": int, "model_used": str}
        """
        self._maybe_reprobe()  # 被降级过时周期重探升回（未降级零成本直接返回）
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
        from app.services.ollama_gate import ollama_slot
        try:
            # 本地模型并发闸（与生成路同一道）：排队超时落既有 [] 降级语义
            async with ollama_slot("embed") as _slot:
                if not _slot:
                    return []
                # trust_env=False：Windows 系统代理会把 localhost 请求劫持到代理
                # 端口，30s read timeout ×N 就是卡死源（与 _resolve_model_availability
                # 探测、run_mega_eval 同款口径）
                async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
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

    def _store_embedding(self, text: str, embedding: List[float], content_type: str, content_id: str, user_id: str, model: str,
                         parent_content_id: Optional[str] = None, chunk_index: Optional[int] = None,
                         chunk_text: Optional[str] = None, parent_text: Optional[str] = None) -> None:
        """Persist embedding to SQLite（父子块元数据 4 参可空，老调用方零改动）"""
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
                parent_content_id=parent_content_id,
                chunk_index=chunk_index,
                chunk_text=chunk_text,
                parent_text=parent_text,
            )
            db.add(emb)
            # 开源版无 vec_index 影子索引（剥离面）：embeddings 表即唯一事实源
            db.commit()
            db.close()
        except Exception as e:
            # 存储失败不阻断 API，但必须留痕（吞异常要 warning）
            logger.warning("embedding storage failed for %s: %s", content_id, e)

    def search_similar(self, query_embedding: List[float], content_type: Optional[str] = None, top_k: int = 5, user_id: str = "", db: Optional[Session] = None, tenant_id: Optional[str] = None, scope_user_id: Optional[str] = None) -> List[dict]:
        """
        Cosine similarity search over stored embeddings.
        开源版无 vec_index 影子索引（剥离面）：全表暴力余弦唯一路径。
        tenant_id 非空 = 团队空间口径：不按 embedding.user_id 限（团队内容向量
        各记创建者），由调用方对内容行按空间口径过滤（retrieval 主链同此哲学）。
        scope_user_id（批 C 目录级权限）：团队口径下请求者 id，由调用方在内容行
        查询上收口。
        """
        # clamp top_k：暴力兜底是全表载入 + 逐条比对，
        # 上限 100 防调用方传入超大 top_k 放大返回体
        top_k = max(1, min(int(top_k), 100))
        own_session = db is None
        session: Session = db or SessionLocal()
        try:
            # 开源版无 vec_index（剥离面）：直走全表暴力余弦

            query = session.query(EmbeddingModel)
            if user_id:
                query = query.filter(EmbeddingModel.user_id == user_id)
            if content_type:
                query = query.filter(EmbeddingModel.content_type == content_type)
            records = query.all()

            results = []
            for rec in records:
                emb = json.loads(rec.embedding_json)
                sim = self._cosine_similarity(query_embedding, emb)
                results.append({
                    "id": rec.id,
                    "content_type": rec.content_type,
                    "content_id": rec.content_id,
                    "text_preview": rec.text_preview,
                    # 父子块字段：检索端命中子块时直接用 chunk_text/parent_text，老行为 NULL
                    "chunk_text": rec.chunk_text,
                    "parent_text": rec.parent_text,
                    "similarity": round(sim, 4),
                    "model": rec.model,
                })

            results.sort(key=lambda x: x["similarity"], reverse=True)
            return results[:top_k]
        except Exception:
            return []
        finally:
            if own_session:
                session.close()

    def _knn_results(self, session: Session, hits: List[tuple], content_type: Optional[str], top_k: int) -> List[dict]:
        """KNN 命中回表：校验 Embedding 行仍存在（容忍索引脏行）并应用 content_type 过滤。"""
        ids = [eid for eid, _ in hits]
        if not ids:
            return []
        query = session.query(EmbeddingModel).filter(EmbeddingModel.id.in_(ids))
        if content_type:
            query = query.filter(EmbeddingModel.content_type == content_type)
        rows = {rec.id: rec for rec in query.all()}

        results = []
        for eid, distance in hits:  # hits 已按距离升序 = 相似度降序
            rec = rows.get(eid)
            if rec is None:
                continue  # 索引脏行：Embedding 已删，跳过
            results.append({
                "id": rec.id,
                "content_type": rec.content_type,
                "content_id": rec.content_id,
                "text_preview": rec.text_preview,
                # 父子块字段：检索端命中子块时直接用 chunk_text/parent_text，老行为 NULL
                "chunk_text": rec.chunk_text,
                "parent_text": rec.parent_text,
                "similarity": round(1.0 - distance, 4),
                "model": rec.model,
            })
        return results[:top_k]

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


def similarity_profile() -> dict:
    """当前解析嵌入模型的相似度阈值预设（08-28 换代期两套校准并存，随 model 自动切换）。

    bge-m3 系：分布整体下移、语义分离度margin 0.106（demo 真实库 172 文档实测
    p50=0.443/p90=0.523/p99=0.600；50 题相关最低 0.492）；
    nomic 系：旧校准（p50=0.670/p90=0.753，margin 0.001 贴死）。
    键：retrieval_floor=检索绝对下限 / graph_sim=物理图成边阈值 /
    band_low|band_high=碰撞配对与手动关联建议的相似度区间。
    """
    if "bge-m3" in embedding_service.model:
        return {"retrieval_floor": 0.48, "graph_sim": 0.55,
                "band_low": 0.45, "band_high": 0.60}
    return {"retrieval_floor": 0.55, "graph_sim": 0.75,
            "band_low": 0.55, "band_high": 0.85}
