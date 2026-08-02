from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
import uuid
import json
import re

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import (
    User, EmergenceResult, EmergenceIdea, EmergenceCanvas,
    Note, Capsule, BrowserClip, KnowledgeUnit,
    RssEntry, EmailMessage, SocialMessage,
    ReadLaterItem, Document, Tag,
)
from app.services.llm_service import LLMRouterService, chat_completion
from app.schemas.emergence import (
    AssociateRequest,
    CollisionRequest,
    HybridRequest,
    CounterfactualRequest,
    EmergenceSourceItem,
    EmergenceSourceList,
    EmergenceHistoryResponse,
    EmergenceResultItem,
    SaveIdeaRequest,
    EmergenceIdeaItem,
    EmergenceIdeaListResponse,
    PromoteIdeaRequest,
    CanvasCreateRequest,
    CanvasUpdateRequest,
    CanvasItem,
    CanvasDetail,
    CanvasListResponse,
    CanvasCombineRequest,
    CanvasReportRequest,
    CanvasReportResponse,
    CanvasToNoteRequest,
)

router = APIRouter()


# ─────────────────────────── Source typing helpers ───────────────────────────

SOURCE_TYPE_CONFIG: Dict[str, Dict[str, Any]] = {
    "note": {
        "model": Note,
        "title_attr": "title",
        "content_attr": "content",
        "default_brain_side": "personal",
    },
    "capsule": {
        "model": Capsule,
        "title_attr": "content_body",
        "content_attr": "content_body",
        "default_brain_side": "personal",
    },
    "clip": {
        "model": BrowserClip,
        "title_attr": "title",
        "content_attr": "excerpt",
        "default_brain_side": "network",
    },
    "knowledge": {
        "model": KnowledgeUnit,
        "title_attr": "content_raw",
        "content_attr": "content_raw",
        "default_brain_side": "network",
    },
    "rss_entry": {
        "model": RssEntry,
        "title_attr": "title",
        "content_attr": "content",
        "default_brain_side": "network",
    },
    "email": {
        "model": EmailMessage,
        "title_attr": "subject",
        "content_attr": "body_text",
        "default_brain_side": "network",
    },
    "social": {
        "model": SocialMessage,
        "title_attr": "conversation_name",
        "content_attr": "content_text",
        "default_brain_side": "network",
    },
    "read_later": {
        "model": ReadLaterItem,
        "title_attr": "title",
        "content_attr": "excerpt",
        "default_brain_side": "network",
    },
    "document": {
        "model": Document,
        "title_attr": "title",
        "content_attr": "content_text",
        "default_brain_side": "personal",
    },
    "tag": {
        "model": Tag,
        "title_attr": "name",
        "content_attr": "description",
        "default_brain_side": "both",
    },
}


def _resolve_source_brain_side(source_type: str, record: Any) -> str:
    """Return brain_side for a source record, with sensible fallbacks."""
    side = getattr(record, "brain_side", None)
    if side:
        return side
    return SOURCE_TYPE_CONFIG.get(source_type, {}).get("default_brain_side", "both")


def _build_source_context(
    db: Session,
    user_id: str,
    source_ids: Optional[List[str]],
    source_types: Optional[List[str]],
) -> str:
    """Fetch selected source contents and format them for LLM prompts."""
    if not source_ids:
        return ""

    # Normalize source_types length to match source_ids
    types = source_types or []
    types = (types + [None] * len(source_ids))[: len(source_ids)]

    snippets: List[str] = []
    for idx, source_id in enumerate(source_ids):
        source_type = types[idx]
        record = None
        found_type = source_type

        if source_type and source_type in SOURCE_TYPE_CONFIG:
            cfg = SOURCE_TYPE_CONFIG[source_type]
            record = db.query(cfg["model"]).filter(
                cfg["model"].id == source_id,
                cfg["model"].user_id == user_id,
            ).first()

        if not record:
            # Fallback: scan all candidate tables
            for stype, cfg in SOURCE_TYPE_CONFIG.items():
                rec = db.query(cfg["model"]).filter(
                    cfg["model"].id == source_id,
                    cfg["model"].user_id == user_id,
                ).first()
                if rec:
                    record = rec
                    found_type = stype
                    break

        if not record:
            continue

        cfg = SOURCE_TYPE_CONFIG.get(found_type, {})
        title = getattr(record, cfg.get("title_attr", "id"), source_id) or ""
        content = getattr(record, cfg.get("content_attr", "id"), "") or ""
        side = _resolve_source_brain_side(found_type or "", record)
        snippets.append(
            f"[来源 {idx + 1}] 类型:{found_type} 脑侧:{side}\n标题:{str(title)[:120]}\n内容:{str(content)[:800]}"
        )

    if not snippets:
        return ""
    return "\n\n---\n\n".join(["【参考素材】"] + snippets)


