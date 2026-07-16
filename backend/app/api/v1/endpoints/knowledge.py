from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import uuid
import json
from datetime import datetime, timedelta
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_knowledge_input
from app.models.base import User, KnowledgeUnit, content_tags
from app.schemas.knowledge import (
    KnowledgeUnitCreate, KnowledgeUnitUpdate, KnowledgeUnitResponse, CounterEvidenceCreate,
    SourceInfoResponse, DomainCredibilityResponse
)
from app.services.llm_billing_service import billed_chat_completion
from app.services import tag_service
from app.api.v1.endpoints.graph import auto_link_knowledge

router = APIRouter()


class VerifyRequest(BaseModel):
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


def _estimate_density(text: str) -> float:
    """Simple heuristic: more first-person practice markers = higher density."""
    if not text:
        return 0.0
    markers = ["我发现", "我验证了", "我的做法", "我试了一下", "结果", "学到", "I found", "I verified", "I tried", "my approach"]
    score = sum(1 for m in markers if m in text) / len(markers)
    return min(score * 2, 1.0)


def _calculate_value_score(unit: KnowledgeUnit) -> float:
    import math
    density = _estimate_density(unit.content_raw or "")
    frequency = math.log1p(unit.invoke_count or 0)
    depth = unit.practice_depth or 0
    return round(density * frequency * depth, 2)


def _build_knowledge_response(unit: KnowledgeUnit, db: Session) -> dict:
    try:
        attached_practice_ids = json.loads(unit.attached_practice_ids or '[]') if unit.attached_practice_ids else []
    except json.JSONDecodeError:
        attached_practice_ids = []
    return {
        "id": unit.id,
        "user_id": unit.user_id,
        "brain_side": unit.brain_side,
        "content_raw": unit.content_raw,
        "content_processed": unit.content_processed,
        "content_type": unit.content_type,
        "content_confidence": unit.content_confidence,
        "source_url": unit.source_url,
        "source_title": unit.source_title,
        "source_type": unit.source_type,
        "source_author": unit.source_author,
        "source_publish_date": unit.source_publish_date,
        "source_access_date": unit.source_access_date,
        "source_credibility_score": unit.source_credibility_score,
        "source_bias_indicator": unit.source_bias_indicator,
        "source_funding_source": unit.source_funding_source,
        "verification_status": unit.verification_status,
        "verification_consensus": unit.verification_consensus,
        "verification_history": unit.verification_history,
        "last_verified": unit.last_verified,
        "next_scheduled": unit.next_scheduled,
        "timeliness_status": unit.timeliness_status,
        "timeliness_half_life": unit.timeliness_half_life,
        "timeliness_deprecation_warning": unit.timeliness_deprecation_warning,
        "trust_level": unit.trust_level,
        "first_seen": unit.first_seen,
        "last_reviewed": unit.last_reviewed,
        "review_count": unit.review_count,
        "origin_type": unit.origin_type or "book_excerpt",
        "invoke_count": unit.invoke_count or 0,
        "last_invoked_at": unit.last_invoked_at,
        "practice_depth": unit.practice_depth or 0,
        "personal_relevance_score": unit.personal_relevance_score if unit.personal_relevance_score is not None else 0.3,
        "evolution_stage": unit.evolution_stage or "collected",
        "attached_practice_ids": attached_practice_ids,
        "value_score": _calculate_value_score(unit),
        "pipeline_stage": unit.pipeline_stage or "raw",
        "content_subtype": unit.content_subtype or "note",
        "source_id": unit.source_id,
        "source_content_type": unit.source_content_type,
        "tags": tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_KNOWLEDGE, unit.id),
        "created_at": unit.created_at,
        "updated_at": unit.updated_at,
    }

