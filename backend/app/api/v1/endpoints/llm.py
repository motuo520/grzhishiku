from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.orm import Session
import asyncio
import json
import logging

from app.services.llm_service import llm_service, chat_completion, LLMRouterService, ModelProvider
from app.core.config import settings
from app.core.security import get_current_user, get_current_user_optional
from app.models.base import User, KnowledgeUnit
from app.core.database import get_db
from app.schemas.llm import (
    ChatRequest, SummarizeRequest, SummarizeResponse, ExtractTagsRequest, ExtractTagsResponse,
    CompleteRequest, CompleteResponse,
    EmbedRequest, EmbedBatchRequest,
    RouteTestRequest, OllamaModelsResponse
)

router = APIRouter()

logger = logging.getLogger(__name__)


class ActiveLLMUpdate(BaseModel):
    provider: str = Field(..., description="Active LLM provider slug")
    model: str = Field(..., description="Active LLM model identifier")


@router.get("/status", summary="LLM Status", description="Get health status of all configured LLM providers.")
async def llm_status(current_user: User = Depends(get_current_user_optional)):
    user_settings = json.loads(current_user.settings or '{}') if current_user else {}
    status = await llm_service.health_check(user_settings=user_settings)
    return status


@router.get("/health", summary="LLM Health", description="Alias for /status. Returns the LLM health overview.")
async def llm_health(current_user: User = Depends(get_current_user)):
    return await llm_status(current_user)


@router.get("/active", summary="Get active LLM", description="Get the user's currently active LLM provider and model.")
async def get_active_llm(current_user: User = Depends(get_current_user)):
    user_settings = json.loads(current_user.settings or '{}')
    ai = user_settings.get("ai", {}) or {}
    return {
        "provider": ai.get("active_provider", ""),
        "model": ai.get("active_model", ""),
    }


