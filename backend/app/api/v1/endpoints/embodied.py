from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import uuid
import json
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, DepthCheckLog, EvolutionReflection, Capsule
from app.schemas.embodied import (
    DepthCheckRequest, DepthCheckResponse, DepthCheckLogResponse,
    EvolutionReflectionCreate, EvolutionReflectionUpdate, EvolutionReflectionResponse,
    EvolutionAnalysisRequest, EvolutionAnalysisResponse,
    MoodLocationResponse, MoodLocationItem, MoodLocationStats
)
from app.services.llm_billing_service import billed_chat_completion

router = APIRouter()


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


def _extract_json(raw: str) -> str:
    text = raw.strip()
    # 已经是 JSON
    if text and text[0] in ("{", "["):
        return text
    # 去掉 markdown 代码围栏
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
        if text and text[0] in ("{", "["):
            return text
    # 模型可能先说废话再给出 JSON：从文本中找出第一个能解析的平衡 JSON
    for i, ch in enumerate(text):
        if ch in ("{", "["):
            try:
                _, end = json.JSONDecoder().raw_decode(text, i)
                return text[i:end]
            except ValueError:
                continue
    return text


def _safe_parse_llm_json(raw: Optional[str], defaults: dict) -> dict:
    """从 LLM 输出里安全地解析 JSON，解析失败时返回 defaults 而不是抛异常。"""
    if not raw:
        return defaults
    text = _extract_json(raw)
    try:
        return json.loads(text)
    except Exception:
        # 兜底：直接截取第一个 { 到最后一个 } 再试一次
        try:
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(raw[start : end + 1])
        except Exception:
            pass
    return defaults


# ---------- Depth Check ----------