# Domain credibility scoring database
DOMAIN_REPUTATION = {
    "arxiv.org": {"score": 0.92, "reputation": "high", "factors": ["peer-reviewed preprints", "academic institution", "open access"]},
    "pubmed.ncbi.nlm.nih.gov": {"score": 0.95, "reputation": "high", "factors": ["NIH database", "peer-reviewed", "medical research"]},
    "nature.com": {"score": 0.94, "reputation": "high", "factors": ["top-tier journal", "peer-reviewed", "Springer Nature"]},
    "science.org": {"score": 0.94, "reputation": "high", "factors": ["top-tier journal", "peer-reviewed", "AAAS"]},
    "ieee.org": {"score": 0.90, "reputation": "high", "factors": ["professional organization", "peer-reviewed", "engineering standard"]},
    "acm.org": {"score": 0.90, "reputation": "high", "factors": ["professional organization", "peer-reviewed", "computer science"]},
    "wikipedia.org": {"score": 0.72, "reputation": "medium", "factors": ["crowdsourced", "editable", "general reference"]},
    "github.com": {"score": 0.78, "reputation": "medium", "factors": ["open source", "version controlled", "community reviewed"]},
    "medium.com": {"score": 0.55, "reputation": "medium", "factors": ["user-generated", "mixed editorial", "blog platform"]},
    "reddit.com": {"score": 0.35, "reputation": "low", "factors": ["anonymous", "user-generated", "no editorial control"]},
    "twitter.com": {"score": 0.30, "reputation": "low", "factors": ["social media", "unverified", "ephemeral"]},
    "x.com": {"score": 0.30, "reputation": "low", "factors": ["social media", "unverified", "ephemeral"]},
    "youtube.com": {"score": 0.45, "reputation": "low", "factors": ["user-generated video", "algorithm-driven", "mixed quality"]},
    "news.ycombinator.com": {"score": 0.60, "reputation": "medium", "factors": ["tech community", "discussion-driven", "unverified claims"]},
    "techcrunch.com": {"score": 0.70, "reputation": "medium", "factors": ["tech journalism", "editorial review", "opinion-heavy"]},
    "theguardian.com": {"score": 0.82, "reputation": "high", "factors": ["established newspaper", "editorial review", "independent"]},
    "nytimes.com": {"score": 0.83, "reputation": "high", "factors": ["established newspaper", "editorial review", "fact-checking"]},
    "reuters.com": {"score": 0.85, "reputation": "high", "factors": ["news agency", "editorial standards", "global coverage"]},
    "bloomberg.com": {"score": 0.82, "reputation": "high", "factors": ["financial news", "editorial review", "data-driven"]},
    "forbes.com": {"score": 0.65, "reputation": "medium", "factors": ["business journalism", "contributor model", "mixed editorial"]},
    "cnn.com": {"score": 0.72, "reputation": "medium", "factors": ["mainstream media", "editorial review", "sensationalism risk"]},
    "foxnews.com": {"score": 0.60, "reputation": "medium", "factors": ["mainstream media", "editorial bias", "political lean"]},
    "msnbc.com": {"score": 0.60, "reputation": "medium", "factors": ["mainstream media", "editorial bias", "political lean"]},
    "breitbart.com": {"score": 0.25, "reputation": "low", "factors": ["partisan outlet", "questionable sourcing", "conspiracy content"]},
    "infowars.com": {"score": 0.10, "reputation": "very low", "factors": ["conspiracy theories", "disinformation", "legal issues"]},
}

DEFAULT_DOMAIN_SCORE = {"score": 0.50, "reputation": "unknown", "factors": ["unknown domain", "no editorial track record", "unverified"]}


def _extract_domain(url: Optional[str]) -> str:
    if not url:
        return ""
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    except Exception:
        return ""


def _get_domain_credibility(url: Optional[str]) -> dict:
    domain = _extract_domain(url)
    if not domain:
        return DEFAULT_DOMAIN_SCORE
    # Check exact match
    if domain in DOMAIN_REPUTATION:
        return DOMAIN_REPUTATION[domain]
    # Check suffix match (e.g., blog.nature.com -> nature.com)
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        suffix = ".".join(parts[i:])
        if suffix in DOMAIN_REPUTATION:
            return DOMAIN_REPUTATION[suffix]
    return DEFAULT_DOMAIN_SCORE