@router.post("/active", summary="Set active LLM", description="Save the user's active LLM provider and model to settings.")
async def set_active_llm(
    request: ActiveLLMUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        existing = json.loads(current_user.settings or '{}')
    except json.JSONDecodeError:
        existing = {}

    ai = existing.get("ai", {}) or {}
    ai["active_provider"] = request.provider
    ai["active_model"] = request.model
    existing["ai"] = ai

    current_user.settings = json.dumps(existing, ensure_ascii=False)
    db.commit()
    db.refresh(current_user)

    return {"provider": request.provider, "model": request.model}


@router.post("/providers/{provider}/test", summary="Test LLM provider", description="Test connectivity for a single LLM provider.")
async def test_provider_connection(
    provider: str,
    current_user: User = Depends(get_current_user),
):
    try:
        provider_enum = ModelProvider(provider)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    user_settings = json.loads(current_user.settings or '{}')
    result = await llm_service.test_provider(provider_enum, user_settings=user_settings)
    return result


@router.get("/providers/ollama/models", summary="List Ollama models", description="List models available on the user's configured Ollama server.", response_model=OllamaModelsResponse)
async def list_ollama_models(current_user: User = Depends(get_current_user)):
    user_settings = json.loads(current_user.settings or '{}')
    models = await llm_service.list_ollama_models(user_settings=user_settings)
    return {"models": models}


# 混合检索融合权重：combined = 向量分 * HYBRID_VECTOR_WEIGHT + 关键词分 * HYBRID_KEYWORD_WEIGHT
HYBRID_VECTOR_WEIGHT = 0.55
HYBRID_KEYWORD_WEIGHT = 0.45

# 查询改写：检索前用小模型把口语化问题改写成检索查询，失败静默降级为原文。
# 评测结论（qwen2.5:0.5b，50 题）：0.98 -> 0.98 不降分，保留；代价约 +0.5s 延迟。
HYBRID_QUERY_REWRITE_ENABLED = True
HYBRID_QUERY_REWRITE_MODEL = "qwen2.5:0.5b"
HYBRID_QUERY_REWRITE_TIMEOUT = 5.0

# 第二段精排（LLM rerank）：融合排序后取 top_k*4 候选让本地小模型重排，
# 失败/超时/解析失败静默回退到第一轮排序。
# 评测结论（qwen2.5:0.5b，50 题）：0.98 -> 0.54 严重降分且 +1.3s 延迟，默认关闭。
HYBRID_RERANK_ENABLED = False
HYBRID_RERANK_MODEL = "qwen2.5:0.5b"
HYBRID_RERANK_TIMEOUT = 9.0


async def _ollama_quick_call(prompt: str, system: str, model: str, timeout: float) -> Optional[str]:
    """Short call to local Ollama via llm_service; returns None on any failure."""
    async def _collect() -> str:
        chunks = []
        async for chunk in llm_service._chat_ollama(prompt, None, model, system):
            chunks.append(chunk)
        return "".join(chunks)

    try:
        text = await asyncio.wait_for(_collect(), timeout=timeout)
    except Exception:
        return None
    if not text or text.lstrip().startswith("[Error"):
        return None
    return text.strip()


async def _rewrite_query(message: str) -> Optional[str]:
    """Rewrite a colloquial user message into a retrieval query (core concepts /
    keywords). Returns None on failure — caller then uses the original message."""
    return await _ollama_quick_call(
        prompt=(
            f"用户问题：{message}\n\n"
            "请提取这个问题用于知识库检索的核心概念和关键词，"
            "只输出一行检索词（保留原词并可补充同义概念），不要输出任何解释。"
        ),
        system="你是检索查询改写器，只输出检索词。",
        model=HYBRID_QUERY_REWRITE_MODEL,
        timeout=HYBRID_QUERY_REWRITE_TIMEOUT,
    )


async def _rerank_candidates(message: str, candidates: List[tuple]) -> List[tuple]:
    """Second-pass LLM rerank over fused candidates. On any failure returns the
    original first-pass order unchanged."""
    if len(candidates) < 2:
        return candidates
    lines = []
    for i, (_, stype, sid, title, content, _chunk) in enumerate(candidates, 1):
        snippet = (content or "").replace("\n", " ")[:150]
        lines.append(f"{i}. {title} — {snippet}")
    text = await _ollama_quick_call(
        prompt=(
            f"用户问题：{message}\n\n"
            "候选资料：\n" + "\n".join(lines) + "\n\n"
            f"请按与用户问题的相关性从高到低给出序号（1 到 {len(candidates)}），"
            "只输出用逗号分隔的数字，不要输出任何解释。"
        ),
        system="你是检索结果排序器，只输出序号。",
        model=HYBRID_RERANK_MODEL,
        timeout=HYBRID_RERANK_TIMEOUT,
    )
    if not text:
        return candidates
    import re
    order = []
    for tok in re.findall(r"\d+", text):
        idx = int(tok)
        if 1 <= idx <= len(candidates) and idx not in order:
            order.append(idx)
    if not order:
        return candidates
    # 模型没提到的候选按原顺序排在后面
    rest = [i for i in range(1, len(candidates) + 1) if i not in order]
    return [candidates[i - 1] for i in order + rest]


async def _retrieve_knowledge_sources(
    db: Session,
    user_id: str,
    message: str,
    brain_side: str = "both",
    top_k: int = 5,
) -> List[dict]:
    """Hybrid retrieval over the user's notes, clips and knowledge units.

    Pipeline: optional query rewrite (small local model rephrases the message
    into retrieval terms, appended to the original) -> two fused channels
    (keyword n-gram scoring + vector cosine over stored embeddings) ->
    optional second-pass LLM rerank over the top_k*4 fused candidates.

    Each channel's scores are normalised (keyword scores by the channel max,
    vector scores are cosine values clamped at 0) and combined as
    ``HYBRID_VECTOR_WEIGHT * vector + HYBRID_KEYWORD_WEIGHT * keyword``;
    a document hit by both channels gets both contributions.

    Graceful degradation: query-rewrite / embedding / rerank failures (or the
    embedding mock fallback when Ollama is down) silently skip that stage —
    the worst case is pure keyword ranking of the original message.

    Returns list of dicts with id, title, preview, source_type, content_raw.
    """
    from sqlalchemy import or_
    from app.models.base import Note, BrowserClip

    # 查询理解：把口语化 message 改写成检索查询。原文保留在最前，改写文本追加在后，
    # 因此原 message 的 n-gram 关键词全部保留，改写产生的关键词追加参与打分；
    # 检索文本（关键词 + 向量 embed 输入）同时使用两者。失败时静默用原 message。
    search_text = message
    if HYBRID_QUERY_REWRITE_ENABLED:
        rewritten = await _rewrite_query(message)
        if rewritten:
            search_text = f"{message} {rewritten}"

    # Extract short keywords / 2-grams from the message.
    # For Chinese we use 2-grams because whole phrases rarely match verbatim.
    # Drop common stopwords so questions like "怎么做" don't flood results.
    import re
    STOPWORDS = {
        "怎么", "什么", "为什么", "如何", "多少", "哪里", "哪些", "是不是",
        "有没有", "可以", "应该", "需要", "这样", "那样",
    }
    keywords = []
    for token in re.findall(r"[\u4e00-\u9fa5]+", search_text):
        # Use 2-grams, 3-grams and 4-grams so multi-char concepts like "500 条" are captured.
        for n in (2, 3, 4):
            for i in range(len(token) - n + 1):
                gram = token[i:i + n]
                if not any(g in STOPWORDS for g in (gram[:2], gram[1:3]) if len(g) == 2):
                    keywords.append(gram)
    for token in re.findall(r"[a-zA-Z0-9]{2,}", search_text):
        keywords.append(token.lower())
    # Deduplicate while preserving order.
    seen = set()
    keywords = [k for k in keywords if not (k in seen or seen.add(k))]
    if not keywords:
        keywords = [message.strip()[:10]]
    # SQL 预过滤关键词：中文 n-gram 靠前截取 + 全部 ASCII 词。
    # 混合语言问题（如「PARA 方法是按什么标准组织信息的」）里，英文标题的文档
    # 不含任何中文 gram，只用前 6 个中文 gram 做 ILIKE 预过滤时候选都进不来。
    ascii_kws = [k for k in keywords if k.isascii()]
    kws = (ascii_kws + keywords)[:8]

    def _score(title: str, content: str) -> int:
        t = (title or "").lower()
        c = (content or "").lower()
        return sum(3 for kw in keywords if kw.lower() in t) + \
               sum(1 for kw in keywords if kw.lower() in c)

    def _snippet(content: str) -> str:
        raw = (content or "").replace("\n", " ")
        lower_raw = raw.lower()
        for kw in keywords:
            pos = lower_raw.find(kw.lower())
            if pos != -1:
                start = max(0, pos - 80)
                end = min(len(raw), pos + 280)
                snip = raw[start:end]
                if start > 0:
                    snip = "..." + snip
                if end < len(raw):
                    snip = snip + "..."
                if len(snip) > 400:
                    snip = snip[:397] + "..."
                return snip
        return raw[:400]

    # 候选文档：key 为 (kind, id)，kind ∈ {knowledge, note, clip}
    docs: dict = {}

    # 1) 知识单元（debunked 证伪单元不进检索；disputed 在融合阶段降权）
    q = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == user_id,
        KnowledgeUnit.verification_status != "debunked",
    )
    if brain_side != "both":
        q = q.filter(KnowledgeUnit.brain_side == brain_side)
    ku_filters = []
    for kw in kws:
        escaped_kw = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped_kw}%"
        ku_filters.append(KnowledgeUnit.content_raw.ilike(like, escape="\\"))
        ku_filters.append(KnowledgeUnit.source_title.ilike(like, escape="\\"))
        ku_filters.append(KnowledgeUnit.content_type.ilike(like, escape="\\"))
    if ku_filters:
        q = q.filter(or_(*ku_filters))
    for unit in q.order_by(KnowledgeUnit.invoke_count.desc()).limit(top_k * 5).all():
        content_text = (unit.content_raw or "") + " " + (unit.content_type or "")
        s = _score(unit.source_title or "", content_text)
        if s > 0:
            docs[("knowledge", unit.id)] = {
                "stype": unit.source_type or "knowledge",
                "title": unit.source_title or unit.content_type or "未命名知识",
                "content": unit.content_raw or "",
                "kw": float(s),
                "vec": 0.0,
                "ann": (unit.practice_depth or 0) > 0 or (unit.evolution_stage or "collected") != "collected",
                "vs": unit.verification_status or "unverified",
            }

    # 2) 个人笔记
    qn = db.query(Note).filter(Note.user_id == user_id, Note.status == "active")
    if brain_side != "both":
        qn = qn.filter(Note.brain_side == brain_side)
    note_filters = []
    for kw in kws:
        escaped_kw = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped_kw}%"
        note_filters.append(Note.title.ilike(like, escape="\\"))
        note_filters.append(Note.content.ilike(like, escape="\\"))
    if note_filters:
        qn = qn.filter(or_(*note_filters))
    for note in qn.order_by(Note.updated_at.desc()).limit(top_k * 5).all():
        s = _score(note.title or "", note.content or "")
        if s > 0:
            docs[("note", note.id)] = {
                "stype": "note",
                "title": note.title or "无标题笔记",
                "content": note.content or "",
                "kw": float(s),
                "vec": 0.0,
            }

    # 3) 浏览器剪藏
    qc = db.query(BrowserClip).filter(BrowserClip.user_id == user_id, BrowserClip.status == "active")
    if brain_side != "both":
        qc = qc.filter(BrowserClip.brain_side == brain_side)
    clip_filters = []
    for kw in kws:
        escaped_kw = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped_kw}%"
        clip_filters.append(BrowserClip.title.ilike(like, escape="\\"))
        clip_filters.append(BrowserClip.full_text.ilike(like, escape="\\"))
        clip_filters.append(BrowserClip.excerpt.ilike(like, escape="\\"))
    if clip_filters:
        qc = qc.filter(or_(*clip_filters))
    for clip in qc.order_by(BrowserClip.capture_timestamp.desc()).limit(top_k * 5).all():
        s = _score(clip.title or "", (clip.full_text or "") + " " + (clip.excerpt or ""))
        if s > 0:
            docs[("clip", clip.id)] = {
                "stype": "clip",
                "title": clip.title or clip.url or "未命名剪藏",
                "content": clip.full_text or clip.excerpt or "",
                "kw": float(s),
                "vec": 0.0,
            }

    # ---- 向量通道：embed query + 余弦相似度检索，失败时静默退回纯关键词 ----
    try:
        from app.services.embedding_service import embedding_service
        emb = await embedding_service.embed(search_text)
        query_vector = emb.get("embedding") or []
        # Ollama 不可用时 embed() 返回 mock 假向量，相似度无意义，跳过向量通道
        if query_vector and emb.get("model_used") != "mock/fallback":
            hits = embedding_service.search_similar(
                query_vector, content_type=None, top_k=top_k * 2, user_id=user_id
            )
            from app.services.chunking import CHUNK_ID_SEP

            def _base_id(cid: str) -> str:
                # 块向量的 content_id 形如 "{doc_id}::chunk::{n}"，归属回原文档
                return cid.split(CHUNK_ID_SEP, 1)[0] if cid else cid

            ku_ids = list({_base_id(h["content_id"]) for h in hits if h.get("content_type") == "knowledge"})
            note_ids = list({_base_id(h["content_id"]) for h in hits if h.get("content_type") == "note"})
            clip_ids = list({_base_id(h["content_id"]) for h in hits if h.get("content_type") == "clip"})

            vec_rows = {}
            if ku_ids:
                vq = db.query(KnowledgeUnit).filter(
                    KnowledgeUnit.user_id == user_id, KnowledgeUnit.id.in_(ku_ids),
                    KnowledgeUnit.verification_status != "debunked")
                if brain_side != "both":
                    vq = vq.filter(KnowledgeUnit.brain_side == brain_side)
                for unit in vq.all():
                    vec_rows[("knowledge", unit.id)] = {
                        "stype": unit.source_type or "knowledge",
                        "title": unit.source_title or unit.content_type or "未命名知识",
                        "content": unit.content_raw or "",
                        "ann": (unit.practice_depth or 0) > 0 or (unit.evolution_stage or "collected") != "collected",
                        "vs": unit.verification_status or "unverified",
                    }
            if note_ids:
                vq = db.query(Note).filter(
                    Note.user_id == user_id, Note.status == "active", Note.id.in_(note_ids))
                if brain_side != "both":
                    vq = vq.filter(Note.brain_side == brain_side)
                for note in vq.all():
                    vec_rows[("note", note.id)] = {
                        "stype": "note",
                        "title": note.title or "无标题笔记",
                        "content": note.content or "",
                    }
            if clip_ids:
                vq = db.query(BrowserClip).filter(
                    BrowserClip.user_id == user_id, BrowserClip.status == "active",
                    BrowserClip.id.in_(clip_ids))
                if brain_side != "both":
                    vq = vq.filter(BrowserClip.brain_side == brain_side)
                for clip in vq.all():
                    vec_rows[("clip", clip.id)] = {
                        "stype": "clip",
                        "title": clip.title or clip.url or "未命名剪藏",
                        "content": clip.full_text or clip.excerpt or "",
                    }

            for h in hits:
                cid = h.get("content_id") or ""
                key = (h.get("content_type"), _base_id(cid))
                if key not in vec_rows:
                    continue
                sim = max(0.0, float(h.get("similarity") or 0.0))  # 负余弦截 0
                entry = docs.setdefault(key, {**vec_rows[key], "kw": 0.0, "vec": 0.0, "chunk": None})
                # 同一文档多个块命中取最高余弦分，并记录得分最高块的文本
                if sim > entry["vec"]:
                    entry["vec"] = sim
                    if CHUNK_ID_SEP in cid:
                        entry["chunk"] = h.get("text_preview")
    except Exception:
        pass  # 向量通道任何异常都不影响关键词结果

    # ---- 融合：两路分数各自归一化后按权重加权，同文档两路命中则分数相加 ----
    kw_max = max((d["kw"] for d in docs.values()), default=0.0)
    # 注卡加权：人精修/登记过践行的知识单元（ann）×1.15——「注卡=内化」的检索侧兑现
    # 反证降权：disputed 存疑单元 ×0.7（debunked 已在候选阶段剔除）
    ANNOTATED_BOOST = 1.15
    DISPUTED_PENALTY = 0.7
    ranked: List[tuple] = []
    for (kind, sid), d in docs.items():
        kw_norm = (d["kw"] / kw_max) if kw_max > 0 else 0.0
        combined = HYBRID_VECTOR_WEIGHT * d["vec"] + HYBRID_KEYWORD_WEIGHT * kw_norm
        if d.get("ann"):
            combined *= ANNOTATED_BOOST
        if d.get("vs") == "disputed":
            combined *= DISPUTED_PENALTY
        if combined <= 0:
            continue
        ranked.append((combined, d["stype"], sid, d["title"], d["content"], d.get("chunk")))

    ranked.sort(key=lambda x: x[0], reverse=True)

    # ---- 第二段精排：第一轮融合取 top_k*4 候选，LLM 重排；失败静默用第一轮排序 ----
    if HYBRID_RERANK_ENABLED and len(ranked) > 1:
        candidates = ranked[: top_k * 4]
        try:
            candidates = await _rerank_candidates(message, candidates)
        except Exception:
            pass  # 任何异常都回退到第一轮排序
        ranked = candidates

    results = []
    for _, stype, sid, title, content, chunk in ranked[:top_k]:
        raw = (content or "").replace("\n", " ")
        results.append({
            "id": sid,
            "title": title,
            # 块命中时 preview 用得分最高块的原文，比整篇开头更贴合问题
            "preview": _snippet(chunk) if chunk else _snippet(content),
            "source_type": stype,
            "content_raw": raw[:2000],  # included for eval / prompt context
            "chunk": chunk,  # 命中块原文（无块命中为 None）
        })
    return results


