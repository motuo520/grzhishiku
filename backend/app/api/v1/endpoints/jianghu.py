from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import uuid
import json
from datetime import datetime, date, timedelta

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, Note, KnowledgeUnit, PracticeRecord, DailyReview, ContextGuide, ExperimentLog, CognitivePotentialResult
from app.schemas.jianghu import (
    PracticeRecordCreate, PracticeRecordResponse,
    DailyReviewGenerateRequest, DailyReviewResponse, DailyReviewUpdate,
    RelevanceCheckRequest, RelevanceCheckResponse,
    KnowledgeHealthResponse, EvolutionDistribution,
    ContextGuideCreate, ContextGuideUpdate, ContextGuideResponse, ContextGuideGenerateRequest,
    CognitivePotentialRequest, CognitivePotentialResponse, CognitivePotentialItem,
    ExperimentLogCreate, ExperimentLogUpdate, ExperimentLogResponse
)
from app.services.llm_service import chat_completion

router = APIRouter()


EVOLUTION_STAGES = ["collected", "understood", "practiced", "validated", "internalized"]


def _json_list_field(text: Optional[str]) -> List[str]:
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except Exception:
        pass
    return []


def _build_practice_response(record: PracticeRecord) -> dict:
    return {
        "id": record.id,
        "user_id": record.user_id,
        "target_type": record.target_type,
        "target_id": record.target_id,
        "practice_type": record.practice_type,
        "description": record.description,
        "result": record.result,
        "learned_lesson": record.learned_lesson,
        "context_snapshot": record.context_snapshot,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _build_daily_review_response(review: DailyReview) -> dict:
    return {
        "id": review.id,
        "user_id": review.user_id,
        "review_date": review.review_date.date() if isinstance(review.review_date, datetime) else review.review_date,
        "content_summary": review.content_summary,
        "ai_reflection": review.ai_reflection,
        "gaps_found": _json_list_field(review.gaps_found),
        "action_items": _json_list_field(review.action_items),
        "praise_items": _json_list_field(review.praise_items),
        "status": review.status,
        "created_at": review.created_at,
        "updated_at": review.updated_at,
    }


def _update_target_practice_depth(db: Session, target_type: str, target_id: str, user_id: str):
    """Bump practice_depth on the target note/knowledge unit based on practice records."""
    if target_type == "note":
        target = db.query(Note).filter(Note.id == target_id, Note.user_id == user_id).first()
    elif target_type == "knowledge_unit":
        target = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == target_id, KnowledgeUnit.user_id == user_id).first()
    else:
        return

    if not target:
        return

    records = db.query(PracticeRecord).filter(
        PracticeRecord.target_type == target_type,
        PracticeRecord.target_id == target_id,
        PracticeRecord.user_id == user_id,
    ).all()

    # Map record count to practice_depth 0-5; keep attached ids in sync with the source rows
    target.practice_depth = min(len(records), 5)
    target.evolution_stage = _evolution_stage_from_depth(target.practice_depth)
    target.attached_practice_ids = json.dumps([r.id for r in records], ensure_ascii=False)
    db.commit()


def _evolution_stage_from_depth(depth: int) -> str:
    if depth >= 4:
        return "internalized"
    if depth >= 3:
        return "validated"
    if depth >= 2:
        return "practiced"
    if depth >= 1:
        return "understood"
    return "collected"


def _active_context_guides_prompt(db: Session, user_id: str, brain_side: str) -> str:
    """Build a system-prompt section from the user's active context guides for the given brain side."""
    guides = db.query(ContextGuide).filter(
        ContextGuide.user_id == user_id,
        ContextGuide.is_active == True,  # noqa: E712
    ).all()
    applicable = []
    for g in guides:
        scope = g.scope or "both"
        if brain_side == "both" or scope == "both" or scope == brain_side:
            applicable.append(g)
    if not applicable:
        return ""
    parts = ["以下是用户维护的「知识库引导文件」，请在分析与给出建议时遵循其中的背景、偏好与约束："]
    for g in applicable:
        parts.append(f"\n### {g.title}\n{g.content}")
    return "\n".join(parts)