async def _run_llm_verification(
    content: str,
    source_url: Optional[str],
    preferred_model: Optional[str] = None,
    db: Session = None,
    user_id: str = None,
) -> dict:
    """Call LLM service to verify knowledge content."""
    domain_cred = _get_domain_credibility(source_url)
    domain_hint = f"\nSource domain credibility: {domain_cred['reputation']} (score: {domain_cred['score']}). Factors: {', '.join(domain_cred['factors'])}." if source_url else ""

    prompt = f'''You are a knowledge verification assistant. Analyze the following claim or knowledge unit and return a structured JSON assessment.

Content to verify:
"""
{content}
"""
{domain_hint}

Return ONLY a JSON object with exactly these keys (no markdown formatting, no extra text):
{{
  "confidence": <float between 0.0 and 1.0>,
  "bias_indicators": [<list of strings describing detected biases>],
  "source_reliability": <float between 0.0 and 1.0>,
  "verdict": "confirmed" | "disputed" | "debunked",
  "reasoning": "<brief explanation of the assessment>"
}}

Rules:
- confidence: overall factual confidence based on clarity, specificity, and consistency with general knowledge
- bias_indicators: detect confirmation bias, political lean, emotional language, cherry-picking, unrepresentative examples, etc.
- source_reliability: if no source URL is provided, score is 0.0; otherwise use the domain credibility score
- verdict: confirmed = high confidence and no major issues; disputed = significant uncertainty or bias; debunked = contradicts known facts or highly unreliable
'''

    try:
        raw_result = await billed_chat_completion(
            db=db,
            user_id=user_id,
            model_id=preferred_model or "deepseek-v4-pro",
            task_type="verification",
            prompt=prompt,
            system_prompt="You are a strict knowledge verification engine. Always return valid JSON.",
        )
        
        # Extract JSON from response (handle markdown code blocks)
        json_str = raw_result
        if "```json" in raw_result:
            json_str = raw_result.split("```json")[1].split("```")[0].strip()
        elif "```" in raw_result:
            json_str = raw_result.split("```")[1].split("```")[0].strip()
        
        result = json.loads(json_str)
        
        # Validate and normalize
        confidence = max(0.0, min(1.0, float(result.get("confidence", 0.5))))
        source_reliability = max(0.0, min(1.0, float(result.get("source_reliability", 0.0))))
        verdict = result.get("verdict", "disputed")
        if verdict not in ("confirmed", "disputed", "debunked"):
            verdict = "disputed"
        bias_indicators = result.get("bias_indicators", []) or []
        if isinstance(bias_indicators, str):
            bias_indicators = [bias_indicators]
        reasoning = result.get("reasoning", "No reasoning provided.")
        
        return {
            "confidence": confidence,
            "bias_indicators": bias_indicators,
            "source_reliability": source_reliability,
            "verdict": verdict,
            "reasoning": reasoning,
        }
    except ValueError as e:
        if "余额不足" in str(e):
            raise HTTPException(status_code=402, detail=str(e))
        # Fall through to rule-based for other value errors
        fallback = _rule_based_verification(content, source_url)
        fallback["reasoning"] = f"LLM verification failed ({str(e)}). Fallback: {fallback['reasoning']}"
        return fallback
    except Exception as e:
        # Fallback to rule-based if LLM fails
        fallback = _rule_based_verification(content, source_url)
        fallback["reasoning"] = f"LLM verification failed ({str(e)}). Fallback: {fallback['reasoning']}"
        return fallback


def _rule_based_verification(content: str, source_url: Optional[str]) -> dict:
    """Simple rule-based fallback verification."""
    domain_cred = _get_domain_credibility(source_url)
    
    content_lower = content.lower()
    # Check for weasel words
    weasel_words = ["some say", "many believe", "it is known", "studies show", "experts claim", "reportedly", "allegedly"]
    weasel_count = sum(1 for w in weasel_words if w in content_lower)
    
    # Check for emotional language
    emotional_words = ["shocking", "outrageous", "disgusting", "amazing", "incredible", "unbelievable", "terrible"]
    emotional_count = sum(1 for w in emotional_words if w in content_lower)
    
    bias_indicators = []
    if weasel_count > 0:
        bias_indicators.append(f"Weasel words detected ({weasel_count})")
    if emotional_count > 0:
        bias_indicators.append(f"Emotional language detected ({emotional_count})")
    if not source_url:
        bias_indicators.append("No source provided")
    
    # Base confidence on source reliability and content quality
    base_confidence = domain_cred["score"] * 0.6
    if weasel_count > 2:
        base_confidence -= 0.2
    if emotional_count > 1:
        base_confidence -= 0.15
    if not source_url:
        base_confidence -= 0.3
    
    confidence = max(0.0, min(1.0, base_confidence + 0.2))  # Give some benefit of doubt
    source_reliability = domain_cred["score"] if source_url else 0.0
    
    if confidence > 0.75 and source_reliability > 0.7:
        verdict = "confirmed"
    elif confidence < 0.3 or source_reliability < 0.2:
        verdict = "debunked"
    else:
        verdict = "disputed"
    
    return {
        "confidence": confidence,
        "bias_indicators": bias_indicators,
        "source_reliability": source_reliability,
        "verdict": verdict,
        "reasoning": "Rule-based assessment: source credibility + linguistic analysis.",
    }