# ─────────────────────────── LLM helpers ───────────────────────────

async def _call_llm_text(
    prompt: str,
    *,
    db: Session,
    user_id: str,
    task_type: str = "creative",
    brain_side: str = "both",
    preferred_model: Optional[str] = None,
) -> str:
    """Call LLM chat through the non-streaming completion helper."""
    return await chat_completion(
        prompt=prompt,
        task_type=task_type,
        system_prompt="You are a creative cross-domain thinking assistant. Answer in the format requested by the user.",
        preferred_model=preferred_model,
    )


async def _call_llm_json(
    prompt: str,
    *,
    db: Session,
    user_id: str,
    task_type: str = "creative",
    brain_side: str = "both",
    preferred_model: Optional[str] = None,
) -> Dict[str, Any]:
    """Call the LLM and parse a strict JSON object response.

    Provider failures become 503; unparseable output is retried once and then
    surfaced as 502 instead of being replaced by fake template data.
    """
    for _attempt in range(2):
        try:
            text = await _call_llm_text(
                prompt,
                db=db,
                user_id=user_id,
                task_type=task_type,
                brain_side=brain_side,
                preferred_model=preferred_model,
            )
        except ValueError:
            logging.getLogger(__name__).exception("LLM call failed")
            raise HTTPException(status_code=500, detail="处理失败，请查看服务端日志")
        except HTTPException:
            raise
        except Exception:
            logging.getLogger(__name__).exception("LLM provider unavailable")
            raise HTTPException(status_code=503, detail="AI 服务暂时不可用，请稍后重试")

        try:
            cleaned = (text or "").strip()
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"```\s*$", "", cleaned.strip())
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                cleaned = match.group(0)
            data = json.loads(cleaned)
            if not isinstance(data, dict):
                raise ValueError("LLM output is not a JSON object")
            return data
        except Exception:
            continue  # retry once, then give up below

    raise HTTPException(status_code=502, detail="AI 返回了无效结果，请重试")