@router.post("/practice-records", response_model=PracticeRecordResponse, status_code=status.HTTP_201_CREATED, summary="Create practice record")
async def create_practice_record(
    data: PracticeRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Validate target exists
    if data.target_type == "note":
        target = db.query(Note).filter(Note.id == data.target_id, Note.user_id == current_user.id).first()
    else:
        target = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == data.target_id, KnowledgeUnit.user_id == current_user.id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    record = PracticeRecord(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        target_type=data.target_type,
        target_id=data.target_id,
        practice_type=data.practice_type.value,
        description=data.description,
        result=data.result,
        learned_lesson=data.learned_lesson,
        context_snapshot=data.context_snapshot,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    _update_target_practice_depth(db, record.target_type, record.target_id, current_user.id)
    return _build_practice_response(record)


@router.get("/practice-records", response_model=List[PracticeRecordResponse], summary="List practice records")
async def list_practice_records(
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    practice_type: Optional[str] = None,
    brain_side: Optional[str] = Query("both", description="Filter by target brain side: personal / network / both"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(PracticeRecord).filter(PracticeRecord.user_id == current_user.id)
    if target_type:
        query = query.filter(PracticeRecord.target_type == target_type)
    if target_id:
        query = query.filter(PracticeRecord.target_id == target_id)
    if practice_type:
        query = query.filter(PracticeRecord.practice_type == practice_type)

    if brain_side and brain_side != "both":
        if target_type == "note":
            query = query.filter(
                db.query(Note.id).filter(
                    Note.id == PracticeRecord.target_id,
                    Note.brain_side == brain_side,
                ).correlate(PracticeRecord).exists()
            )
        elif target_type == "knowledge_unit":
            query = query.filter(
                db.query(KnowledgeUnit.id).filter(
                    KnowledgeUnit.id == PracticeRecord.target_id,
                    KnowledgeUnit.brain_side == brain_side,
                ).correlate(PracticeRecord).exists()
            )
        else:
            query = query.filter(
                ((PracticeRecord.target_type == "note") & (
                    db.query(Note.id).filter(
                        Note.id == PracticeRecord.target_id,
                        Note.brain_side == brain_side,
                    ).correlate(PracticeRecord).exists()
                )) |
                ((PracticeRecord.target_type == "knowledge_unit") & (
                    db.query(KnowledgeUnit.id).filter(
                        KnowledgeUnit.id == PracticeRecord.target_id,
                        KnowledgeUnit.brain_side == brain_side,
                    ).correlate(PracticeRecord).exists()
                ))
            )

    records = query.order_by(PracticeRecord.created_at.desc()).offset(offset).limit(limit).all()
    return [_build_practice_response(r) for r in records]


@router.get("/practice-records/{record_id}", response_model=PracticeRecordResponse, summary="Get practice record")
async def get_practice_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    record = db.query(PracticeRecord).filter(PracticeRecord.id == record_id, PracticeRecord.user_id == current_user.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Practice record not found")
    return _build_practice_response(record)


@router.put("/practice-records/{record_id}", response_model=PracticeRecordResponse, summary="Update practice record")
async def update_practice_record(
    record_id: str,
    data: PracticeRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    record = db.query(PracticeRecord).filter(PracticeRecord.id == record_id, PracticeRecord.user_id == current_user.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Practice record not found")

    record.target_type = data.target_type
    record.target_id = data.target_id
    record.practice_type = data.practice_type.value
    record.description = data.description
    record.result = data.result
    record.learned_lesson = data.learned_lesson
    record.context_snapshot = data.context_snapshot
    record.updated_at = datetime.now()
    db.commit()
    db.refresh(record)

    _update_target_practice_depth(db, record.target_type, record.target_id, current_user.id)
    return _build_practice_response(record)


@router.delete("/practice-records/{record_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete practice record")
async def delete_practice_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    record = db.query(PracticeRecord).filter(PracticeRecord.id == record_id, PracticeRecord.user_id == current_user.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Practice record not found")
    target_type = record.target_type
    target_id = record.target_id
    db.delete(record)
    db.commit()
    _update_target_practice_depth(db, target_type, target_id, current_user.id)
    return None


@router.post("/daily-reviews/generate", response_model=DailyReviewResponse, summary="Generate daily review")
async def generate_daily_review(
    request: DailyReviewGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    review_date = request.review_date or date.today()
    start_dt = datetime.combine(review_date, datetime.min.time())
    end_dt = start_dt + timedelta(days=1)

    # Fetch today's activity
    brain_side = request.brain_side or "both"
    notes_query = db.query(Note).filter(
        Note.user_id == current_user.id,
        Note.created_at >= start_dt,
        Note.created_at < end_dt,
    )
    if brain_side != "both":
        notes_query = notes_query.filter(Note.brain_side == brain_side)
    notes = notes_query.all() if request.include_notes else []

    knowledge_query = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.created_at >= start_dt,
        KnowledgeUnit.created_at < end_dt,
    )
    if brain_side != "both":
        knowledge_query = knowledge_query.filter(KnowledgeUnit.brain_side == brain_side)
    knowledge = knowledge_query.all() if request.include_knowledge else []

    note_summaries = [f"- {n.title or '(无标题)'}: {(n.content or '')[:120]}" for n in notes]
    knowledge_summaries = [f"- {(k.content_raw or '')[:150]}" for k in knowledge]

    prompt = f"""你是一位个人知识管理教练，基于用户今天记录的内容生成每日复盘。

今日日期：{review_date}
今日笔记（{len(notes)}条）：
{chr(10).join(note_summaries) or "无"}

今日知识单元（{len(knowledge)}条）：
{chr(10).join(knowledge_summaries) or "无"}

请只返回一个 JSON 对象，不要包含 Markdown 格式：
{{
  "content_summary": "用 100 字以内总结今日内容",
  "ai_reflection": "对用户今天输入质量的反思",
  "gaps_found": ["发现的一个差距"],
  "action_items": ["明天可以做的改进动作"],
  "praise_items": ["今天做得好的地方"]
}}
"""

    try:
        guide_ctx = _active_context_guides_prompt(db, current_user.id, brain_side)
        system_prompt = "You are a personal knowledge management coach. Always return valid JSON."
        if guide_ctx:
            system_prompt += "\n\n" + guide_ctx
        raw = await chat_completion(
            prompt=prompt,
            task_type="analysis",
            system_prompt=system_prompt,
            preferred_model=request.preferred_model,
        )

        # Extract JSON from possible markdown code block
        json_str = raw
        if "```json" in raw:
            json_str = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            json_str = raw.split("```")[1].split("```")[0].strip()

        result = json.loads(json_str)
        if not isinstance(result, dict):
            raise ValueError("AI 返回格式错误：期望 JSON 对象")
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"AI 复盘生成失败：{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 复盘生成失败：{str(e)}")

    existing = db.query(DailyReview).filter(
        DailyReview.user_id == current_user.id,
        DailyReview.review_date == start_dt,
    ).first()
    if existing:
        existing.content_summary = result.get("content_summary", "")
        existing.ai_reflection = result.get("ai_reflection", "")
        existing.gaps_found = json.dumps(result.get("gaps_found", []), ensure_ascii=False)
        existing.action_items = json.dumps(result.get("action_items", []), ensure_ascii=False)
        existing.praise_items = json.dumps(result.get("praise_items", []), ensure_ascii=False)
        existing.status = "generated"
        existing.updated_at = datetime.now()
        db.commit()
        db.refresh(existing)
        return _build_daily_review_response(existing)

    review = DailyReview(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        review_date=review_date,
        content_summary=result.get("content_summary", ""),
        ai_reflection=result.get("ai_reflection", ""),
        gaps_found=json.dumps(result.get("gaps_found", []), ensure_ascii=False),
        action_items=json.dumps(result.get("action_items", []), ensure_ascii=False),
        praise_items=json.dumps(result.get("praise_items", []), ensure_ascii=False),
        status="generated",
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return _build_daily_review_response(review)


@router.get("/daily-reviews", response_model=List[DailyReviewResponse], summary="List daily reviews")
async def list_daily_reviews(
    status: Optional[str] = None,
    limit: int = Query(30, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(DailyReview).filter(DailyReview.user_id == current_user.id)
    if status:
        query = query.filter(DailyReview.status == status)
    reviews = query.order_by(DailyReview.review_date.desc()).offset(offset).limit(limit).all()
    return [_build_daily_review_response(r) for r in reviews]


@router.get("/daily-reviews/{review_id}", response_model=DailyReviewResponse, summary="Get daily review")
async def get_daily_review(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    review = db.query(DailyReview).filter(DailyReview.id == review_id, DailyReview.user_id == current_user.id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Daily review not found")
    return _build_daily_review_response(review)


@router.put("/daily-reviews/{review_id}", response_model=DailyReviewResponse, summary="Update daily review")
async def update_daily_review(
    review_id: str,
    data: DailyReviewUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    review = db.query(DailyReview).filter(DailyReview.id == review_id, DailyReview.user_id == current_user.id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Daily review not found")

    if data.status is not None:
        review.status = data.status
    if data.content_summary is not None:
        review.content_summary = data.content_summary
    if data.ai_reflection is not None:
        review.ai_reflection = data.ai_reflection
    if data.gaps_found is not None:
        review.gaps_found = json.dumps(data.gaps_found, ensure_ascii=False)
    if data.action_items is not None:
        review.action_items = json.dumps(data.action_items, ensure_ascii=False)
    if data.praise_items is not None:
        review.praise_items = json.dumps(data.praise_items, ensure_ascii=False)

    review.updated_at = datetime.now()
    db.commit()
    db.refresh(review)
    return _build_daily_review_response(review)


@router.post("/relevance-check", response_model=RelevanceCheckResponse, summary="Check personal relevance")
async def check_relevance(
    request: RelevanceCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Build context from user's recent notes and knowledge
    brain_side = request.brain_side or "both"
    recent_notes_query = db.query(Note).filter(Note.user_id == current_user.id)
    recent_knowledge_query = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id)
    if brain_side != "both":
        recent_notes_query = recent_notes_query.filter(Note.brain_side == brain_side)
        recent_knowledge_query = recent_knowledge_query.filter(KnowledgeUnit.brain_side == brain_side)
    recent_notes = recent_notes_query.order_by(Note.created_at.desc()).limit(10).all()
    recent_knowledge = recent_knowledge_query.order_by(KnowledgeUnit.created_at.desc()).limit(10).all()

    context_lines = []
    for n in recent_notes:
        context_lines.append(f"笔记：{(n.title or '')} {(n.content or '')[:100]}")
    for k in recent_knowledge:
        context_lines.append(f"知识：{(k.content_raw or '')[:100]}")

    context = request.user_context_summary or "\n".join(context_lines) or "用户暂无上下文"

    prompt = f"""你是一位个人知识筛选助手。请判断下面的外部内容与用户的关联度。

用户近期上下文：
{context}

外部内容（类型：{request.content_type}）：
{request.content[:2000]}

请只返回 JSON：
{{
  "personal_relevance_score": 0.0-1.0 的浮点数,
  "reason": "判断理由",
  "connection_evidence": "与用户已有内容的关联证据",
  "first_action": "如果导入，建议的第一步行动",
  "suggested_action": "import / import_with_practice / read_later / ignore 之一"
}}
"""

    try:
        guide_ctx = _active_context_guides_prompt(db, current_user.id, brain_side)
        system_prompt = "You are a personal knowledge filter. Always return valid JSON."
        if guide_ctx:
            system_prompt += "\n\n" + guide_ctx
        raw = await chat_completion(
            prompt=prompt,
            task_type="analysis",
            system_prompt=system_prompt,
            preferred_model=request.preferred_model,
        )

        json_str = raw
        if "```json" in raw:
            json_str = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            json_str = raw.split("```")[1].split("```")[0].strip()

        result = json.loads(json_str)
        if not isinstance(result, dict):
            raise ValueError("AI 返回格式错误：期望 JSON 对象")
        score = max(0.0, min(1.0, float(result.get("personal_relevance_score", 0.5))))
        action = result.get("suggested_action", "read_later")
        if action not in ("import", "import_with_practice", "read_later", "ignore"):
            action = "read_later"

        return RelevanceCheckResponse(
            personal_relevance_score=score,
            reason=result.get("reason", ""),
            connection_evidence=result.get("connection_evidence"),
            first_action=result.get("first_action"),
            suggested_action=action,
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"AI 关联度分析失败：{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 关联度分析失败：{str(e)}")


@router.get("/knowledge-health", response_model=KnowledgeHealthResponse, summary="Knowledge base health")
async def get_knowledge_health(
    brain_side: Optional[str] = Query("both", description="Filter by brain side: personal / network / both"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    notes_query = db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active")
    knowledge_query = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id)
    if brain_side and brain_side != "both":
        notes_query = notes_query.filter(Note.brain_side == brain_side)
        knowledge_query = knowledge_query.filter(KnowledgeUnit.brain_side == brain_side)
    notes = notes_query.all()
    knowledge = knowledge_query.all()
    items = notes + knowledge

    total = len(items)
    distribution = {stage: 0 for stage in EVOLUTION_STAGES}
    for item in items:
        stage = item.evolution_stage or "collected"
        distribution[stage] = distribution.get(stage, 0) + 1

    avg_depth = sum((item.practice_depth or 0) for item in items) / total if total else 0.0
    avg_invoke = sum((item.invoke_count or 0) for item in items) / total if total else 0.0

    high_value = sum(
        1 for item in items
        if (item.practice_depth or 0) >= 3 and (item.invoke_count or 0) >= 5
    )

    thirty_days_ago = datetime.now() - timedelta(days=30)
    zombie = sum(
        1 for item in items
        if (item.invoke_count or 0) == 0 and item.created_at and item.created_at < thirty_days_ago
    )

    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    invoked_today = sum(
        1 for item in items
        if item.last_invoked_at and item.last_invoked_at >= today_start
    )
    daily_active_rate = invoked_today / total if total else 0.0

    # Approximate value_score sum using same formula as knowledge endpoint
    import math
    value_total = 0.0
    for item in items:
        density = 0.5
        content = getattr(item, "content_raw", None) or getattr(item, "content", "")
        markers = ["我发现", "我验证了", "我的做法", "我试了一下", "结果", "学到", "I found", "I verified", "I tried", "my approach"]
        if content:
            density = min(sum(1 for m in markers if m in content) / len(markers) * 2, 1.0)
        frequency = math.log1p(item.invoke_count or 0)
        depth = item.practice_depth or 0
        value_total += round(density * frequency * depth, 2)

    practiced_count = sum(1 for item in items if (item.practice_depth or 0) >= 1)
    active_ratio = (total - zombie) / total if total else 0.0
    practiced_ratio = practiced_count / total if total else 0.0
    high_value_ratio = high_value / total if total else 0.0
    # Composite health: rewards a living (non-graveyard), practiced, high-value knowledge base
    health_score = round(100 * (0.5 * active_ratio + 0.3 * practiced_ratio + 0.2 * high_value_ratio), 1)

    return KnowledgeHealthResponse(
        total_items=total,
        health_score=health_score,
        evolution_distribution=EvolutionDistribution(
            collected=distribution.get("collected", 0),
            understood=distribution.get("understood", 0),
            practiced=distribution.get("practiced", 0),
            validated=distribution.get("validated", 0),
            internalized=distribution.get("internalized", 0),
        ),
        avg_practice_depth=round(avg_depth, 2),
        avg_invoke_count=round(avg_invoke, 2),
        high_value_items=high_value,
        zombie_items=zombie,
        daily_active_rate=round(daily_active_rate, 2),
        value_score_total=round(value_total, 2),
    )


def _build_context_guide_response(guide: ContextGuide) -> dict:
    return {
        "id": guide.id,
        "user_id": guide.user_id,
        "title": guide.title,
        "content": guide.content,
        "scope": guide.scope,
        "is_active": guide.is_active,
        "version_tag": guide.version_tag,
        "created_at": guide.created_at,
        "updated_at": guide.updated_at,
    }


@router.get("/context-guides", response_model=List[ContextGuideResponse], summary="List context guides")
async def list_context_guides(
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(ContextGuide).filter(ContextGuide.user_id == current_user.id)
    if is_active is not None:
        query = query.filter(ContextGuide.is_active == is_active)
    guides = query.order_by(ContextGuide.updated_at.desc()).all()
    return [_build_context_guide_response(g) for g in guides]


@router.post("/context-guides", response_model=ContextGuideResponse, status_code=status.HTTP_201_CREATED, summary="Create context guide")
async def create_context_guide(
    data: ContextGuideCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    guide = ContextGuide(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=data.title,
        content=data.content,
        scope=data.scope.value,
        is_active=data.is_active,
        version_tag=data.version_tag,
    )
    db.add(guide)
    db.commit()
    db.refresh(guide)
    return _build_context_guide_response(guide)


@router.get("/context-guides/{guide_id}", response_model=ContextGuideResponse, summary="Get context guide")
async def get_context_guide(
    guide_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    guide = db.query(ContextGuide).filter(ContextGuide.id == guide_id, ContextGuide.user_id == current_user.id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Context guide not found")
    return _build_context_guide_response(guide)


@router.put("/context-guides/{guide_id}", response_model=ContextGuideResponse, summary="Update context guide")
async def update_context_guide(
    guide_id: str,
    data: ContextGuideUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    guide = db.query(ContextGuide).filter(ContextGuide.id == guide_id, ContextGuide.user_id == current_user.id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Context guide not found")

    if data.title is not None:
        guide.title = data.title
    if data.content is not None:
        guide.content = data.content
    if data.scope is not None:
        guide.scope = data.scope.value
    if data.is_active is not None:
        guide.is_active = data.is_active
    if data.version_tag is not None:
        guide.version_tag = data.version_tag

    guide.updated_at = datetime.now()
    db.commit()
    db.refresh(guide)
    return _build_context_guide_response(guide)


@router.delete("/context-guides/{guide_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete context guide")
async def delete_context_guide(
    guide_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    guide = db.query(ContextGuide).filter(ContextGuide.id == guide_id, ContextGuide.user_id == current_user.id).first()
    if not guide:
        raise HTTPException(status_code=404, detail="Context guide not found")
    db.delete(guide)
    db.commit()
    return None


@router.post("/context-guides/generate", response_model=ContextGuideResponse, summary="Generate context guide with AI")
async def generate_context_guide(
    request: ContextGuideGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    brain_side = request.brain_side or "both"
    notes_query = db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active")
    knowledge_query = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id)
    if brain_side != "both":
        notes_query = notes_query.filter(Note.brain_side == brain_side)
        knowledge_query = knowledge_query.filter(KnowledgeUnit.brain_side == brain_side)

    recent_notes = notes_query.order_by(Note.updated_at.desc()).limit(30).all()
    recent_knowledge = knowledge_query.order_by(KnowledgeUnit.updated_at.desc()).limit(30).all()

    note_lines = [f"- 笔记：{(n.title or '(无标题)')}\n  {(n.content or '')[:200]}" for n in recent_notes]
    knowledge_lines = [f"- 知识单元：{(k.content_raw or '')[:250]}" for k in recent_knowledge]

    prompt = f"""你是一位个人知识库整理助手。请基于用户最近记录的内容，生成一份 AI 全知上下文引导文件（markdown 格式）。

这份引导文件需要让 AI 在后续对话中快速理解用户的知识结构、关注领域、常用概念和当前目标。

内容来源（{brain_side} 脑侧）：
{chr(10).join(note_lines) or "无笔记"}

{chr(10).join(knowledge_lines) or "无知识单元"}

请直接返回 markdown 文本，不要包裹代码块。文件结构建议包含：
1. 用户关注领域（3-5 个）
2. 高频概念与术语
3. 当前在解决的核心问题/目标
4. 知识库的组织习惯
5. 与 AI 协作的偏好
"""

    try:
        raw = await chat_completion(
            prompt=prompt,
            task_type="analysis",
            system_prompt="You are a personal knowledge base context generator. Return concise, well-structured markdown without code fences.",
            preferred_model=request.preferred_model,
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"AI 生成失败：{str(e)}")

    content = raw.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        content = "\n".join(lines).strip()

    title = request.title or f"AI 全知上下文 · {brain_side} · {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    scope = brain_side if brain_side in ("personal", "network") else "both"

    guide = ContextGuide(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=title,
        content=content,
        scope=scope,
        is_active=True,
        version_tag="auto",
    )
    db.add(guide)
    db.commit()
    db.refresh(guide)
    return _build_context_guide_response(guide)


@router.post("/cognitive-potential", response_model=CognitivePotentialResponse, summary="Analyze cognitive potential")
async def analyze_cognitive_potential(
    request: CognitivePotentialRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    brain_side = request.brain_side or "both"
    # knowledge 此前未滤 deleted——已删条目分析得出、点开 404，一并修掉。
    # （开源版无租户/团队空间，口径保持 user_id；主仓对应 content_filter 空间口径）
    notes_query = db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active")
    knowledge_query = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.status != "deleted",
    )
    if brain_side != "both":
        notes_query = notes_query.filter(Note.brain_side == brain_side)
        knowledge_query = knowledge_query.filter(KnowledgeUnit.brain_side == brain_side)

    notes = notes_query.order_by(Note.practice_depth.desc(), Note.invoke_count.desc(), Note.updated_at.desc()).limit(25).all()
    knowledge = knowledge_query.order_by(KnowledgeUnit.practice_depth.desc(), KnowledgeUnit.invoke_count.desc(), KnowledgeUnit.updated_at.desc()).limit(25).all()

    items = []
    for n in notes:
        items.append({
            "id": n.id,
            "type": "note",
            "title": (n.title or "(无标题)")[:80],
            "content": (n.content or "")[:250],
            "practice_depth": n.practice_depth or 0,
            "invoke_count": n.invoke_count or 0,
        })
    for k in knowledge:
        items.append({
            "id": k.id,
            "type": "knowledge_unit",
            "title": (k.content_raw or "")[:80],
            "content": (k.content_raw or "")[:250],
            "practice_depth": k.practice_depth or 0,
            "invoke_count": k.invoke_count or 0,
        })

    item_lines = [f"- [id:{i['id']}] [{i['type']}] {i['title']}\n  深度{i['practice_depth']} 调用{i['invoke_count']}\n  {i['content']}" for i in items]

    prompt = f"""你是一位认知资产教练。请分析用户当前脑侧的知识条目，判断哪些内容具备「可下沉」「可产出」「可变现」的势能。

分析标准：
- 可下沉：已经验证、可以转化为习惯、决策框架或行动清单的内容。
- 可产出：结构相对完整、可以写成文章、做成课程、分享给别人的内容。
- 可变现：有明确受众需求、能解决问题、可以产品化或服务化的内容。

待分析条目（{brain_side} 脑侧，共 {len(items)} 条）：
{chr(10).join(item_lines) or "暂无可分析条目"}

注意：每个返回项的 content_id 必须从上面条目的 [id:xxx] 中原样复制，不得编造或修改。

请只返回 JSON，不要 Markdown 代码块：
{{
  "summary": "整体判断，100字以内",
  "sinkable": [{{ "content_id": "id", "content_type": "note|knowledge_unit", "title": "...", "score": 0.0-1.0, "reason": "...", "suggested_action": "..." }}],
  "outputable": [...],
  "monetizable": [...]
}}
"""

    try:
        guide_ctx = _active_context_guides_prompt(db, current_user.id, brain_side)
        system_prompt = "You are a cognitive asset analyst. Always return valid JSON with keys summary, sinkable, outputable, monetizable."
        if guide_ctx:
            system_prompt += "\n\n" + guide_ctx
        raw = await chat_completion(
            prompt=prompt,
            task_type="analysis",
            system_prompt=system_prompt,
            preferred_model=request.preferred_model,
        )

        json_str = raw
        if "```json" in raw:
            json_str = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            json_str = raw.split("```")[1].split("```")[0].strip()

        result = json.loads(json_str)
        if not isinstance(result, dict):
            raise ValueError("AI 返回格式错误：期望 JSON 对象")
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"AI 分析失败：{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 分析失败：{str(e)}")

    id_to_item = {i["id"]: i for i in items}

    def _parse_items(key: str):
        parsed = []
        for entry in result.get(key, []) or []:
            try:
                cid = str(entry.get("content_id", "")).strip()
                src = id_to_item.get(cid)
                if src is None:
                    continue
                parsed.append(CognitivePotentialItem(
                    content_id=cid,
                    content_type=src["type"],
                    title=src["title"] or entry.get("title", ""),
                    score=max(0.0, min(1.0, float(entry.get("score", 0.5)))),
                    reason=entry.get("reason", ""),
                    suggested_action=entry.get("suggested_action", ""),
                ))
            except Exception:
                continue
        return parsed

    response = CognitivePotentialResponse(
        summary=result.get("summary", ""),
        sinkable=_parse_items("sinkable"),
        outputable=_parse_items("outputable"),
        monetizable=_parse_items("monetizable"),
        analyzed_at=datetime.now().isoformat(),
        model_used=request.preferred_model or "ollama-qwen2.5-0.5b",
    )

    # 结果落库：分析是 LLM 调用，结果必须可回看（换模型/重进页面不丢）。
    # 每 用户×脑侧 只留最新一份，重跑即替换。（开源版无租户维度）
    existing_q = db.query(CognitivePotentialResult).filter(
        CognitivePotentialResult.user_id == current_user.id,
        CognitivePotentialResult.brain_side == brain_side,
    )
    payload_json = json.dumps(response.model_dump(), ensure_ascii=False)
    row = existing_q.first()
    if row:
        row.result_json = payload_json
        row.model_used = response.model_used
        row.created_at = datetime.now()
    else:
        db.add(CognitivePotentialResult(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            brain_side=brain_side,
            result_json=payload_json,
            model_used=response.model_used,
        ))
    db.commit()
    return response


@router.get("/cognitive-potential/latest", response_model=CognitivePotentialResponse, summary="Get latest saved cognitive potential analysis")
async def get_latest_cognitive_potential(
    brain_side: str = "both",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """取当前用户最近一次已保存的认知势能分析（免费读，不触发 LLM）。"""
    row = db.query(CognitivePotentialResult).filter(
        CognitivePotentialResult.user_id == current_user.id,
        CognitivePotentialResult.brain_side == brain_side,
    ).order_by(CognitivePotentialResult.created_at.desc()).first()
    if not row:
        raise HTTPException(status_code=404, detail="暂无保存的分析结果")
    try:
        data = json.loads(row.result_json)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=500, detail="保存的分析结果损坏")
    data["analyzed_at"] = row.created_at.isoformat() if row.created_at else data.get("analyzed_at")
    data["model_used"] = row.model_used or data.get("model_used")
    return CognitivePotentialResponse(**data)


def _build_experiment_log_response(log: ExperimentLog) -> dict:
    return {
        "id": log.id,
        "user_id": log.user_id,
        "title": log.title,
        "hypothesis": log.hypothesis,
        "controlled_variable": log.controlled_variable,
        "expected_result": log.expected_result,
        "actual_result": log.actual_result,
        "conclusion": log.conclusion,
        "status": log.status,
        "related_content_type": log.related_content_type,
        "related_content_id": log.related_content_id,
        "brain_side": log.brain_side,
        "created_at": log.created_at,
        "updated_at": log.updated_at,
    }


@router.get("/experiment-logs", response_model=List[ExperimentLogResponse], summary="List experiment logs")
async def list_experiment_logs(
    status: Optional[str] = None,
    brain_side: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(ExperimentLog).filter(ExperimentLog.user_id == current_user.id)
    if status:
        query = query.filter(ExperimentLog.status == status)
    if brain_side and brain_side != "both":
        query = query.filter(ExperimentLog.brain_side == brain_side)
    logs = query.order_by(ExperimentLog.updated_at.desc()).all()
    return [_build_experiment_log_response(l) for l in logs]


@router.post("/experiment-logs", response_model=ExperimentLogResponse, status_code=status.HTTP_201_CREATED, summary="Create experiment log")
async def create_experiment_log(
    data: ExperimentLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    log = ExperimentLog(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=data.title,
        hypothesis=data.hypothesis,
        controlled_variable=data.controlled_variable,
        expected_result=data.expected_result,
        actual_result=data.actual_result,
        conclusion=data.conclusion,
        status=data.status.value,
        related_content_type=data.related_content_type,
        related_content_id=data.related_content_id,
        brain_side=data.brain_side or "both",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _build_experiment_log_response(log)


@router.get("/experiment-logs/{log_id}", response_model=ExperimentLogResponse, summary="Get experiment log")
async def get_experiment_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    log = db.query(ExperimentLog).filter(ExperimentLog.id == log_id, ExperimentLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Experiment log not found")
    return _build_experiment_log_response(log)


@router.put("/experiment-logs/{log_id}", response_model=ExperimentLogResponse, summary="Update experiment log")
async def update_experiment_log(
    log_id: str,
    data: ExperimentLogUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    log = db.query(ExperimentLog).filter(ExperimentLog.id == log_id, ExperimentLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Experiment log not found")

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if hasattr(value, "value"):  # 枚举（如 status）取其原始值
            value = value.value
        setattr(log, field, value)

    log.updated_at = datetime.now()
    db.commit()
    db.refresh(log)
    return _build_experiment_log_response(log)


@router.delete("/experiment-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete experiment log")
async def delete_experiment_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    log = db.query(ExperimentLog).filter(ExperimentLog.id == log_id, ExperimentLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Experiment log not found")
    db.delete(log)
    db.commit()
    return None