@router.post("/chat", summary="LLM Chat", description="Stream chat response from the routed LLM. Returns SSE stream.")
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_settings = json.loads(current_user.settings or '{}')

    # Retrieve relevant knowledge units as citations / RAG context.
    sources = await _retrieve_knowledge_sources(
        db=db,
        user_id=current_user.id,
        message=request.message,
        brain_side=request.brain_side,
        top_k=5,
    )

    # Build RAG system prompt.
    rag_system_prompt = None
    if sources:
        type_labels = {
            "note": "个人笔记",
            "clip": "网页剪藏",
            "knowledge": "知识卡片",
            "manual": "知识卡片",
        }
        context_blocks = []
        for idx, src in enumerate(sources, 1):
            label = type_labels.get(src.get("source_type"), src.get("source_type") or "资料")
            context_blocks.append(f"[{idx}]（{label}）{src['title']}\n{src['preview']}")
        context_text = "\n\n".join(context_blocks)
        rag_system_prompt = (
            "你是用户的本地知识库助手。回答问题时，请优先基于下面提供的资料内容。"
            "如果资料中没有相关信息，请明确说明。"
            "回答中需要引用资料时，使用 [1], [2] 这样的脚注格式标注来源编号，"
            "并保留来源类型（如：在你的个人笔记《X》中、在你的知识卡片《Y》中）。\n\n"
            f"--- 参考资料 ---\n\n{context_text}\n\n--- 参考资料结束 ---"
        )

    # User-supplied system prompt takes precedence if provided.
    final_system_prompt = request.system_prompt or rag_system_prompt

    async def event_generator():
        yield "data: " + '{"type": "start"}' + "\n\n"
        try:
            async for chunk in llm_service.chat(
                message=request.message,
                history=request.history,
                brain_side=request.brain_side,
                sensitivity=request.sensitivity,
                task_type=request.task_type,
                preferred_model=request.preferred_model,
                system_prompt=final_system_prompt,
                user_settings=user_settings,
            ):
                yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"
        except Exception as e:
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"

        # Send sources at the end so the UI can render citations.
        if sources:
            yield "data: " + json.dumps({"type": "sources", "sources": sources}) + "\n\n"
        yield "data: " + '{"type": "end"}' + "\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
        }
    )