@router.get("/", response_model=List[KnowledgeUnitResponse], summary="List knowledge units", description="Get all knowledge units for the current user with optional tag filter.")
async def list_knowledge(
    status: Optional[str] = None,
    brain_side: Optional[str] = None,
    content_type: Optional[str] = None,
    source_domain: Optional[str] = None,
    evolution_stage: Optional[str] = None,
    origin_type: Optional[str] = None,
    min_relevance: Optional[float] = None,
    q: Optional[str] = None,
    tag_ids: Optional[str] = Query(None, description="Filter by comma-separated tag IDs"),
    sort_by: Optional[str] = "created_at",
    sort_order: Optional[str] = "desc",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id)
    if status:
        query = query.filter(KnowledgeUnit.verification_status == status)
    if brain_side and brain_side != "both":
        query = query.filter(KnowledgeUnit.brain_side == brain_side)
    if content_type:
        query = query.filter(KnowledgeUnit.content_type == content_type)
    if source_domain:
        query = query.filter(KnowledgeUnit.source_url.ilike(f"%{source_domain}%"))
    if evolution_stage:
        query = query.filter(KnowledgeUnit.evolution_stage == evolution_stage)
    if origin_type:
        query = query.filter(KnowledgeUnit.origin_type == origin_type)
    if min_relevance is not None:
        query = query.filter(KnowledgeUnit.personal_relevance_score >= min_relevance)
    if q:
        query = query.filter(KnowledgeUnit.content_raw.ilike(f"%{q}%"))

    if tag_ids:
        tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if tag_id_list:
            from sqlalchemy import and_
            query = query.join(
                content_tags,
                and_(
                    content_tags.c.content_id == KnowledgeUnit.id,
                    content_tags.c.content_type == tag_service.CONTENT_TYPE_KNOWLEDGE,
                    content_tags.c.tag_id.in_(tag_id_list)
                )
            ).distinct()
    
    # Sorting
    # value_score is computed in Python, so it is handled after fetching.
    sort_column = {
        "created_at": KnowledgeUnit.created_at,
        "updated_at": KnowledgeUnit.updated_at,
        "verification_consensus": KnowledgeUnit.verification_consensus,
        "verification_status": KnowledgeUnit.verification_status,
        "invoke_count": KnowledgeUnit.invoke_count,
        "practice_depth": KnowledgeUnit.practice_depth,
        "personal_relevance_score": KnowledgeUnit.personal_relevance_score,
    }.get(sort_by, KnowledgeUnit.created_at)

    if sort_by != "value_score":
        if sort_order == "asc":
            query = query.order_by(sort_column.asc())
        else:
            query = query.order_by(sort_column.desc())

    units = query.all()
    responses = [_build_knowledge_response(u, db) for u in units]
    if sort_by == "value_score":
        reverse = sort_order != "asc"
        responses.sort(key=lambda x: x["value_score"], reverse=reverse)
    return responses

@router.post("/", response_model=KnowledgeUnitResponse, status_code=status.HTTP_201_CREATED, summary="Add knowledge unit", description="Add a new knowledge unit.")
async def add_knowledge(
    unit_data: KnowledgeUnitCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # XSS sanitization
    safe_content, safe_url, safe_title = sanitize_knowledge_input(
        unit_data.content_raw, unit_data.source_url, unit_data.source_title
    )
    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=unit_data.brain_side or 'network',
        content_raw=safe_content,
        content_type=unit_data.content_type,
        source_url=safe_url,
        source_title=safe_title,
        source_type=unit_data.source_type,
        source_author=unit_data.source_author,
        source_publish_date=unit_data.source_publish_date,
        source_credibility_score=unit_data.source_credibility_score,
        source_bias_indicator=unit_data.source_bias_indicator,
        source_funding_source=unit_data.source_funding_source,
        verification_status='unverified',
        trust_level='tentative',
        verification_history='[]',
        origin_type=unit_data.origin_type.value if unit_data.origin_type else "book_excerpt",
        practice_depth=unit_data.practice_depth if unit_data.practice_depth is not None else 0,
        personal_relevance_score=unit_data.personal_relevance_score if unit_data.personal_relevance_score is not None else 0.3,
        evolution_stage=unit_data.evolution_stage.value if unit_data.evolution_stage else "collected",
        pipeline_stage=unit_data.pipeline_stage.value if unit_data.pipeline_stage else "raw",
        content_subtype=unit_data.content_subtype.value if unit_data.content_subtype else "note",
        source_id=unit_data.source_id,
        source_content_type=unit_data.source_content_type,
        attached_practice_ids='[]',
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)

    # Set tags
    if unit_data.tags is not None:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
            content_id=unit.id,
            user_id=current_user.id,
            tag_inputs=unit_data.tags,
        )
        db.commit()
        db.refresh(unit)
    
    # Auto-link graph edges
    try:
        await auto_link_knowledge(db, unit, current_user.id)
        db.commit()
    except Exception as e:
        print(f"Auto-link failed for knowledge {unit.id}: {e}")
    
    return _build_knowledge_response(unit, db)