def _save_result(
    db: Session,
    user_id: str,
    result_type: str,
    input_data: Dict[str, Any],
    output_data: Dict[str, Any],
    brain_side: str = "both",
    source_ids: Optional[List[str]] = None,
    source_types: Optional[List[str]] = None,
    model_used: Optional[str] = None,
    scores: Optional[Dict[str, Any]] = None,
) -> EmergenceResult:
    record = EmergenceResult(
        id=str(uuid.uuid4()),
        user_id=user_id,
        type=result_type,
        brain_side=brain_side,
        source_ids=json.dumps(source_ids or [], ensure_ascii=False),
        source_types=json.dumps(source_types or [], ensure_ascii=False),
        model_used=model_used,
        input_data=json.dumps(input_data, ensure_ascii=False),
        output_data=json.dumps(output_data, ensure_ascii=False),
        scores=json.dumps(scores, ensure_ascii=False) if scores else None,
        created_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _brain_side_from_request(request: Any) -> str:
    side = getattr(request, "brain_side", None) or "both"
    if side not in ("personal", "network", "both"):
        side = "both"
    return side


# ─────────────────────────── 素材池 ───────────────────────────

@router.get("/sources", summary="涌现素材池", response_model=EmergenceSourceList)
async def emergence_sources(
    brain_side: Optional[str] = Query(None, description="personal / network / both"),
    type_filter: Optional[str] = Query(None, description="Comma-separated source types"),
    q: Optional[str] = Query(None, description="Search keyword"),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return candidate source contents for emergence tools."""
    items: List[EmergenceSourceItem] = []
    allowed_types = type_filter.split(",") if type_filter else list(SOURCE_TYPE_CONFIG.keys())
    allowed_types = [t.strip() for t in allowed_types if t.strip() in SOURCE_TYPE_CONFIG]

    for source_type in allowed_types:
        cfg = SOURCE_TYPE_CONFIG[source_type]
        model = cfg["model"]
        title_attr = cfg["title_attr"]
        content_attr = cfg["content_attr"]

        query = db.query(model).filter(model.user_id == current_user.id)

        # status / active filters
        if hasattr(model, "status"):
            query = query.filter(model.status.in_(["active", "unread", "read", "reading"]))
        if hasattr(model, "item_status"):
            query = query.filter(model.item_status == "active")
        if hasattr(model, "doc_status"):
            query = query.filter(model.doc_status == "active")

        records = query.all()

        for rec in records:
            side = _resolve_source_brain_side(source_type, rec)
            if brain_side and brain_side != "both" and side != brain_side and side != "both":
                continue

            title = getattr(rec, title_attr, "") or ""
            content = getattr(rec, content_attr, "") or ""
            excerpt = (content[:300] + "...") if len(content) > 300 else content

            if q and q.lower() not in (str(title) + " " + str(content)).lower():
                continue

            items.append(
                EmergenceSourceItem(
                    id=rec.id,
                    type=source_type,
                    title=str(title)[:200],
                    excerpt=excerpt,
                    brain_side=side,
                    created_at=getattr(rec, "created_at", None),
                )
            )

    items.sort(key=lambda x: x.created_at or datetime.min, reverse=True)
    return EmergenceSourceList(items=items[:limit], total=len(items))


# ─────────────────────────── 跨域联想 ───────────────────────────

@router.post("/associate", summary="跨域联想")
async def emergence_associate(
    req: AssociateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brain_side = _brain_side_from_request(req)
    source_context = _build_source_context(
        db, current_user.id, req.source_ids, req.source_types
    )
    prompt = (
        f"你是一位创新思维专家。请对'{req.topic_a}'和'{req.topic_b}'进行跨域联想。\n"
        f"脑侧设定：{brain_side}（personal=偏重个人经验，network=偏重外部事实，both=兼顾双脑）。\n"
    )
    if source_context:
        prompt += f"\n{source_context}\n\n请优先结合上述素材进行联想。\n"
    prompt += (
        "返回严格的JSON格式，包含：\n"
        "- concept（联想概念，一句话）\n"
        "- path（联想路径，A→中间概念→B，列表）\n"
        "- applications（应用场景，3个）\n"
        "- innovation_score（创新度1-10）\n"
        "- feasibility_score（可行性1-10）\n\n"
        "返回格式：\n"
        '{"concept":"...","path":["A","中间","B"],"applications":["..."],"innovation_score":7,"feasibility_score":6}'
    )
    output_data = await _call_llm_json(
        prompt,
        db=db,
        user_id=current_user.id,
        task_type="creative",
        brain_side=brain_side,
        preferred_model=req.preferred_model,
    )

    scores = {
        "innovation_score": output_data.get("innovation_score", 7),
        "feasibility_score": output_data.get("feasibility_score", 6),
    }
    record = _save_result(
        db,
        current_user.id,
        "associate",
        {"topic_a": req.topic_a, "topic_b": req.topic_b},
        output_data,
        brain_side=brain_side,
        source_ids=req.source_ids,
        source_types=req.source_types,
        model_used=req.preferred_model,
        scores=scores,
    )
    return {
        "id": record.id,
        **output_data,
        "scores": scores,
        "brain_side": record.brain_side,
        "source_ids": req.source_ids or [],
        "created_at": record.created_at.isoformat(),
    }


# ─────────────────────────── 创意碰撞 ───────────────────────────

@router.post("/collision", summary="创意碰撞")
async def emergence_collision(
    req: CollisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brain_side = _brain_side_from_request(req)
    perspectives = req.perspectives or ["法律", "伦理", "经济", "技术"]
    source_context = _build_source_context(
        db, current_user.id, req.source_ids, req.source_types
    )
    prompt = (
        f"你是一位跨领域辩论专家。请对话题'{req.topic}'进行多视角观点碰撞。\n"
        f"脑侧设定：{brain_side}。\n"
        f"视角：{', '.join(perspectives)}\n"
    )
    if source_context:
        prompt += f"\n{source_context}\n\n请基于上述素材进行碰撞。\n"
    prompt += (
        "返回严格的JSON格式，包含：\n"
        "- perspectives（各视角观点，每个包含role, stance, argument, counter）\n"
        "- dialogue（模拟辩论对话，3轮，每轮包含speaker和content）\n"
        "- consensus（共识点列表）\n"
        "- divergence（分歧点列表）\n\n"
        "返回格式示例：\n"
        '{"perspectives":[{"role":"法律","stance":"支持","argument":"...","counter":"..."}],'
        '"dialogue":[{"speaker":"法律专家","content":"..."}],'
        '"consensus":["..."],"divergence":["..."]}'
    )
    output_data = await _call_llm_json(
        prompt,
        db=db,
        user_id=current_user.id,
        task_type="creative",
        brain_side=brain_side,
        preferred_model=req.preferred_model,
    )

    record = _save_result(
        db,
        current_user.id,
        "collision",
        {"topic": req.topic, "perspectives": perspectives},
        output_data,
        brain_side=brain_side,
        source_ids=req.source_ids,
        source_types=req.source_types,
        model_used=req.preferred_model,
    )
    return {
        "id": record.id,
        **output_data,
        "brain_side": record.brain_side,
        "source_ids": req.source_ids or [],
        "created_at": record.created_at.isoformat(),
    }


# ─────────────────────────── 概念杂交 ───────────────────────────

@router.post("/hybrid", summary="概念杂交")
async def emergence_hybrid(
    req: HybridRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brain_side = _brain_side_from_request(req)
    source_context = _build_source_context(
        db, current_user.id, req.source_ids, req.source_types
    )
    prompt = (
        f"你是一位概念创新专家。请将'{req.concept_a}'和'{req.concept_b}'融合，生成一个新概念。\n"
        f"脑侧设定：{brain_side}。\n"
    )
    if source_context:
        prompt += f"\n{source_context}\n\n请结合上述素材进行概念融合。\n"
    prompt += (
        "返回严格的JSON格式，包含：\n"
        "- name（新概念名称）\n"
        "- definition（定义）\n"
        "- features（核心特征，5条）\n"
        "- applications（应用场景，3个）\n"
        "- risks（潜在风险，2-3个）\n"
        "- maturity_score（成熟度1-10）\n\n"
        "返回格式：\n"
        '{"name":"...","definition":"...","features":["..."],"applications":["..."],"risks":["..."],"maturity_score":5}'
    )
    output_data = await _call_llm_json(
        prompt,
        db=db,
        user_id=current_user.id,
        task_type="creative",
        brain_side=brain_side,
        preferred_model=req.preferred_model,
    )

    scores = {"maturity_score": output_data.get("maturity_score", 5)}
    record = _save_result(
        db,
        current_user.id,
        "hybrid",
        {"concept_a": req.concept_a, "concept_b": req.concept_b},
        output_data,
        brain_side=brain_side,
        source_ids=req.source_ids,
        source_types=req.source_types,
        model_used=req.preferred_model,
        scores=scores,
    )
    return {
        "id": record.id,
        **output_data,
        "scores": scores,
        "brain_side": record.brain_side,
        "source_ids": req.source_ids or [],
        "created_at": record.created_at.isoformat(),
    }


# ─────────────────────────── 反事实探索 ───────────────────────────

@router.post("/counterfactual", summary="反事实探索")
async def emergence_counterfactual(
    req: CounterfactualRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brain_side = _brain_side_from_request(req)
    depth = max(1, min(5, req.timeline_depth))
    source_context = _build_source_context(
        db, current_user.id, req.source_ids, req.source_types
    )
    prompt = (
        f"你是一位历史推演和系统思维专家。请对假设'{req.premise}'进行反事实推演。\n"
        f"脑侧设定：{brain_side}。\n"
        f"时间线深度：{depth}层（每层代表一个连锁反应阶段）\n"
    )
    if source_context:
        prompt += f"\n{source_context}\n\n请结合上述素材进行推演。\n"
    prompt += (
        "返回严格的JSON格式，包含：\n"
        "- branches（时间线分支列表，每个分支包含stage, key_nodes, impact_scope, probability, reality_comparison）\n"
        "- branches中每个元素：stage（阶段名）, key_nodes（关键节点列表，每个包含time, event, consequence）, impact_scope（影响范围）, probability（概率评估0-1）, reality_comparison（与现实对比）\n\n"
        "返回格式示例：\n"
        '{"branches":[{"stage":"初始变化","key_nodes":[{"time":"T+0","event":"...","consequence":"..."}],"impact_scope":"...","probability":0.8,"reality_comparison":"..."}]}'
    )
    output_data = await _call_llm_json(
        prompt,
        db=db,
        user_id=current_user.id,
        task_type="creative",
        brain_side=brain_side,
        preferred_model=req.preferred_model,
    )

    record = _save_result(
        db,
        current_user.id,
        "counterfactual",
        {"premise": req.premise, "timeline_depth": depth},
        output_data,
        brain_side=brain_side,
        source_ids=req.source_ids,
        source_types=req.source_types,
        model_used=req.preferred_model,
    )
    return {
        "id": record.id,
        **output_data,
        "brain_side": record.brain_side,
        "source_ids": req.source_ids or [],
        "created_at": record.created_at.isoformat(),
    }


# ─────────────────────────── 历史记录 ───────────────────────────

@router.get("/history", summary="涌现历史记录", response_model=EmergenceHistoryResponse)
async def emergence_history(
    type_filter: Optional[str] = Query(None, description="按类型筛选：associate, collision, hybrid, counterfactual"),
    brain_side: Optional[str] = Query(None, description="personal / network / both"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(EmergenceResult).filter(
        EmergenceResult.user_id == current_user.id
    )
    if type_filter:
        query = query.filter(EmergenceResult.type == type_filter)
    if brain_side:
        query = query.filter(EmergenceResult.brain_side == brain_side)
    query = query.order_by(EmergenceResult.created_at.desc())
    total = query.count()
    records = query.offset(skip).limit(limit).all()

    items = []
    for r in records:
        try:
            input_data = json.loads(r.input_data)
        except Exception:
            input_data = {}
        try:
            output_data = json.loads(r.output_data)
        except Exception:
            output_data = {}
        items.append(
            EmergenceResultItem(
                id=r.id,
                type=r.type,
                brain_side=r.brain_side,
                source_ids=json.loads(r.source_ids) if r.source_ids else [],
                source_types=json.loads(r.source_types) if r.source_types else [],
                model_used=r.model_used,
                input=input_data,
                output=output_data,
                scores=json.loads(r.scores) if r.scores else None,
                created_at=r.created_at,
            )
        )

    return {"items": items, "total": total, "skip": skip, "limit": limit}


# ─────────────────────────── 成果库（Emergence Idea） ───────────────────────────

def _compute_idea_brain_side(db: Session, user_id: str, source_result_ids: List[str]) -> str:
    if not source_result_ids:
        return "both"
    results = db.query(EmergenceResult).filter(
        EmergenceResult.id.in_(source_result_ids),
        EmergenceResult.user_id == user_id,
    ).all()
    sides = {r.brain_side for r in results}
    if sides == {"personal"}:
        return "personal"
    if sides == {"network"}:
        return "network"
    return "both"


@router.post("/save-idea", summary="保存涌现成果", response_model=EmergenceIdeaItem)
async def save_emergence_idea(
    req: SaveIdeaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brain_side = _compute_idea_brain_side(db, current_user.id, req.source_result_ids)
    idea = EmergenceIdea(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=req.title,
        summary=req.summary,
        brain_side=brain_side,
        source_result_ids=json.dumps(req.source_result_ids, ensure_ascii=False),
        tags=json.dumps(req.tags or [], ensure_ascii=False),
        status=req.status or "draft",
    )
    db.add(idea)
    db.commit()
    db.refresh(idea)
    return EmergenceIdeaItem(
        id=idea.id,
        title=idea.title,
        summary=idea.summary,
        brain_side=idea.brain_side,
        source_result_ids=json.loads(idea.source_result_ids),
        tags=json.loads(idea.tags),
        status=idea.status,
        target_type=idea.target_type,
        target_id=idea.target_id,
        created_at=idea.created_at,
        updated_at=idea.updated_at,
    )


@router.get("/ideas", summary="涌现成果库", response_model=EmergenceIdeaListResponse)
async def list_emergence_ideas(
    status: Optional[str] = Query(None),
    brain_side: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(EmergenceIdea).filter(EmergenceIdea.user_id == current_user.id)
    if status:
        query = query.filter(EmergenceIdea.status == status)
    if brain_side:
        query = query.filter(EmergenceIdea.brain_side == brain_side)
    total = query.count()
    ideas = (
        query.order_by(EmergenceIdea.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return EmergenceIdeaListResponse(
        items=[
            EmergenceIdeaItem(
                id=i.id,
                title=i.title,
                summary=i.summary,
                brain_side=i.brain_side,
                source_result_ids=json.loads(i.source_result_ids),
                tags=json.loads(i.tags),
                status=i.status,
                target_type=i.target_type,
                target_id=i.target_id,
                created_at=i.created_at,
                updated_at=i.updated_at,
            )
            for i in ideas
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/ideas/{idea_id}/promote", summary="将涌现成果转为笔记/胶囊/知识单元", response_model=EmergenceIdeaItem)
async def promote_emergence_idea(
    idea_id: str,
    req: PromoteIdeaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    idea = db.query(EmergenceIdea).filter(
        EmergenceIdea.id == idea_id,
        EmergenceIdea.user_id == current_user.id,
    ).first()
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")

    target_id = str(uuid.uuid4())
    title = idea.title
    body = idea.summary or ""
    brain_side = idea.brain_side

    if req.target_type == "note":
        note = Note(
            id=target_id,
            user_id=current_user.id,
            brain_side=brain_side,
            title=title,
            content=body,
            status="active",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(note)
    elif req.target_type == "capsule":
        capsule = Capsule(
            id=target_id,
            user_id=current_user.id,
            brain_side=brain_side,
            content_type="text",
            content_body=body or title,
            unlock_type="manual",
            unlock_config=json.dumps({}),
            unlock_status="unlocked",
            privacy_level="private",
            status="active",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(capsule)
    elif req.target_type == "knowledge":
        knowledge = KnowledgeUnit(
            id=target_id,
            user_id=current_user.id,
            brain_side=brain_side,
            content_raw=body or title,
            source_type="emergence",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(knowledge)
    else:
        raise HTTPException(status_code=400, detail="Unsupported target_type")

    idea.status = "converted"
    idea.target_type = req.target_type
    idea.target_id = target_id
    idea.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(idea)

    return EmergenceIdeaItem(
        id=idea.id,
        title=idea.title,
        summary=idea.summary,
        brain_side=idea.brain_side,
        source_result_ids=json.loads(idea.source_result_ids),
        tags=json.loads(idea.tags),
        status=idea.status,
        target_type=idea.target_type,
        target_id=idea.target_id,
        created_at=idea.created_at,
        updated_at=idea.updated_at,
    )


def _canvas_to_item(canvas: EmergenceCanvas) -> CanvasItem:
    nodes = json.loads(canvas.nodes or "[]")
    edges = json.loads(canvas.edges or "[]")
    return CanvasItem(
        id=canvas.id,
        user_id=canvas.user_id,
        title=canvas.title,
        description=canvas.description,
        brain_side=canvas.brain_side,
        node_count=len(nodes),
        edge_count=len(edges),
        created_at=canvas.created_at,
        updated_at=canvas.updated_at,
    )


def _canvas_to_detail(canvas: EmergenceCanvas) -> CanvasDetail:
    return CanvasDetail(
        id=canvas.id,
        user_id=canvas.user_id,
        title=canvas.title,
        description=canvas.description,
        brain_side=canvas.brain_side,
        nodes=json.loads(canvas.nodes or "[]"),
        edges=json.loads(canvas.edges or "[]"),
        created_at=canvas.created_at,
        updated_at=canvas.updated_at,
    )


@router.get("/canvases", summary="涌现画布列表", response_model=CanvasListResponse)
async def list_emergence_canvases(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(EmergenceCanvas).filter(EmergenceCanvas.user_id == current_user.id)
    total = query.count()
    canvases = (
        query.order_by(EmergenceCanvas.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return CanvasListResponse(
        items=[_canvas_to_item(c) for c in canvases],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/canvases", summary="创建涌现画布", response_model=CanvasDetail)
async def create_emergence_canvas(
    req: CanvasCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = EmergenceCanvas(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=req.title,
        description=req.description,
        brain_side=req.brain_side or "both",
        nodes=json.dumps([n.model_dump() for n in req.nodes], ensure_ascii=False),
        edges=json.dumps([e.model_dump() for e in req.edges], ensure_ascii=False),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(canvas)
    db.commit()
    db.refresh(canvas)
    return _canvas_to_detail(canvas)


@router.get("/canvases/{canvas_id}", summary="获取涌现画布", response_model=CanvasDetail)
async def get_emergence_canvas(
    canvas_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = db.query(EmergenceCanvas).filter(
        EmergenceCanvas.id == canvas_id,
        EmergenceCanvas.user_id == current_user.id,
    ).first()
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return _canvas_to_detail(canvas)


@router.put("/canvases/{canvas_id}", summary="更新涌现画布", response_model=CanvasDetail)
async def update_emergence_canvas(
    canvas_id: str,
    req: CanvasUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = db.query(EmergenceCanvas).filter(
        EmergenceCanvas.id == canvas_id,
        EmergenceCanvas.user_id == current_user.id,
    ).first()
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    if req.title is not None:
        canvas.title = req.title
    if req.description is not None:
        canvas.description = req.description
    if req.brain_side is not None:
        canvas.brain_side = req.brain_side
    if req.nodes is not None:
        canvas.nodes = json.dumps([n.model_dump() for n in req.nodes], ensure_ascii=False)
    if req.edges is not None:
        canvas.edges = json.dumps([e.model_dump() for e in req.edges], ensure_ascii=False)
    canvas.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(canvas)
    return _canvas_to_detail(canvas)


@router.delete("/canvases/{canvas_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除涌现画布")
async def delete_emergence_canvas(
    canvas_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = db.query(EmergenceCanvas).filter(
        EmergenceCanvas.id == canvas_id,
        EmergenceCanvas.user_id == current_user.id,
    ).first()
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")
    db.delete(canvas)
    db.commit()
    return None


@router.post("/canvases/{canvas_id}/combine", summary="组合画布节点为新创意", response_model=EmergenceIdeaItem)
async def combine_canvas_nodes(
    canvas_id: str,
    req: CanvasCombineRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = db.query(EmergenceCanvas).filter(
        EmergenceCanvas.id == canvas_id,
        EmergenceCanvas.user_id == current_user.id,
    ).first()
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    nodes = json.loads(canvas.nodes or "[]")
    selected = [n for n in nodes if n.get("id") in req.node_ids]
    if len(selected) < 2:
        raise HTTPException(status_code=400, detail="At least 2 nodes required")

    sides = {n.get("brain_side", "both") for n in selected}
    brain_side = "both"
    if sides == {"personal"}:
        brain_side = "personal"
    elif sides == {"network"}:
        brain_side = "network"

    source_result_ids = [
        n.get("idea_id") for n in selected if n.get("type") == "idea" and n.get("idea_id")
    ]

    idea = EmergenceIdea(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=req.title,
        summary=req.summary or "",
        brain_side=brain_side,
        source_result_ids=json.dumps(source_result_ids, ensure_ascii=False),
        tags=json.dumps(req.tags or [], ensure_ascii=False),
        status="draft",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(idea)
    db.commit()
    db.refresh(idea)

    return EmergenceIdeaItem(
        id=idea.id,
        title=idea.title,
        summary=idea.summary,
        brain_side=idea.brain_side,
        source_result_ids=json.loads(idea.source_result_ids),
        tags=json.loads(idea.tags),
        status=idea.status,
        target_type=idea.target_type,
        target_id=idea.target_id,
        created_at=idea.created_at,
        updated_at=idea.updated_at,
    )


@router.post("/canvases/{canvas_id}/report", summary="根据画布生成报告/提案", response_model=CanvasReportResponse)
async def generate_canvas_report(
    canvas_id: str,
    req: CanvasReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = db.query(EmergenceCanvas).filter(
        EmergenceCanvas.id == canvas_id,
        EmergenceCanvas.user_id == current_user.id,
    ).first()
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    nodes = json.loads(canvas.nodes or "[]")
    edges = json.loads(canvas.edges or "[]")
    if not nodes:
        raise HTTPException(status_code=400, detail="Canvas has no nodes")

    focus_nodes = nodes
    if req.focus_node_ids:
        focus_nodes = [n for n in nodes if n.get("id") in req.focus_node_ids]
        if not focus_nodes:
            focus_nodes = nodes

    node_texts = []
    for n in focus_nodes:
        node_texts.append(
            f"- [{n.get('type', 'node')}] {n.get('label', '未命名')}: {n.get('content', '') or ''}"
        )
    edge_texts = [f"- {e.get('source')} → {e.get('target')}: {e.get('label') or '关联'}" for e in edges]

    format_prompts = {
        "proposal": "请根据以下画布节点与连线，生成一份结构化创新提案，包含背景、核心洞察、方案、实施步骤、预期价值。",
        "summary": "请根据以下画布节点与连线，生成一段精炼的摘要，提炼关键观点与结论。",
        "story": "请根据以下画布节点与连线，创作一个连贯的叙事/故事脚本。",
        "mindmap": "请根据以下画布节点与连线，生成一份层级清晰的思维导图大纲（使用 Markdown 列表）。",
    }

    prompt = (
        f"{format_prompts.get(req.format, format_prompts['proposal'])}\n\n"
        f"画布标题：{req.title or canvas.title}\n\n"
        f"节点：\n{chr(10).join(node_texts)}\n\n"
        f"连线：\n{chr(10).join(edge_texts)}\n\n"
        "输出要求：使用 Markdown 格式，内容具体、有洞察力，不要编造画布中不存在的信息。"
    )

    route = LLMRouterService.route(prompt, preferred_model=req.preferred_model)
    model_used = (
        route.get("model_name")
        or route.get("model")
        or req.preferred_model
        or "ollama-qwen2.5-0.5b"
    )
    try:
        content = await _call_llm_text(
            prompt,
            db=db,
            user_id=current_user.id,
            task_type="creative",
            brain_side=canvas.brain_side,
            preferred_model=req.preferred_model,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=f"LLM generation failed: {str(e)}")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"LLM generation failed: {str(exc)}")

    return CanvasReportResponse(
        title=req.title or f"{canvas.title} 报告",
        content=content,
        model_used=model_used,
    )


@router.post("/canvases/{canvas_id}/to-note", summary="将画布转为笔记", response_model=Dict[str, str])
async def convert_canvas_to_note(
    canvas_id: str,
    req: CanvasToNoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    canvas = db.query(EmergenceCanvas).filter(
        EmergenceCanvas.id == canvas_id,
        EmergenceCanvas.user_id == current_user.id,
    ).first()
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    nodes = json.loads(canvas.nodes or "[]")
    edges = json.loads(canvas.edges or "[]")

    title = req.title or canvas.title
    lines = [f"# {title}", ""]
    if canvas.description:
        lines.append(f"> {canvas.description}")
        lines.append("")
    lines.append("## 节点")
    for n in nodes:
        lines.append(f"- **{n.get('label', '未命名')}** ({n.get('type', 'node')})")
        if n.get("content"):
            lines.append(f"  - {n.get('content')}")
    if edges:
        lines.append("")
        lines.append("## 连线")
        for e in edges:
            src = next((n for n in nodes if n.get("id") == e.get("source")), {})
            tgt = next((n for n in nodes if n.get("id") == e.get("target")), {})
            lines.append(
                f"- {src.get('label', e.get('source'))} → {tgt.get('label', e.get('target'))}"
            )

    content = req.content or "\n".join(lines)

    note = Note(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=canvas.brain_side,
        title=title,
        content=content,
        status="active",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return {"note_id": note.id, "title": note.title}


@router.delete("/ideas/{idea_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除涌现成果")
async def delete_emergence_idea(
    idea_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    idea = db.query(EmergenceIdea).filter(
        EmergenceIdea.id == idea_id,
        EmergenceIdea.user_id == current_user.id,
    ).first()
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")
    db.delete(idea)
    db.commit()
    return None


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除涌现记录")
async def delete_emergence_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = db.query(EmergenceResult).filter(
        EmergenceResult.id == record_id,
        EmergenceResult.user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(record)
    db.commit()
    return None
