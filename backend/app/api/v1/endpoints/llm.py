from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.orm import Session
import json

from app.services.llm_service import llm_service, LLMRouterService, ModelProvider
from app.services.llm_billing_service import (
    billed_stream, billed_chat_completion, billed_embed, billed_embed_batch,
    get_balance_summary, ConcurrentModificationError,
)
from app.services.llm_cost_service import LLMCostService
from app.core.security import get_current_user, get_current_user_optional
from app.core.feature_guard import FeatureGuard
from app.models.base import User, KnowledgeUnit
from app.core.database import get_db
from app.schemas.llm import (
    ChatRequest, SummarizeRequest, SummarizeResponse, ExtractTagsRequest, ExtractTagsResponse,
    CompleteRequest, CompleteResponse,
    EmbedRequest, EmbedResponse, EmbedBatchRequest, EmbedBatchResponse,
    RouteTestRequest, RouteTestResponse, ModelInfoResponse, OllamaModelsResponse
)

router = APIRouter()


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


def _retrieve_knowledge_sources(
    db: Session,
    user_id: str,
    message: str,
    brain_side: str = "both",
    top_k: int = 5,
) -> List[dict]:
    """Minimal keyword-based retrieval over the user's notes, clips and knowledge units.

    Returns list of dicts with id, title, preview, source_type.
    For small personal libraries simple LIKE matching is sufficient;
    production should use vector similarity via embedding_service.
    """
    from sqlalchemy import or_
    from app.models.base import Note, BrowserClip

    # Extract short keywords / 2-grams from the message.
    # For Chinese we use 2-grams because whole phrases rarely match verbatim.
    # Drop common stopwords so questions like "怎么做" don't flood results.
    import re
    STOPWORDS = {
        "怎么", "什么", "为什么", "如何", "多少", "哪里", "哪些", "是不是",
        "有没有", "可以", "应该", "需要", "这样", "那样",
    }
    keywords = []
    for token in re.findall(r"[\u4e00-\u9fa5]+", message):
        # Use 2-grams, 3-grams and 4-grams so multi-char concepts like "500 条" are captured.
        for n in (2, 3, 4):
            for i in range(len(token) - n + 1):
                gram = token[i:i + n]
                if not any(g in STOPWORDS for g in (gram[:2], gram[1:3]) if len(g) == 2):
                    keywords.append(gram)
    for token in re.findall(r"[a-zA-Z0-9]{2,}", message):
        keywords.append(token.lower())
    # Deduplicate while preserving order.
    seen = set()
    keywords = [k for k in keywords if not (k in seen or seen.add(k))]
    if not keywords:
        keywords = [message.strip()[:10]]
    kws = keywords[:6]

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

    # (score, source_type, id, title, content)
    scored: List[tuple] = []

    # 1) 知识单元
    q = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id)
    if brain_side != "both":
        q = q.filter(KnowledgeUnit.brain_side == brain_side)
    ku_filters = []
    for kw in kws:
        like = f"%{kw}%"
        ku_filters.append(KnowledgeUnit.content_raw.ilike(like))
        ku_filters.append(KnowledgeUnit.source_title.ilike(like))
        ku_filters.append(KnowledgeUnit.content_type.ilike(like))
    if ku_filters:
        q = q.filter(or_(*ku_filters))
    for unit in q.order_by(KnowledgeUnit.invoke_count.desc()).limit(top_k * 5).all():
        content_text = (unit.content_raw or "") + " " + (unit.content_type or "")
        s = _score(unit.source_title or "", content_text)
        if s > 0:
            scored.append((s, unit.source_type or "knowledge", unit.id,
                           unit.source_title or unit.content_type or "未命名知识",
                           unit.content_raw or ""))

    # 2) 个人笔记
    qn = db.query(Note).filter(Note.user_id == user_id, Note.status == "active")
    if brain_side != "both":
        qn = qn.filter(Note.brain_side == brain_side)
    note_filters = []
    for kw in kws:
        like = f"%{kw}%"
        note_filters.append(Note.title.ilike(like))
        note_filters.append(Note.content.ilike(like))
    if note_filters:
        qn = qn.filter(or_(*note_filters))
    for note in qn.order_by(Note.updated_at.desc()).limit(top_k * 5).all():
        s = _score(note.title or "", note.content or "")
        if s > 0:
            scored.append((s, "note", note.id, note.title or "无标题笔记", note.content or ""))

    # 3) 浏览器剪藏
    qc = db.query(BrowserClip).filter(BrowserClip.user_id == user_id, BrowserClip.status == "active")
    if brain_side != "both":
        qc = qc.filter(BrowserClip.brain_side == brain_side)
    clip_filters = []
    for kw in kws:
        like = f"%{kw}%"
        clip_filters.append(BrowserClip.title.ilike(like))
        clip_filters.append(BrowserClip.full_text.ilike(like))
        clip_filters.append(BrowserClip.excerpt.ilike(like))
    if clip_filters:
        qc = qc.filter(or_(*clip_filters))
    for clip in qc.order_by(BrowserClip.capture_timestamp.desc()).limit(top_k * 5).all():
        s = _score(clip.title or "", (clip.full_text or "") + " " + (clip.excerpt or ""))
        if s > 0:
            scored.append((s, "clip", clip.id,
                           clip.title or clip.url or "未命名剪藏",
                           clip.full_text or clip.excerpt or ""))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for _, stype, sid, title, content in scored[:top_k]:
        raw = (content or "").replace("\n", " ")
        results.append({
            "id": sid,
            "title": title,
            "preview": _snippet(content),
            "source_type": stype,
            "content_raw": raw[:2000],  # included for eval / prompt context
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
    sources = _retrieve_knowledge_sources(
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

    route = llm_service.resolve_route(
        message=request.message,
        history=request.history,
        preferred_model=request.preferred_model,
        user_settings=user_settings,
    )
    model_id = route.get("model_name") or route.get("model_id") or request.preferred_model or "ollama-qwen2.5-0.5b"

    # 桌面端：外部模型（非 ollama）需云端存储会员
    from app.core.desktop_gate import require_external_models_member
    from app.models.llm_billing import LLMModel as _LLMModel
    _model_row = db.query(_LLMModel).filter(_LLMModel.id == model_id).first()
    _provider = (_model_row.provider if _model_row else None) or route.get("provider") or (
        model_id.split("-", 1)[0] if model_id else "ollama"
    )
    await require_external_models_member(str(_provider))

    input_messages = []
    if final_system_prompt:
        input_messages.append({"role": "system", "content": final_system_prompt})
    if request.history:
        input_messages.extend(request.history)
    input_messages.append({"role": "user", "content": request.message})

    async def event_generator():
        yield "data: " + '{"type": "start"}' + "\n\n"
        try:
            async with billed_stream(
                db=db,
                user_id=current_user.id,
                model_id=model_id,
                task_type=request.task_type or "chat",
                input_messages=input_messages,
            ) as streamer:
                async for chunk in streamer.wrap(
                    llm_service.chat(
                        message=request.message,
                        history=request.history,
                        brain_side=request.brain_side,
                        sensitivity=request.sensitivity,
                        task_type=request.task_type,
                        preferred_model=request.preferred_model,
                        system_prompt=final_system_prompt,
                        user_settings=user_settings,
                        db=db,
                    )
                ):
                    yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"
        except ValueError as e:
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
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


@router.post("/complete", summary="Complete prompt", description="Non-streaming text completion with billing.")
async def complete(
    request: CompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    route = LLMRouterService.route(request.prompt, preferred_model=request.model)
    model_id = route.get("model_name") or route.get("model") or request.model or "ollama-qwen2.5-0.5b"
    try:
        text = await billed_chat_completion(
            db=db,
            user_id=current_user.id,
            model_id=model_id,
            task_type=request.task_type,
            prompt=request.prompt,
            system_prompt=request.system_prompt,
        )
    except ConcurrentModificationError as e:
        raise HTTPException(status_code=409, detail="余额被并发修改，请重试")
    except ValueError as e:
        if "余额不足" in str(e):
            raise HTTPException(status_code=402, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    return CompleteResponse(text=text.strip(), model_used=model_id)


@router.post("/summarize", summary="Summarize text", description="Summarize text using the LLM with billing.")
async def summarize(
    request: SummarizeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    FeatureGuard(db, current_user).require_feature("ai_summary")

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
        summary = await billed_chat_completion(
            db=db,
            user_id=current_user.id,
            model_id=model_id,
            task_type="summarize",
            prompt=prompt,
        )
    except ConcurrentModificationError as e:
        raise HTTPException(status_code=409, detail="余额被并发修改，请重试")
    except ValueError as e:
        if "余额不足" in str(e):
            raise HTTPException(status_code=402, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    summary = summary.strip()
    return SummarizeResponse(
        summary=summary,
        original_length=len(request.text),
        summary_length=len(summary),
        compression_ratio=round(len(summary) / max(len(request.text), 1), 4),
        model_used=model_id,
        cached=False,
    )


@router.post("/extract-tags", summary="Extract tags", description="Extract tags and suggest categories from text with billing.")
async def extract_tags(
    request: ExtractTagsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    FeatureGuard(db, current_user).require_feature("ai_summary")

    categories_hint = "并给出每个标签所属的类别" if request.suggest_categories else ""
    prompt = (
        f"请从以下文本中提取最多 {request.max_tags} 个关键词作为标签{categories_hint}。"
        f"直接输出标签，用逗号分隔{'；并在下一行输出类别，用逗号分隔，顺序与标签一致' if request.suggest_categories else ''}。\n\n{request.text}"
    )
    route = LLMRouterService.route(prompt, preferred_model=request.model)
    model_id = route.get("model_name") or route.get("model") or request.model or "ollama-qwen2.5-0.5b"
    try:
        raw = await billed_chat_completion(
            db=db,
            user_id=current_user.id,
            model_id=model_id,
            task_type="tag_extraction",
            prompt=prompt,
        )
    except ConcurrentModificationError as e:
        raise HTTPException(status_code=409, detail="余额被并发修改，请重试")
    except ValueError as e:
        if "余额不足" in str(e):
            raise HTTPException(status_code=402, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    lines = [line.strip() for line in raw.strip().split("\n") if line.strip()]
    tags = [t.strip() for t in lines[0].split(",") if t.strip()][: request.max_tags] if lines else []
    categories = None
    if request.suggest_categories:
        categories = [c.strip() for c in lines[1].split(",") if c.strip()][: len(tags)] if len(lines) > 1 else []
    return ExtractTagsResponse(tags=tags, categories=categories, model_used=model_id)


@router.post("/embed", summary="Generate embedding", description="Generate text embedding with per-token billing.")
async def embed(
    request: EmbedRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model_id = request.model or "ollama-qwen2.5-0.5b"
    try:
        embedding = await billed_embed(
            db=db,
            user_id=current_user.id,
            model_id=model_id,
            text=request.text,
        )
    except ConcurrentModificationError as e:
        raise HTTPException(status_code=409, detail="余额被并发修改，请重试")
    except ValueError as e:
        if "余额不足" in str(e):
            raise HTTPException(status_code=402, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

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


@router.post("/embed-batch", summary="Batch embedding", description="Generate embeddings for multiple texts with billing.")
async def embed_batch(
    request: EmbedBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model_id = request.model or "ollama-qwen2.5-0.5b"
    try:
        embeddings = await billed_embed_batch(
            db=db,
            user_id=current_user.id,
            model_id=model_id,
            texts=request.texts,
        )
    except ConcurrentModificationError as e:
        raise HTTPException(status_code=409, detail="余额被并发修改，请重试")
    except ValueError as e:
        if "余额不足" in str(e):
            raise HTTPException(status_code=402, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

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


@router.get("/models/catalog", summary="Model catalog", description="List active LLM models from the billing catalog with pricing.")
async def model_catalog(
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Return the active model catalog managed by admins."""
    from app.core.config_loader import get_system_config
    cost_svc = LLMCostService(db)
    models = cost_svc.get_active_models()
    # 平台计费开关关闭时（开源/自托管默认），不展示平台计价模型，只留本地/BYOK
    if not get_system_config(db).is_feature_enabled("platform_billing_enabled", default=False):
        models = [m for m in models if not m.is_system]
    return {
        "models": [
            {
                "id": m.id,
                "name": m.name,
                "provider": m.provider,
                "provider_model_id": m.provider_model_id,
                "description": m.description,
                "is_system": m.is_system,
                "supports_streaming": m.supports_streaming,
                "context_length": m.context_length,
                "price_input_per_1k": float(m.price_input_per_1k or 0),
                "price_output_per_1k": float(m.price_output_per_1k or 0),
                "currency": m.currency,
            }
            for m in models
        ]
    }