@router.get("/stats", summary="Knowledge statistics", description="Get knowledge base statistics grouped by brain side.")
async def get_knowledge_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    def side_stats(side: str):
        base = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id)
        if side != "both":
            base = base.filter(KnowledgeUnit.brain_side == side)
        total = base.count()
        verified = base.filter(KnowledgeUnit.verification_status == 'confirmed').count()
        disputed = base.filter(KnowledgeUnit.verification_status == 'disputed').count()
        debunked = base.filter(KnowledgeUnit.verification_status == 'debunked').count()
        unverified = base.filter(KnowledgeUnit.verification_status == 'unverified').count()
        checking = base.filter(KnowledgeUnit.verification_status == 'checking').count()
        outdated = base.filter(KnowledgeUnit.verification_status == 'outdated').count()
        avg_confidence = db.query(func.avg(KnowledgeUnit.verification_consensus)).filter(
            KnowledgeUnit.user_id == current_user.id,
            KnowledgeUnit.brain_side == side if side != "both" else True,
            KnowledgeUnit.verification_consensus != None
        ).scalar() or 0
        return {
            "total": total,
            "verified": verified,
            "disputed": disputed,
            "debunked": debunked,
            "unverified": unverified,
            "checking": checking,
            "outdated": outdated,
            "average_confidence": round(float(avg_confidence), 2),
        }

    return {
        "personal": side_stats("personal"),
        "network": side_stats("network"),
        "both": side_stats("both"),
    }


@router.get("/counter-evidence", response_model=List[KnowledgeUnitResponse], summary="Counter-evidence wall", description="Get knowledge units with counter-evidence or disputed/debunked status.")
async def list_counter_evidence(
    brain_side: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.verification_status.in_(['disputed', 'debunked', 'outdated'])
    )
    if brain_side and brain_side != "both":
        query = query.filter(KnowledgeUnit.brain_side == brain_side)
    units = query.order_by(KnowledgeUnit.updated_at.desc()).all()
    return [_build_knowledge_response(u, db) for u in units]


@router.get("/timeliness", response_model=List[KnowledgeUnitResponse], summary="Timeliness monitor", description="Get knowledge units sorted by timeliness status and next scheduled verification.")
async def list_timeliness(
    brain_side: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id)
    if brain_side and brain_side != "both":
        query = query.filter(KnowledgeUnit.brain_side == brain_side)
    units = query.order_by(
        KnowledgeUnit.timeliness_status.asc().nullslast(),
        KnowledgeUnit.next_scheduled.asc().nullslast(),
        KnowledgeUnit.created_at.desc()
    ).all()
    return [_build_knowledge_response(u, db) for u in units]


@router.get("/sources", summary="Source traceability", description="Aggregate knowledge units by source domain.")
async def list_sources(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    units = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.source_url != None
    ).all()

    domains: dict[str, dict[str, Any]] = {}
    for u in units:
        domain = _extract_domain(u.source_url)
        if not domain:
            continue
        if domain not in domains:
            cred = _get_domain_credibility(u.source_url)
            domains[domain] = {
                "domain": domain,
                "count": 0,
                "avg_verification_consensus": 0.0,
                "avg_source_credibility": 0.0,
                "reputation": cred.get("reputation", "unknown"),
                "factors": cred.get("factors", []),
            }
        domains[domain]["count"] += 1
        domains[domain]["avg_verification_consensus"] += u.verification_consensus or 0
        domains[domain]["avg_source_credibility"] += u.source_credibility_score or 0

    result = []
    for d in domains.values():
        count = d["count"]
        d["avg_verification_consensus"] = round(d["avg_verification_consensus"] / count, 1)
        d["avg_source_credibility"] = round(d["avg_source_credibility"] / count, 1)
        result.append(d)
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