@router.post("/complete", summary="Complete prompt", description="Non-streaming text completion.")
async def complete(
    request: CompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    route = LLMRouterService.route(request.prompt, preferred_model=request.model)
    model_id = route.get("model_name") or route.get("model") or request.model or "ollama-qwen2.5-0.5b"
    try:
        text = await chat_completion(
            prompt=request.prompt,
            task_type=request.task_type,
            system_prompt=request.system_prompt,
            preferred_model=request.model,
        )
    except ValueError:
        logger.exception("LLM completion failed")
        raise HTTPException(status_code=500, detail="处理失败，请查看服务端日志")

    return CompleteResponse(text=text.strip(), model_used=model_id)


@router.post("/summarize", summary="Summarize text", description="Summarize text using the LLM.")
async def summarize(
    request: SummarizeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    length_hint = {
        "short": "100字以内",
        "medium": "200-300字",
        "long": "500字以内",
    }.get(request.length.value, "200-300字")
    prompt = (
        f"请对以下文本进行一段{length_hint}的摘要，保留核心观点和关键信息。"
        f"直接输出摘要内容，不要添加额外解释。\n\n{request.text}"
    )
    route = LLMRouterService.route(prompt, preferred_model=request.model)
    model_id = route.get("model_name") or route.get("model") or request.model or "ollama-qwen2.5-0.5b"
    try:
        summary = await chat_completion(
            prompt=prompt,
            task_type="summarize",
            preferred_model=request.model,
        )
    except ValueError:
        logger.exception("LLM completion failed")
        raise HTTPException(status_code=500, detail="处理失败，请查看服务端日志")

    summary = summary.strip()
    return SummarizeResponse(
        summary=summary,
        original_length=len(request.text),
        summary_length=len(summary),
        compression_ratio=round(len(summary) / max(len(request.text), 1), 4),
        model_used=model_id,
        cached=False,
    )


@router.post("/extract-tags", summary="Extract tags", description="Extract tags and suggest categories from text.")
async def extract_tags(
    request: ExtractTagsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    categories_hint = "并给出每个标签所属的类别" if request.suggest_categories else ""
    prompt = (
        f"请从以下文本中提取最多 {request.max_tags} 个关键词作为标签{categories_hint}。"
        f"直接输出标签，用逗号分隔{'；并在下一行输出类别，用逗号分隔，顺序与标签一致' if request.suggest_categories else ''}。\n\n{request.text}"
    )
    route = LLMRouterService.route(prompt, preferred_model=request.model)
    model_id = route.get("model_name") or route.get("model") or request.model or "ollama-qwen2.5-0.5b"
    try:
        raw = await chat_completion(
            prompt=prompt,
            task_type="tag_extraction",
            preferred_model=request.model,
        )
    except ValueError:
        logger.exception("LLM completion failed")
        raise HTTPException(status_code=500, detail="处理失败，请查看服务端日志")

    lines = [line.strip() for line in raw.strip().split("\n") if line.strip()]
    tags = [t.strip() for t in lines[0].split(",") if t.strip()][: request.max_tags] if lines else []
    categories = None
    if request.suggest_categories:
        categories = [c.strip() for c in lines[1].split(",") if c.strip()][: len(tags)] if len(lines) > 1 else []
    return ExtractTagsResponse(tags=tags, categories=categories, model_used=model_id)


@router.post("/embed", summary="Generate embedding", description="Generate text embedding.")
async def embed(
    request: EmbedRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model_id = request.model or f"ollama-{getattr(settings, 'OLLAMA_EMBED_MODEL', 'nomic-embed-text')}"
    embedding = await llm_service.embed(request.text)

    dimensions = len(embedding)

    # Store if content_id provided
    stored = False
    store_info = None
    if request.content_id:
        store_result = await llm_service.store_embedding(
            text=request.text,
            content_type=request.content_type or "chat",
            content_id=request.content_id,
            user_id=current_user.id,
        )
        stored = store_result.get("success", False)
        store_info = store_result

    return {
        "embedding": embedding,
        "dimensions": dimensions,
        "model_used": model_id,
        "stored": stored,
        **({"store_info": store_info} if store_info is not None else {}),
    }


@router.post("/embed-batch", summary="Batch embedding", description="Generate embeddings for multiple texts.")
async def embed_batch(
    request: EmbedBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model_id = request.model or f"ollama-{getattr(settings, 'OLLAMA_EMBED_MODEL', 'nomic-embed-text')}"
    embeddings = await llm_service.batch_embed(request.texts)

    dimensions = len(embeddings[0]) if embeddings else 0
    return {
        "embeddings": embeddings,
        "count": len(embeddings),
        "dimensions": dimensions,
        "model_used": model_id,
    }


@router.post("/route", summary="Test routing", description="Test the LLM routing strategy without making an actual call.")
async def test_route(request: RouteTestRequest, current_user: User = Depends(get_current_user)):
    intelligent_route = LLMRouterService.route(request.message, preferred_model=None)
    return {
        "intelligent_route": intelligent_route,
        "reasoning": f"Intelligent routing: {intelligent_route.get('model_name', intelligent_route.get('model', 'unknown'))} — reason: {intelligent_route.get('reason', 'unknown')}",
        "token_estimate": LLMRouterService.estimate_tokens(request.message),
    }


@router.post("/route-preview", summary="Route preview", description="Preview routing decision for arbitrary content. Alias for /route.")
async def route_preview(request: RouteTestRequest, current_user: User = Depends(get_current_user)):
    return await test_route(request)


@router.post("/route-test", summary="Test routing", description="Alias for /route. Test the LLM routing strategy without making an actual call.")
async def route_test_alias(request: RouteTestRequest, current_user: User = Depends(get_current_user)):
    route = await test_route(request)
    intelligent_route = route.get("intelligent_route", {})
    return {
        "provider": intelligent_route.get("provider"),
        "model": intelligent_route.get("model_name") or intelligent_route.get("model"),
        "reasoning": route.get("reasoning"),
        "token_estimate": route.get("token_estimate"),
    }


@router.get("/model-info/{model_name}", summary="Model info", description="Get model description and availability status.")
async def model_info(model_name: str, current_user: User = Depends(get_current_user)):
    info = llm_service.get_model_info(model_name)
    return info


@router.get("/models", summary="List models", description="List all available models and their status.")
async def list_models(current_user: User = Depends(get_current_user)):
    from app.services.llm_service import ModelConfig
    models = []
    for model_id, cfg in ModelConfig.MODELS.items():
        status = llm_service.get_model_info(model_id)
        models.append({
            "id": model_id,
            **status,
        })
    return {"models": models}


@router.get("/models/catalog", summary="Model catalog", description="List available local (Ollama) models.")
async def model_catalog(
    current_user: User = Depends(get_current_user_optional),
):
    """Return the catalog of local Ollama models."""
    from app.services.llm_service import ModelConfig
    return {
        "models": [
            {
                "id": model_id,
                "name": cfg["name"],
                "provider": cfg["provider"].value,
                "provider_model_id": cfg["model_id"],
                "description": cfg["description"],
                "is_system": False,
                "supports_streaming": True,
                "context_length": cfg["context_length"],
                "price_input_per_1k": 0.0,
                "price_output_per_1k": 0.0,
                "currency": "CNY",
            }
            for model_id, cfg in ModelConfig.MODELS.items()
        ]
    }