@router.post("/depth-check", response_model=DepthCheckResponse, summary="Evaluate content depth")
async def evaluate_depth(
    request: DepthCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    content = request.content
    preview = content[:200]

    # 默认免费规则评估，不调用付费 LLM；用户显式选择 AI 深度评估时才计费
    if not request.use_ai:
        markers = ["我发现", "我验证", "因为", "所以", "例如", "反例", "但是", "总结", "我的做法", "结果"]
        hits = sum(1 for m in markers if m in content)
        score = min(1.0, 0.3 + hits * 0.08 + (0.2 if len(content) > 500 else 0.0))
        passed = score >= 0.5
        feedback = "本次为免费规则评估（未消耗余额）。如需更准确的判断，可切换为 AI 深度评估。"
        suggestions = [] if passed else ["补充个人经验或证据", "加入反证思考或行动意图"]

        log = DepthCheckLog(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            content_type=request.content_type,
            content_id=request.content_id,
            content_preview=preview,
            depth_score=score,
            is_passed=passed,
            feedback=feedback,
            suggestions=json.dumps(suggestions, ensure_ascii=False),
            model_used="rule-based",
        )
        db.add(log)
        db.commit()

        return DepthCheckResponse(
            depth_score=score,
            is_passed=passed,
            feedback=feedback,
            suggestions=suggestions,
        )

    prompt = f"""你是一位内容深度评估器。请评估下面这段内容的认知深度。

评分标准：
- 0.0-0.3：过于肤浅，只是信息罗列、情绪发泄或未经思考的观点。
- 0.4-0.6：有一定个人理解，但缺乏证据、推理或行动关联。
- 0.7-1.0：有清晰的概念、个人经验、反证思考或行动意图，值得长期保留。

待评估内容（类型：{request.content_type}）：
{content[:3000]}

请只返回 JSON：
{{
  "depth_score": 0.0-1.0,
  "is_passed": true/false（以 0.5 为通过线）,
  "feedback": "简短评估，100字以内",
  "suggestions": ["改进建议1", "改进建议2"]
}}
"""

    try:
        raw = await billed_chat_completion(
            db=db,
            user_id=current_user.id,
            model_id=request.preferred_model or "deepseek-v4-pro",
            task_type="analysis",
            prompt=prompt,
            system_prompt="You are a content depth evaluator. Always return valid JSON with keys depth_score, is_passed, feedback, suggestions.",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="AI 评估失败：模型暂时不可用，请稍后重试。")

    result = _safe_parse_llm_json(raw, {
        "depth_score": 0.0,
        "is_passed": False,
        "feedback": "AI 返回的评分格式无法解析，已按默认未通过处理，建议稍后重试。",
        "suggestions": ["请稍后重试", "可切换为免费规则评估"],
    })

    score = max(0.0, min(1.0, float(result.get("depth_score", 0.5))))
    passed = bool(result.get("is_passed", score >= 0.5))
    feedback = result.get("feedback", "")
    suggestions = result.get("suggestions", [])
    if not isinstance(suggestions, list):
        suggestions = []

    log = DepthCheckLog(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        content_type=request.content_type,
        content_id=request.content_id,
        content_preview=preview,
        depth_score=score,
        is_passed=passed,
        feedback=feedback,
        suggestions=json.dumps(suggestions, ensure_ascii=False),
        model_used=request.preferred_model or "deepseek-v4-pro",
    )
    db.add(log)
    db.commit()

    return DepthCheckResponse(
        depth_score=score,
        is_passed=passed,
        feedback=feedback,
        suggestions=suggestions,
    )


@router.get("/depth-check/logs", response_model=List[DepthCheckLogResponse], summary="List depth check logs")
async def list_depth_check_logs(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logs = db.query(DepthCheckLog).filter(
        DepthCheckLog.user_id == current_user.id
    ).order_by(DepthCheckLog.created_at.desc()).limit(limit).all()
    return [
        DepthCheckLogResponse(
            id=log.id,
            user_id=log.user_id,
            content_type=log.content_type,
            content_id=log.content_id,
            content_preview=log.content_preview,
            depth_score=log.depth_score,
            is_passed=log.is_passed,
            feedback=log.feedback,
            suggestions=_json_list_field(log.suggestions),
            model_used=log.model_used,
            created_at=log.created_at,
        )
        for log in logs
    ]


# ---------- Evolution Reflection ----------

def _build_reflection_response(r: EvolutionReflection) -> dict:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "title": r.title,
        "discomfort_level": r.discomfort_level,
        "pain_description": r.pain_description,
        "joy_description": r.joy_description,
        "learning": r.learning,
        "is_true_evolution": r.is_true_evolution,
        "related_content_type": r.related_content_type,
        "related_content_id": r.related_content_id,
        "brain_side": r.brain_side,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


@router.get("/evolution-reflections", response_model=List[EvolutionReflectionResponse], summary="List evolution reflections")
async def list_evolution_reflections(
    brain_side: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(EvolutionReflection).filter(EvolutionReflection.user_id == current_user.id)
    if brain_side and brain_side != "both":
        query = query.filter(EvolutionReflection.brain_side == brain_side)
    reflections = query.order_by(EvolutionReflection.created_at.desc()).all()
    return [_build_reflection_response(r) for r in reflections]


@router.post("/evolution-reflections", response_model=EvolutionReflectionResponse, status_code=status.HTTP_201_CREATED, summary="Create evolution reflection")
async def create_evolution_reflection(
    data: EvolutionReflectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    reflection = EvolutionReflection(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=data.title,
        discomfort_level=data.discomfort_level,
        pain_description=data.pain_description,
        joy_description=data.joy_description,
        learning=data.learning,
        is_true_evolution=data.is_true_evolution,
        related_content_type=data.related_content_type,
        related_content_id=data.related_content_id,
        brain_side=data.brain_side or "personal",
    )
    db.add(reflection)
    db.commit()
    db.refresh(reflection)
    return _build_reflection_response(reflection)


@router.get("/evolution-reflections/{reflection_id}", response_model=EvolutionReflectionResponse, summary="Get evolution reflection")
async def get_evolution_reflection(
    reflection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    r = db.query(EvolutionReflection).filter(
        EvolutionReflection.id == reflection_id,
        EvolutionReflection.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reflection not found")
    return _build_reflection_response(r)


@router.put("/evolution-reflections/{reflection_id}", response_model=EvolutionReflectionResponse, summary="Update evolution reflection")
async def update_evolution_reflection(
    reflection_id: str,
    data: EvolutionReflectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    r = db.query(EvolutionReflection).filter(
        EvolutionReflection.id == reflection_id,
        EvolutionReflection.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reflection not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(r, field, value)
    r.updated_at = datetime.now()
    db.commit()
    db.refresh(r)
    return _build_reflection_response(r)


@router.delete("/evolution-reflections/{reflection_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete evolution reflection")
async def delete_evolution_reflection(
    reflection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    r = db.query(EvolutionReflection).filter(
        EvolutionReflection.id == reflection_id,
        EvolutionReflection.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reflection not found")
    db.delete(r)
    db.commit()
    return None


@router.post("/evolution-reflections/analyze", response_model=EvolutionAnalysisResponse, summary="Analyze evolution reflections with AI")
async def analyze_evolution_reflections(
    request: EvolutionAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(EvolutionReflection).filter(EvolutionReflection.user_id == current_user.id)
    if request.brain_side and request.brain_side != "both":
        query = query.filter(EvolutionReflection.brain_side == request.brain_side)
    reflections = query.order_by(EvolutionReflection.created_at.desc()).limit(30).all()

    total = len(reflections)
    true_count = sum(1 for r in reflections if r.is_true_evolution)
    ratio = true_count / total if total else 0.0

    lines = []
    for r in reflections:
        lines.append(
            f"- 标题：{r.title}\n  不适等级：{r.discomfort_level}\n  痛苦：{(r.pain_description or '')[:100]}\n  喜悦：{(r.joy_description or '')[:100]}\n  收获：{(r.learning or '')[:100]}\n  是否真进化：{'是' if r.is_true_evolution else '否'}"
        )

    prompt = f"""你是一位成长教练。请基于用户最近的「真进化 vs 伪成熟」反思记录，给出整体评估。

反思记录（共 {total} 条，真进化比例 {ratio:.0%}）：
{chr(10).join(lines) or "暂无记录"}

请只返回 JSON：
{{
  "summary": "整体判断，100字以内",
  "patterns": ["发现的模式1", "模式2"],
  "warnings": ["伪成熟信号1"],
  "next_steps": ["下一步建议1"]
}}
"""

    try:
        raw = await billed_chat_completion(
            db=db,
            user_id=current_user.id,
            model_id=request.preferred_model or "deepseek-v4-pro",
            task_type="analysis",
            prompt=prompt,
            system_prompt="You are a growth coach. Always return valid JSON with keys summary, patterns, warnings, next_steps.",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="AI 分析失败：模型暂时不可用，请稍后重试。")

    result = _safe_parse_llm_json(raw, {
        "summary": "AI 返回的分析格式无法解析，请稍后重试。",
        "patterns": [],
        "warnings": [],
        "next_steps": [],
    })

    return EvolutionAnalysisResponse(
        summary=result.get("summary", ""),
        true_evolution_ratio=ratio,
        patterns=result.get("patterns", []) or [],
        warnings=result.get("warnings", []) or [],
        next_steps=result.get("next_steps", []) or [],
    )


# ---------- Mood & Location ----------

@router.get("/mood-location", response_model=MoodLocationResponse, summary="Aggregate mood and location from capsules")
async def aggregate_mood_location(
    brain_side: Optional[str] = Query("both", description="Filter by brain side: personal / network / both"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Capsule).filter(
        Capsule.user_id == current_user.id,
        Capsule.status == "active"
    ).filter(
        (Capsule.mood_emotion != None) |
        (Capsule.mood_location != None) |
        (Capsule.mood_tags != None)
    )
    if brain_side and brain_side != "both":
        query = query.filter(Capsule.brain_side == brain_side)

    capsules = query.order_by(Capsule.created_at.desc()).limit(limit).all()

    mood_dist: dict = {}
    location_dist: dict = {}
    items = []
    for c in capsules:
        mood = c.mood_emotion or "未标注"
        loc = c.mood_location or "未标注"
        mood_dist[mood] = mood_dist.get(mood, 0) + 1
        location_dist[loc] = location_dist.get(loc, 0) + 1
        items.append(MoodLocationItem(
            id=str(uuid.uuid4()),
            capsule_id=c.id,
            brain_side=c.brain_side or "personal",
            sealed_at=c.sealed_at,
            mood_emotion=c.mood_emotion,
            mood_intensity=c.mood_intensity,
            mood_energy_level=c.mood_energy_level,
            mood_tags=_json_list_field(c.mood_tags),
            mood_trigger=c.mood_trigger,
            mood_weather=c.mood_weather,
            mood_location=c.mood_location,
            content_preview=(c.content_body or "")[:120],
            created_at=c.created_at,
        ))

    return MoodLocationResponse(
        items=items,
        stats=MoodLocationStats(
            mood_distribution=mood_dist,
            location_distribution=location_dist,
            total=len(items),
        ),
    )