@router.get("/{unit_id}", response_model=KnowledgeUnitResponse, summary="Get knowledge unit", description="Get a specific knowledge unit.")
async def get_knowledge(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unit = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id, KnowledgeUnit.user_id == current_user.id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Knowledge unit not found")
    # Opening a knowledge unit counts as an invocation ("调用") signal.
    # Debounced: re-opens within 30 minutes don't re-count (avoids refocus/refetch inflation).
    now = datetime.now()
    if not unit.last_invoked_at or (now - unit.last_invoked_at) > timedelta(minutes=30):
        unit.invoke_count = (unit.invoke_count or 0) + 1
        unit.last_invoked_at = now
        db.commit()
    return _build_knowledge_response(unit, db)


@router.put("/{unit_id}", response_model=KnowledgeUnitResponse, summary="Update knowledge unit", description="Update a knowledge unit by ID.")
async def update_knowledge(
    unit_id: str,
    unit_data: KnowledgeUnitUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unit = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id, KnowledgeUnit.user_id == current_user.id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Knowledge unit not found")
    
    if unit_data.content_raw is not None:
        safe_content, safe_url, safe_title = sanitize_knowledge_input(unit_data.content_raw, unit_data.source_url, unit_data.source_title)
        unit.content_raw = safe_content
        if safe_url is not None:
            unit.source_url = safe_url
        if safe_title is not None:
            unit.source_title = safe_title
    if unit_data.content_processed is not None:
        unit.content_processed = unit_data.content_processed
    if unit_data.content_type is not None:
        unit.content_type = unit_data.content_type
    if unit_data.source_type is not None:
        unit.source_type = unit_data.source_type
    if unit_data.source_author is not None:
        unit.source_author = unit_data.source_author
    if unit_data.source_publish_date is not None:
        unit.source_publish_date = unit_data.source_publish_date
    if unit_data.source_credibility_score is not None:
        unit.source_credibility_score = unit_data.source_credibility_score
    if unit_data.source_bias_indicator is not None:
        unit.source_bias_indicator = unit_data.source_bias_indicator
    if unit_data.source_funding_source is not None:
        unit.source_funding_source = unit_data.source_funding_source
    if unit_data.origin_type is not None:
        unit.origin_type = unit_data.origin_type.value
    if unit_data.practice_depth is not None:
        unit.practice_depth = unit_data.practice_depth
    if unit_data.personal_relevance_score is not None:
        unit.personal_relevance_score = unit_data.personal_relevance_score
    if unit_data.evolution_stage is not None:
        unit.evolution_stage = unit_data.evolution_stage.value
    if unit_data.pipeline_stage is not None:
        unit.pipeline_stage = unit_data.pipeline_stage.value
    if unit_data.content_subtype is not None:
        unit.content_subtype = unit_data.content_subtype.value
    if unit_data.source_id is not None:
        unit.source_id = unit_data.source_id
    if unit_data.source_content_type is not None:
        unit.source_content_type = unit_data.source_content_type
    if unit_data.tags is not None:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
            content_id=unit.id,
            user_id=current_user.id,
            tag_inputs=unit_data.tags,
        )

    unit.updated_at = datetime.now()
    db.commit()
    db.refresh(unit)
    
    try:
        await auto_link_knowledge(db, unit, current_user.id)
        db.commit()
    except Exception as e:
        print(f"Auto-link failed for knowledge {unit.id}: {e}")
    
    return _build_knowledge_response(unit, db)


@router.patch("/{unit_id}", response_model=KnowledgeUnitResponse, summary="Partial update knowledge unit", description="Partially update a knowledge unit by ID.")
async def patch_knowledge(
    unit_id: str,
    unit_data: KnowledgeUnitUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return await update_knowledge(unit_id, unit_data, db, current_user)


@router.delete("/{unit_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete knowledge unit", description="Soft-delete a knowledge unit by setting status to deleted.")
async def delete_knowledge(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unit = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id, KnowledgeUnit.user_id == current_user.id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Knowledge unit not found")
    unit.status = "deleted"
    tag_service.delete_tags_for(db, tag_service.CONTENT_TYPE_KNOWLEDGE, unit_id)
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, unit_id)
    db.commit()
    return None


@router.post("/{unit_id}/verify", summary="Verify knowledge unit", description="Trigger LLM verification for a knowledge unit.")
async def verify_knowledge(
    unit_id: str,
    request: Optional[VerifyRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unit = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id, KnowledgeUnit.user_id == current_user.id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Knowledge unit not found")

    # Mark as checking
    unit.verification_status = 'checking'
    db.commit()

    # Run LLM verification
    result = await _run_llm_verification(
        unit.content_raw,
        unit.source_url,
        preferred_model=request.preferred_model if request else None,
        db=db,
        user_id=current_user.id,
    )
    
    # Update unit
    unit.verification_status = result["verdict"]
    unit.verification_consensus = round(result["confidence"] * 100, 2)
    unit.source_bias_indicator = json.dumps(result["bias_indicators"], ensure_ascii=False)
    unit.last_verified = datetime.now()
    unit.review_count += 1
    
    # Append verification history
    try:
        history = json.loads(unit.verification_history or '[]')
    except Exception:
        history = []
    
    history.append({
        "timestamp": datetime.now().isoformat(),
        "verdict": result["verdict"],
        "confidence": result["confidence"],
        "source_reliability": result["source_reliability"],
        "bias_indicators": result["bias_indicators"],
        "reasoning": result["reasoning"],
    })
    # Keep only last 20 entries
    history = history[-20:]
    unit.verification_history = json.dumps(history, ensure_ascii=False)
    
    db.commit()
    db.refresh(unit)
    
    # Re-compute auto links after verification
    try:
        await auto_link_knowledge(db, unit, current_user.id)
        db.commit()
    except Exception as e:
        print(f"Auto-link failed for knowledge {unit.id}: {e}")
    
    return {
        "unit_id": unit_id,
        "status": unit.verification_status,
        "consensus": unit.verification_consensus,
        "confidence": result["confidence"],
        "source_reliability": result["source_reliability"],
        "bias_indicators": result["bias_indicators"],
        "reasoning": result["reasoning"],
    }

@router.post("/{unit_id}/counter-evidence", summary="Submit counter evidence", description="Submit counter evidence for a knowledge unit.")
async def submit_counter_evidence(
    unit_id: str,
    evidence: CounterEvidenceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unit = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id, KnowledgeUnit.user_id == current_user.id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Knowledge unit not found")
    
    unit.verification_status = 'disputed'
    unit.trust_level = 'suspicious'
    
    # Append counter-evidence to history
    try:
        history = json.loads(unit.verification_history or '[]')
    except Exception:
        history = []
    history.append({
        "timestamp": datetime.now().isoformat(),
        "type": "counter_evidence",
        "evidence_text": evidence.evidence_text,
        "evidence_url": evidence.evidence_url,
        "source_authority": evidence.source_authority,
    })
    history = history[-20:]
    unit.verification_history = json.dumps(history, ensure_ascii=False)
    
    db.commit()
    db.refresh(unit)
    
    return {"unit_id": unit_id, "status": "disputed", "evidence_submitted": True}

@router.get("/{unit_id}/sources", response_model=SourceInfoResponse, summary="Get knowledge sources", description="Get full source chain for a knowledge unit.")
async def get_knowledge_sources(
    unit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unit = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id, KnowledgeUnit.user_id == current_user.id).first()
    if not unit:
        raise HTTPException(status_code=404, detail="Knowledge unit not found")
    
    domain_cred = _get_domain_credibility(unit.source_url)
    
    return SourceInfoResponse(
        source_url=unit.source_url,
        source_title=unit.source_title,
        source_author=unit.source_author,
        source_publish_date=unit.source_publish_date,
        source_credibility_score=unit.source_credibility_score,
        source_bias_indicator=unit.source_bias_indicator,
        source_funding_source=unit.source_funding_source,
        domain_credibility_score=domain_cred["score"],
        domain_reputation=domain_cred["reputation"],
    )

@router.get("/domain-credibility/{domain}", response_model=DomainCredibilityResponse, summary="Domain credibility", description="Get credibility score for a domain.")
async def get_domain_credibility(
    domain: str,
    _: User = Depends(get_current_user)
):
    result = _get_domain_credibility(f"https://{domain}")
    return DomainCredibilityResponse(
        domain=domain,
        credibility_score=result["score"],
        reputation=result["reputation"],
        factors=result["factors"],
    )
