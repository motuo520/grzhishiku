from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from typing import List, Optional, Literal
from datetime import datetime, timedelta
import uuid
import json
import math
import logging

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import (
    User, Note, KnowledgeUnit, BrowserClip, RssEntry, ReadLaterItem, Document,
    GraphEdge, Embedding, PipelineTransition
)
from app.schemas.note import NoteResponse
from app.schemas.knowledge import KnowledgeUnitResponse
from app.services.llm_service import chat_completion
from app.services import tag_service
from pydantic import BaseModel, Field

from app.services.embedding_service import embedding_service
from app.services.chunking import embed_document_chunks

router = APIRouter()

PIPELINE_STAGES = ["raw", "card", "extracted", "collided", "approved"]
VALID_CONTENT_TYPES = ["note", "knowledge", "clip", "rss", "read_later", "document"]

# Allowed forward transitions for pipeline items that are already in the pipeline.
# Rejection is handled by changing status, not by moving back to an earlier stage.
PIPELINE_TRANSITIONS = {
    "raw": ["card"],
    "card": ["extracted"],
    "extracted": ["collided"],
    "collided": ["approved"],
    "approved": [],
}


def _is_valid_transition(from_stage: str, to_stage: str) -> bool:
    return to_stage in PIPELINE_TRANSITIONS.get(from_stage, [])


class StageTransitionRequest(BaseModel):
    stage: Literal["raw", "card", "extracted", "collided", "approved"]


class ExtractResponse(BaseModel):
    source_id: str
    source_content_type: str
    concepts: List[dict]


class ExtractRequest(BaseModel):
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")


class CollisionRequest(BaseModel):
    concept_id: str
    preferred_model: Optional[str] = Field(None, description="Preferred LLM model identifier")
    # 显式指定碰撞对手（候选清单/自定义选择）：有值时跳过自动配对
    partner_id: Optional[str] = Field(None, description="Manually chosen collision partner concept id")


class CollisionCandidatesResponse(BaseModel):
    candidates: List[dict]  # [{content_id, title, similarity, pairing}]
    auto_pick: Optional[str]  # 不配对手时的默认对手（候选第一名）


@router.post("/concepts/collide/candidates", response_model=CollisionCandidatesResponse, summary="List collision partner candidates")
async def collision_candidates(
    request: CollisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """返回概念 A 的碰撞候选对手 top 5（图谱推荐/向量相似/最近兜底，同一套三级配对逻辑）。

    前端点「碰撞」先调它出候选给用户选，用户选定后带 partner_id 调 /concepts/collide——
    碰撞从「盲撞」变「选后撞」。
    """
    concept = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.id == request.concept_id,
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.content_subtype == "concept",
    ).first()
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")

    candidates, pairing = _find_collision_candidates(db, current_user.id, concept)
    top = [
        {"content_id": c["content_id"], "title": c.get("title", ""),
         "similarity": round(c["similarity"], 3), "pairing": pairing}
        for c in candidates[:5]
    ]
    return CollisionCandidatesResponse(
        candidates=top,
        auto_pick=top[0]["content_id"] if top else None,
    )


class CollisionResponse(BaseModel):
    collision_id: str
    concept_a: str
    concept_b: str
    similarity: float
    insight: str
    derivation: str
    pairing: str = "embedding"  # graphify | embedding | recent — how concept B was picked


class ReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    feedback: Optional[str] = None


class ReviewResponse(BaseModel):
    collision_id: str
    action: str
    new_stage: str


class PipelineStatsResponse(BaseModel):
    raw: int
    card: int
    extracted: int
    collided: int
    approved: int
    today: dict
    by_brain_side: dict


class PipelineItem(BaseModel):
    id: str
    content_type: str
    content_id: str
    content_subtype: Optional[str]
    title: Optional[str]
    content_raw: str
    content_processed: Optional[str]
    brain_side: str
    pipeline_stage: str
    source_url: Optional[str]
    source_title: Optional[str]
    # 概念/知识单元的原出处（抽取来源的 content_id/content_type，供前端「原出处」直达）
    source_id: Optional[str] = None
    source_content_type: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime]


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _get_content(db: Session, user_id: str, content_type: str, content_id: str):
    if content_type == "note":
        return db.query(Note).filter(Note.id == content_id, Note.user_id == user_id, Note.status == "active").first()
    elif content_type == "knowledge":
        return db.query(KnowledgeUnit).filter(KnowledgeUnit.id == content_id, KnowledgeUnit.user_id == user_id, KnowledgeUnit.status == "active").first()
    elif content_type == "clip":
        return db.query(BrowserClip).filter(BrowserClip.id == content_id, BrowserClip.user_id == user_id, BrowserClip.status == "active").first()
    elif content_type == "rss":
        return db.query(RssEntry).filter(RssEntry.id == content_id, RssEntry.user_id == user_id, RssEntry.status == "active").first()
    elif content_type == "read_later":
        return db.query(ReadLaterItem).filter(ReadLaterItem.id == content_id, ReadLaterItem.user_id == user_id, ReadLaterItem.item_status == "active").first()
    elif content_type == "document":
        return db.query(Document).filter(Document.id == content_id, Document.user_id == user_id, Document.doc_status == "active").first()
    return None


def _set_pipeline_stage(db: Session, user_id: str, content_type: str, content_id: str, stage: str):
    item = _get_content(db, user_id, content_type, content_id)
    if not item:
        return None
    if content_type in ("note",):
        item.pipeline_stage = stage
    elif content_type in ("knowledge",):
        item.pipeline_stage = stage
    else:
        # For clips/rss/read_later/documents, we don't have pipeline_stage column.
        # Instead, convert them to a knowledge unit in 'card' stage.
        return None
    item.updated_at = datetime.now()
    # Do not commit or refresh here; the caller manages the transaction.
    # Calling db.refresh() here would discard the pending pipeline_stage change.
    return item


async def _content_to_knowledge(
    db: Session,
    user_id: str,
    content_type: str,
    item,
    stage: str = "card",
) -> KnowledgeUnit:
    """Convert a raw content item (clip/rss/read_later/document/note) into a KnowledgeUnit card."""
    if content_type == "note":
        title = item.title
        content_raw = item.content
        source_url = None
        source_title = None
        brain_side = "personal"
    elif content_type == "clip":
        title = item.title
        content_raw = item.excerpt or item.full_text or item.title
        source_url = item.url
        source_title = item.title
        brain_side = "network"
    elif content_type == "rss":
        title = item.title
        content_raw = f"{item.title}\n\n{item.summary or item.content or ''}"
        source_url = item.link
        source_title = item.title
        brain_side = "network"
    elif content_type == "read_later":
        title = item.title
        content_raw = item.excerpt or item.full_text or item.title
        source_url = item.url
        source_title = item.title
        brain_side = "network"
    elif content_type == "document":
        title = item.title
        content_raw = item.content_text or item.original_name
        source_url = None
        source_title = item.original_name
        brain_side = "network"
    else:
        title = getattr(item, "title", "") or getattr(item, "content_raw", "")[:50]
        content_raw = getattr(item, "content_raw", "") or getattr(item, "content", "") or ""
        source_url = getattr(item, "source_url", None)
        source_title = getattr(item, "source_title", None)
        brain_side = getattr(item, "brain_side", "network")

    # 查重合并：已有高度相似的知识单元时更新旧单元，不再新建
    from app.services.knowledge_dedup import find_similar_unit, merge_into_unit, reembed_unit
    merged_unit = await find_similar_unit(db, user_id, title, content_raw[:50000])
    if merged_unit is not None:
        ku = merge_into_unit(merged_unit, content_raw[:50000])
        ku.merged = True  # 瞬时标记，供调用方/响应使用
        db.add(ku)
    else:
        ku = KnowledgeUnit(
            id=str(uuid.uuid4()),
            user_id=user_id,
            brain_side=brain_side,
            content_raw=content_raw[:50000],
            content_type=content_type,
            source_id=str(item.id),
            source_url=source_url,
            source_title=source_title or title,
            source_type=content_type,
            verification_status="unverified",
            trust_level="tentative",
            verification_history='[]',
            pipeline_stage=stage,
            origin_type="book_excerpt" if brain_side == "network" else "reflection",
            attached_practice_ids='[]',
        )
        ku.merged = False
        db.add(ku)

    # Mark the original external item as moved into the pipeline so it cannot be
    # re-imported / re-extracted repeatedly.
    if content_type == "clip" and hasattr(item, "pipeline_stage"):
        item.pipeline_stage = stage
    elif content_type == "rss" and hasattr(item, "pipeline_stage"):
        item.pipeline_stage = stage
    elif content_type == "read_later" and hasattr(item, "item_status"):
        item.item_status = "imported_to_knowledge"
        if hasattr(item, "knowledge_id"):
            item.knowledge_id = ku.id
    elif content_type == "document" and hasattr(item, "doc_status"):
        item.doc_status = "imported_to_knowledge"
        if hasattr(item, "knowledge_id"):
            item.knowledge_id = ku.id
    elif content_type == "note":
        # Notes already have pipeline_stage and were advanced by the caller.
        pass
    # 统一由外层调用方 commit，避免中途失败留下已提交脏数据
    db.flush()

    # Generate embedding asynchronously; failure should not block the pipeline.
    # 合并命中时内容已变化，删旧向量按新内容重算；否则按文档切块入库。
    try:
        if getattr(ku, "merged", False):
            await reembed_unit(ku)
        else:
            await embed_document_chunks(
                ku.content_raw,
                content_type="knowledge",
                doc_id=ku.id,
                user_id=user_id,
            )
    except Exception:
        logger = logging.getLogger(__name__)
        logger.exception(f"Failed to generate embedding for knowledge unit {ku.id}")

    return ku


def _restore_external_source(db: Session, ku: KnowledgeUnit):
    """根据 KnowledgeUnit 还原原始外部素材的未导入状态。"""
    content_type = ku.content_type
    user_id = ku.user_id
    item = None
    # 优先用 source_id（新数据会记录）
    if ku.source_id:
        if content_type == "clip":
            item = db.query(BrowserClip).filter(BrowserClip.id == ku.source_id, BrowserClip.user_id == user_id).first()
        elif content_type == "rss":
            item = db.query(RssEntry).filter(RssEntry.id == ku.source_id, RssEntry.user_id == user_id).first()
        elif content_type == "read_later":
            item = db.query(ReadLaterItem).filter(ReadLaterItem.id == ku.source_id, ReadLaterItem.user_id == user_id).first()
        elif content_type == "document":
            item = db.query(Document).filter(Document.id == ku.source_id, Document.user_id == user_id).first()
    # 兜底：用 URL / knowledge_id 查找旧数据
    if not item:
        if content_type == "clip":
            item = db.query(BrowserClip).filter(BrowserClip.user_id == user_id, BrowserClip.url == ku.source_url).first()
        elif content_type == "rss":
            item = db.query(RssEntry).filter(RssEntry.user_id == user_id, RssEntry.link == ku.source_url).first()
        elif content_type == "read_later":
            item = db.query(ReadLaterItem).filter(ReadLaterItem.user_id == user_id, ReadLaterItem.knowledge_id == ku.id).first()
        elif content_type == "document":
            item = db.query(Document).filter(Document.user_id == user_id, Document.knowledge_id == ku.id).first()
    if not item:
        return
    if content_type in ("clip", "rss") and hasattr(item, "pipeline_stage"):
        item.pipeline_stage = "raw"
    elif content_type == "read_later" and hasattr(item, "item_status"):
        item.item_status = "active"
        if hasattr(item, "knowledge_id"):
            item.knowledge_id = None
    elif content_type == "document" and hasattr(item, "doc_status"):
        item.doc_status = "active"
        if hasattr(item, "knowledge_id"):
            item.knowledge_id = None


def _delete_knowledge_unit(db: Session, ku: KnowledgeUnit):
    """软删除 KnowledgeUnit，并先还原对应的外部素材状态。"""
    _restore_external_source(db, ku)
    ku.status = "deleted"


def _delete_external_original(db: Session, content_type: str, item):
    """删除原始外部素材，并同步删除由其生成的 KnowledgeUnit。"""
    user_id = item.user_id
    if content_type == "clip":
        item.status = "deleted"
        db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == user_id,
            KnowledgeUnit.content_type == "clip",
            KnowledgeUnit.source_id == item.id,
        ).update({"status": "deleted"}, synchronize_session=False)
    elif content_type == "rss":
        item.status = "deleted"
        db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == user_id,
            KnowledgeUnit.content_type == "rss",
            KnowledgeUnit.source_id == item.id,
        ).update({"status": "deleted"}, synchronize_session=False)
    elif content_type == "read_later":
        item.item_status = "deleted"
        db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == user_id,
            KnowledgeUnit.content_type == "read_later",
            KnowledgeUnit.source_id == item.id,
        ).update({"status": "deleted"}, synchronize_session=False)
    elif content_type == "document":
        item.doc_status = "deleted"
        db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == user_id,
            KnowledgeUnit.content_type == "document",
            KnowledgeUnit.source_id == item.id,
        ).update({"status": "deleted"}, synchronize_session=False)


def _record_transition(
    db: Session,
    user_id: str,
    content_type: str,
    content_id: str,
    from_stage: str,
    to_stage: str,
    brain_side_before: Optional[str],
    brain_side_after: Optional[str],
    action: str = "transition",
):
    """Persist a pipeline stage/brainside transition for evolution tracking."""
    pt = PipelineTransition(
        id=str(uuid.uuid4()),
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        from_stage=from_stage,
        to_stage=to_stage,
        brain_side_before=brain_side_before,
        brain_side_after=brain_side_after,
        action=action,
    )
    db.add(pt)


@router.get("/stats", response_model=PipelineStatsResponse, summary="Pipeline stage statistics")
async def get_pipeline_stats(
    brain_side: Optional[str] = Query("both", pattern="^(personal|network|both)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return counts for each pipeline stage, filtered by brain side."""
    note_query = db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active")
    ku_query = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.status == "active")

    if brain_side == "personal":
        note_query = note_query.filter(Note.brain_side.in_(["personal", "both"]))
        ku_query = ku_query.filter(KnowledgeUnit.brain_side.in_(["personal", "both"]))
    elif brain_side == "network":
        note_query = note_query.filter(Note.brain_side.in_(["network", "both"]))
        ku_query = ku_query.filter(KnowledgeUnit.brain_side.in_(["network", "both"]))

    note_counts = {stage: note_query.filter(Note.pipeline_stage == stage).count() for stage in PIPELINE_STAGES}
    ku_counts = {stage: ku_query.filter(KnowledgeUnit.pipeline_stage == stage).count() for stage in PIPELINE_STAGES}

    # External raw items that have not yet been imported into the pipeline.
    external_raw = 0
    if brain_side in ("network", "both"):
        external_raw += db.query(BrowserClip).filter(
            BrowserClip.user_id == current_user.id,
            BrowserClip.status == "active",
            or_(BrowserClip.pipeline_stage == "raw", BrowserClip.pipeline_stage == None),
        ).count()
        external_raw += db.query(RssEntry).filter(
            RssEntry.user_id == current_user.id,
            RssEntry.status == "active",
            or_(RssEntry.pipeline_stage == "raw", RssEntry.pipeline_stage == None),
        ).count()
        external_raw += db.query(ReadLaterItem).filter(
            ReadLaterItem.user_id == current_user.id,
            ReadLaterItem.item_status == "active",
        ).count()
        external_raw += db.query(Document).filter(
            Document.user_id == current_user.id,
            Document.doc_status == "active",
        ).count()

    stats = {stage: note_counts.get(stage, 0) + ku_counts.get(stage, 0) for stage in PIPELINE_STAGES}
    stats["raw"] += external_raw
    # 与前端列表保持一致：碰撞阶段只统计真正的碰撞结果（collision_result），避免把
    # 仍留在 extracted 的源概念或历史脏数据算进去。
    stats["collided"] = note_counts.get("collided", 0) + ku_query.filter(
        KnowledgeUnit.pipeline_stage == "collided",
        KnowledgeUnit.content_subtype == "collision_result",
    ).count()

    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_cards = ku_query.filter(KnowledgeUnit.pipeline_stage == "card", KnowledgeUnit.created_at >= today_start).count()
    today_extracted = ku_query.filter(KnowledgeUnit.content_subtype == "concept", KnowledgeUnit.created_at >= today_start).count()
    today_collided = ku_query.filter(KnowledgeUnit.content_subtype == "collision_result", KnowledgeUnit.created_at >= today_start).count()

    # by_brain_side: count by the actual brain_side value on each record, not by table type.
    by_brain_side = {stage: {"personal": 0, "network": 0, "both": 0} for stage in PIPELINE_STAGES}
    for stage in PIPELINE_STAGES:
        by_brain_side[stage]["personal"] = (
            db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active", Note.pipeline_stage == stage, Note.brain_side == "personal").count()
            + db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.status == "active", KnowledgeUnit.pipeline_stage == stage, KnowledgeUnit.brain_side == "personal").count()
        )
        by_brain_side[stage]["network"] = (
            db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active", Note.pipeline_stage == stage, Note.brain_side == "network").count()
            + db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.status == "active", KnowledgeUnit.pipeline_stage == stage, KnowledgeUnit.brain_side == "network").count()
        )
        by_brain_side[stage]["both"] = (
            db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active", Note.pipeline_stage == stage, Note.brain_side == "both").count()
            + db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.status == "active", KnowledgeUnit.pipeline_stage == stage, KnowledgeUnit.brain_side == "both").count()
        )
    # External raw items are network-brained by definition.
    by_brain_side["raw"]["network"] += external_raw
    by_brain_side["raw"]["both"] = by_brain_side["raw"]["personal"] + by_brain_side["raw"]["network"] + by_brain_side["raw"]["both"]

    return PipelineStatsResponse(
        raw=stats.get("raw", 0),
        card=stats.get("card", 0),
        extracted=stats.get("extracted", 0),
        collided=stats.get("collided", 0),
        approved=stats.get("approved", 0),
        today={
            "new_cards": today_cards,
            "new_concepts": today_extracted,
            "new_collisions": today_collided,
        },
        by_brain_side=by_brain_side,
    )


@router.get("/items", response_model=List[PipelineItem], summary="List pipeline items by stage")
async def list_pipeline_items(
    stage: str = Query(..., pattern="^(raw|card|extracted|collided|approved)$"),
    brain_side: Optional[str] = Query("both", pattern="^(personal|network|both)$"),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return unified items for a specific pipeline stage."""
    results = []

    if stage == "raw":
        # Raw = unprocessed notes + external raw items
        if brain_side in ("personal", "both"):
            notes = db.query(Note).filter(
                Note.user_id == current_user.id,
                Note.status == "active",
                or_(Note.pipeline_stage == "raw", Note.pipeline_stage == None),
            ).limit(limit).all()
            for n in notes:
                results.append(PipelineItem(
                    id=f"note-{n.id}",
                    content_type="note",
                    content_id=n.id,
                    content_subtype=None,
                    title=n.title,
                    content_raw=n.content[:500],
                    content_processed=None,
                    brain_side=n.brain_side or "personal",
                    pipeline_stage="raw",
                    source_url=None,
                    source_title=None,
                    created_at=n.created_at,
                    updated_at=n.updated_at,
                ))
        if brain_side in ("network", "both"):
            clips = db.query(BrowserClip).filter(
                BrowserClip.user_id == current_user.id,
                BrowserClip.status == "active",
                or_(BrowserClip.pipeline_stage == "raw", BrowserClip.pipeline_stage == None),
            ).order_by(BrowserClip.created_at.desc()).limit(limit).all()
            for c in clips:
                results.append(PipelineItem(
                    id=f"clip-{c.id}",
                    content_type="clip",
                    content_id=c.id,
                    content_subtype=None,
                    title=c.title,
                    content_raw=(c.excerpt or c.full_text or c.title)[:500],
                    content_processed=None,
                    brain_side="network",
                    pipeline_stage="raw",
                    source_url=c.url,
                    source_title=c.title,
                    created_at=c.created_at,
                    updated_at=c.updated_at,
                ))
            rss = db.query(RssEntry).filter(
                RssEntry.user_id == current_user.id,
                RssEntry.status == "active",
                or_(RssEntry.pipeline_stage == "raw", RssEntry.pipeline_stage == None),
            ).order_by(RssEntry.created_at.desc()).limit(limit).all()
            for r in rss:
                results.append(PipelineItem(
                    id=f"rss-{r.id}",
                    content_type="rss",
                    content_id=r.id,
                    content_subtype=None,
                    title=r.title,
                    content_raw=(r.summary or r.content or r.title)[:500],
                    content_processed=None,
                    brain_side="network",
                    pipeline_stage="raw",
                    source_url=r.link,
                    source_title=r.title,
                    created_at=r.created_at,
                    updated_at=r.updated_at,
                ))
            read_later = db.query(ReadLaterItem).filter(
                ReadLaterItem.user_id == current_user.id,
                ReadLaterItem.item_status == "active",
            ).order_by(ReadLaterItem.created_at.desc()).limit(limit).all()
            for rl in read_later:
                results.append(PipelineItem(
                    id=f"read_later-{rl.id}",
                    content_type="read_later",
                    content_id=rl.id,
                    content_subtype=None,
                    title=rl.title,
                    content_raw=(rl.excerpt or rl.full_text or rl.title)[:500],
                    content_processed=None,
                    brain_side="network",
                    pipeline_stage="raw",
                    source_url=rl.url,
                    source_title=rl.title,
                    created_at=rl.created_at,
                    updated_at=rl.updated_at,
                ))
            docs = db.query(Document).filter(
                Document.user_id == current_user.id,
                Document.doc_status == "active",
            ).order_by(Document.created_at.desc()).limit(limit).all()
            for d in docs:
                results.append(PipelineItem(
                    id=f"document-{d.id}",
                    content_type="document",
                    content_id=d.id,
                    content_subtype=None,
                    title=d.title,
                    content_raw=(d.content_text or d.original_name)[:500],
                    content_processed=None,
                    brain_side="network",
                    pipeline_stage="raw",
                    source_url=None,
                    source_title=d.original_name,
                    created_at=d.created_at,
                    updated_at=d.updated_at,
                ))
        # Plugin imports and other external imports create KnowledgeUnit rows in 'raw' stage.
        # Include them so they are visible and can flow through the pipeline.
        ku_query = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == current_user.id,
            KnowledgeUnit.pipeline_stage == "raw",
            KnowledgeUnit.status == "active",
        )
        if brain_side != "both":
            ku_query = ku_query.filter(KnowledgeUnit.brain_side == brain_side)
        kus = ku_query.order_by(KnowledgeUnit.created_at.desc()).limit(limit).all()
        for k in kus:
            results.append(PipelineItem(
                id=f"knowledge-{k.id}",
                content_type="knowledge",
                content_id=k.id,
                content_subtype=k.content_subtype,
                title=k.source_title or k.content_raw[:50],
                content_raw=k.content_raw[:500],
                content_processed=k.content_processed,
                brain_side=k.brain_side or "network",
                pipeline_stage="raw",
                source_url=k.source_url,
                source_title=k.source_title,
                source_id=k.source_id,
                source_content_type=k.source_content_type,
                created_at=k.created_at,
                updated_at=k.updated_at,
            ))
    else:
        # For card/extracted/collided/approved, use notes + knowledge_units
        if brain_side in ("personal", "both"):
            notes = db.query(Note).filter(
                Note.user_id == current_user.id,
                Note.status == "active",
                Note.pipeline_stage == stage,
            ).limit(limit).all()
            for n in notes:
                results.append(PipelineItem(
                    id=f"note-{n.id}",
                    content_type="note",
                    content_id=n.id,
                    content_subtype=None,
                    title=n.title,
                    content_raw=n.content[:500],
                    content_processed=None,
                    brain_side=n.brain_side or "personal",
                    pipeline_stage=stage,
                    source_url=None,
                    source_title=None,
                    created_at=n.created_at,
                    updated_at=n.updated_at,
                ))
        # KnowledgeUnits (cards, concepts, collision results, etc.) carry their own
        # brain_side; include them for every filter, scoped by that brain_side.
        # Previously this was gated behind brain_side in ("network", "both"), which
        # hid personal concepts/cards from the personal view.
        ku_query = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == current_user.id,
            KnowledgeUnit.pipeline_stage == stage,
            KnowledgeUnit.status == "active",
        )
        # Cross-domain items (brain_side == "both", e.g. collision results) belong to
        # both brains, so surface them in the personal and network views as well.
        if brain_side == "personal":
            ku_query = ku_query.filter(KnowledgeUnit.brain_side.in_(["personal", "both"]))
        elif brain_side == "network":
            ku_query = ku_query.filter(KnowledgeUnit.brain_side.in_(["network", "both"]))
        kus = ku_query.order_by(KnowledgeUnit.created_at.desc()).limit(limit).all()
        for k in kus:
            results.append(PipelineItem(
                id=f"knowledge-{k.id}",
                content_type="knowledge",
                content_id=k.id,
                content_subtype=k.content_subtype,
                title=k.source_title or k.content_raw[:50],
                content_raw=k.content_raw[:500],
                content_processed=k.content_processed,
                brain_side=k.brain_side or "network",
                pipeline_stage=stage,
                source_url=k.source_url,
                source_title=k.source_title,
                source_id=k.source_id,
                source_content_type=k.source_content_type,
                created_at=k.created_at,
                updated_at=k.updated_at,
            ))

    results.sort(key=lambda x: x.created_at, reverse=True)
    return results[:limit]


@router.post("/{content_type}/{content_id}/stage", summary="Advance content to a pipeline stage")
async def transition_stage(
    content_type: str,
    content_id: str,
    request: StageTransitionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Move a content item to a specific pipeline stage."""
    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid content type")

    if content_type in ("note", "knowledge"):
        item = _get_content(db, current_user.id, content_type, content_id)
        if not item:
            raise HTTPException(status_code=404, detail="Content not found")
        old_stage = getattr(item, "pipeline_stage", "raw") or "raw"
        old_brain_side = getattr(item, "brain_side", "both")
        if not _is_valid_transition(old_stage, request.stage):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid stage transition: {old_stage} -> {request.stage}"
            )
        item = _set_pipeline_stage(db, current_user.id, content_type, content_id, request.stage)
        _record_transition(
            db, current_user.id, content_type, content_id,
            old_stage, request.stage, old_brain_side, item.brain_side,
        )
        db.commit()
        db.refresh(item)
        return {"success": True, "content_type": content_type, "content_id": content_id, "stage": request.stage}

    # For external raw items, convert to knowledge unit in target stage
    item = _get_content(db, current_user.id, content_type, content_id)
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")

    if request.stage in ("raw",):
        raise HTTPException(status_code=400, detail="External items cannot be moved back to raw")

    old_brain_side = getattr(item, "brain_side", "network")
    ku = await _content_to_knowledge(db, current_user.id, content_type, item, stage=request.stage)
    _record_transition(
        db, current_user.id, "knowledge", ku.id,
        "external", request.stage, old_brain_side, ku.brain_side,
        action="import",
    )
    db.commit()
    db.refresh(ku)
    return {"success": True, "content_type": "knowledge", "content_id": ku.id,
            "stage": request.stage, "merged": getattr(ku, "merged", False)}


@router.post("/{content_type}/{content_id}/revert", summary="Revert a pipeline item back to raw")
async def revert_pipeline_item(
    content_type: str,
    content_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """将卡片化/抽取/碰撞等阶段的内容退回为 raw。外部素材会恢复为未导入状态。"""
    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid content type")

    item = _get_content(db, current_user.id, content_type, content_id)
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")

    old_stage = getattr(item, "pipeline_stage", "raw") or "raw"
    old_brain_side = getattr(item, "brain_side", "both")

    if content_type == "note":
        item.pipeline_stage = "raw"
    elif content_type == "knowledge":
        # KnowledgeUnit.content_type 字段记录的是它来自哪种原始素材
        original_type = item.content_type
        if original_type in ("clip", "rss", "read_later", "document"):
            # 外部素材卡片化生成的 KU 退回时，恢复原始素材并删除该 KU，避免 raw 阶段重复
            _restore_external_source(db, item)
            item.status = "deleted"
        else:
            item.pipeline_stage = "raw"
            item.content_subtype = None
    else:
        raise HTTPException(status_code=400, detail="Revert only supports note or knowledge items")

    _record_transition(
        db, current_user.id, content_type, content_id,
        old_stage, "raw", old_brain_side, item.brain_side,
        action="revert",
    )
    db.commit()
    db.refresh(item)
    return {"success": True, "content_type": content_type, "content_id": content_id, "stage": "raw"}


@router.delete("/{content_type}/{content_id}", summary="Delete a pipeline item")
async def delete_pipeline_item(
    content_type: str,
    content_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除管线中的内容。若是外部素材卡片化生成的 KU，会同步恢复原始素材为可重新导入。"""
    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid content type")

    item = _get_content(db, current_user.id, content_type, content_id)
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")

    if content_type == "note":
        item.status = "deleted"
    elif content_type == "knowledge":
        _delete_knowledge_unit(db, item)
    elif content_type in ("clip", "rss"):
        _delete_external_original(db, content_type, item)
    elif content_type == "read_later":
        _delete_external_original(db, content_type, item)
    elif content_type == "document":
        _delete_external_original(db, content_type, item)

    db.commit()
    return {"success": True}


@router.post("/{content_type}/{content_id}/extract", response_model=ExtractResponse, summary="Extract concepts from content")
async def extract_concepts(
    content_type: str,
    content_id: str,
    request: ExtractRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Run AI extraction on a card and create concept knowledge units."""
    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid content type")

    item = _get_content(db, current_user.id, content_type, content_id)
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")

    old_stage = getattr(item, "pipeline_stage", "card") or "card"
    old_brain_side = getattr(item, "brain_side", "both")
    text = ""
    if content_type == "note":
        text = f"{item.title}\n\n{item.content}"
        item.pipeline_stage = "extracted"
    elif content_type == "knowledge":
        text = item.content_raw
        item.pipeline_stage = "extracted"
    else:
        # Convert to knowledge card first, then extract
        ku = await _content_to_knowledge(db, current_user.id, content_type, item, stage="extracted")
        text = ku.content_raw
        item = ku
        content_type = "knowledge"
        content_id = ku.id
        old_stage = "external"
        old_brain_side = ku.brain_side

    prompt = f"""分析以下知识卡片，提取 1-3 个核心学术/认知概念。

要求：
- 只提取真正跨学科、可复用的抽象概念
- 如果概念已存在，不要重复
- 只输出 JSON 数组本身，禁止任何解释、标题、编号、markdown 或代码块
- 返回格式：[{{"concept": "概念名", "definition": "一句话定义", "discipline": "所属学科"}}]
- 若确实没有可提取的跨学科概念，返回空数组 []

内容：
{text[:3000]}
"""

    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Extract concepts for {content_type}/{content_id}, text_length={len(text)}")

    user_settings = json.loads(current_user.settings or '{}')

    try:
        raw = await chat_completion(
            prompt=prompt,
            task_type="analysis",
            system_prompt="You are a knowledge extraction engine. Respond with ONLY a raw JSON array like [{\"concept\": \"...\", \"definition\": \"...\", \"discipline\": \"...\"}]. No markdown, no code fences, no commentary, no numbered lists. If nothing qualifies, return [].",
            preferred_model=request.preferred_model,
        )
        raw = raw.strip()
        logger.info(f"Extract concepts LLM raw response length={len(raw)} preview={raw[:200]!r}")

        if not raw:
            raise ValueError("LLM returned empty response")

        # Extract JSON from markdown code block if present
        json_str = raw
        if "```json" in raw:
            parts = raw.split("```json")
            if len(parts) > 1:
                json_str = parts[1].split("```")[0].strip()
        elif "```" in raw:
            parts = raw.split("```")
            if len(parts) > 1:
                json_str = parts[1].split("```")[0].strip()

        # If still not valid JSON, try to find the first JSON array/object
        if not json_str.startswith("[") and not json_str.startswith("{"):
            array_start = raw.find("[")
            array_end = raw.rfind("]")
            if array_start != -1 and array_end != -1 and array_end > array_start:
                json_str = raw[array_start:array_end + 1]
            else:
                obj_start = raw.find("{")
                obj_end = raw.rfind("}")
                if obj_start != -1 and obj_end != -1 and obj_end > obj_start:
                    json_str = raw[obj_start:obj_end + 1]

        try:
            concepts = json.loads(json_str)
        except (json.JSONDecodeError, ValueError):
            logger.warning(
                f"Extract concepts: could not parse JSON from LLM response for "
                f"{content_type}/{content_id}; raw_preview={raw[:300]!r}"
            )
            concepts = []
        if not isinstance(concepts, list):
            concepts = [concepts]

        created = []
        for c in concepts:
            if not isinstance(c, dict):
                continue
            concept_name = str(c.get('concept', '') or '').strip()
            definition = str(c.get('definition', '') or '').strip()
            if not concept_name:
                continue
            concept_text = f"{concept_name}: {definition}"
            if concept_text == ":":
                continue
            # Check duplicate by content similarity (simple substring)
            escaped_concept = concept_name.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            existing = db.query(KnowledgeUnit).filter(
                KnowledgeUnit.user_id == current_user.id,
                KnowledgeUnit.content_subtype == "concept",
                KnowledgeUnit.status == "active",
                KnowledgeUnit.content_raw.ilike(f"%{escaped_concept}%", escape='\\'),
            ).first()
            if existing:
                created.append({"id": existing.id, "concept": c.get("concept"), "definition": c.get("definition"), "existing": True})
                continue

            concept_brain_side = item.brain_side if content_type == "knowledge" else (item.brain_side or "personal")
            ku = KnowledgeUnit(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                brain_side=concept_brain_side,
                content_raw=concept_text[:5000],
                content_type="concept",
                content_subtype="concept",
                source_id=content_id,
                source_content_type=content_type,
                verification_status="unverified",
                trust_level="tentative",
                verification_history='[]',
                pipeline_stage="extracted",
                origin_type="llm_generated",
                attached_practice_ids='[]',
            )
            db.add(ku)
            created.append({"id": ku.id, "concept": c.get("concept"), "definition": c.get("definition"), "existing": False})
            _record_transition(
                db, current_user.id, "knowledge", ku.id,
                old_stage, "extracted", old_brain_side, concept_brain_side,
                action="extract",
            )

        _record_transition(
            db, current_user.id, content_type, content_id,
            old_stage, "extracted", old_brain_side, item.brain_side,
            action="extract",
        )
        db.commit()
        db.refresh(item)

        # Generate embeddings for newly created concepts; failures should not break extraction.
        for c in created:
            if c.get("existing"):
                continue
            try:
                await embed_document_chunks(
                    f"{c.get('concept', '')}: {c.get('definition', '')}",
                    content_type="knowledge",
                    doc_id=c["id"],
                    user_id=current_user.id,
                )
            except Exception:
                logger.exception(f"Failed to generate embedding for concept {c['id']}")

        return ExtractResponse(source_id=content_id, source_content_type=content_type, concepts=created)
    except ValueError:
        db.rollback()
        logging.getLogger(__name__).exception("Concept extraction failed")
        raise HTTPException(
            status_code=500,
            detail="概念提取失败，请查看服务端日志",
        )
    except Exception:
        # Rollback any partial state changes so the source item doesn't get stuck in extracted stage
        db.rollback()
        logging.getLogger(__name__).exception("Concept extraction failed")
        raise HTTPException(
            status_code=500,
            detail="概念提取失败，请查看服务端日志",
        )


# -- 碰撞配对（候选抽取与优选共用同一套三级逻辑，改一处全站一致） ----------

def _find_collision_candidates(db, user_id: str, concept: KnowledgeUnit):
    """给概念 A 找碰撞对手：graphify 语义边优先 → 向量相似度区间[0.55,0.85] → 最近概念兜底。

    返回 (candidates, pairing)：candidates=[{"content_id","similarity","title"}] 按分数降序，
    pairing ∈ graphify/embedding/recent。撞不撞、撞谁是调用方的事——
    手动碰撞可取第一名（历史行为），候选清单端点整包返回给用户选。
    """
    candidates = []
    concept_embedding = db.query(Embedding).filter(
        Embedding.user_id == user_id,
        Embedding.content_type == "knowledge",
        Embedding.content_id == concept.id,
    ).first()

    if concept_embedding:
        try:
            vec_a = json.loads(concept_embedding.embedding_json)
            valid_candidate_ids = {
                row.id
                for row in db.query(KnowledgeUnit.id).filter(
                    KnowledgeUnit.user_id == user_id,
                    KnowledgeUnit.content_subtype == "concept",
                    KnowledgeUnit.status == "active",
                    KnowledgeUnit.id != concept.id,
                ).all()
            }
            others = db.query(Embedding).filter(
                Embedding.user_id == user_id,
                Embedding.content_type == "knowledge",
                Embedding.content_id != concept.id,
            ).limit(100).all()
            for emb in others:
                if emb.content_id not in valid_candidate_ids:
                    continue
                try:
                    vec_b = json.loads(emb.embedding_json)
                    sim = _cosine_similarity(vec_a, vec_b)
                    if 0.55 <= sim <= 0.85:
                        candidates.append({"content_id": emb.content_id, "similarity": sim})
                except Exception:
                    continue
            candidates.sort(key=lambda x: x["similarity"], reverse=True)
        except Exception:
            pass

    pairing = "embedding"
    try:
        graphify_edges = db.query(GraphEdge).filter(
            GraphEdge.user_id == user_id,
            GraphEdge.edge_type == "graphify",
            or_(GraphEdge.source_id == concept.id, GraphEdge.target_id == concept.id),
        ).order_by(GraphEdge.weight.desc()).all()
        partner_weight: dict = {}
        for e in graphify_edges:
            pid = e.target_id if e.source_id == concept.id else e.source_id
            partner_weight.setdefault(pid, e.weight or 0.0)
        if partner_weight:
            valid_partner_ids = {
                row.id
                for row in db.query(KnowledgeUnit.id).filter(
                    KnowledgeUnit.user_id == user_id,
                    KnowledgeUnit.content_subtype == "concept",
                    KnowledgeUnit.status == "active",
                    KnowledgeUnit.id.in_(list(partner_weight.keys())),
                ).all()
            }
            graphify_candidates = [
                {"content_id": pid, "similarity": w}
                for pid, w in partner_weight.items()
                if pid in valid_partner_ids
            ]
            if graphify_candidates:
                candidates = graphify_candidates
                pairing = "graphify"
    except Exception:
        pass

    if not candidates:
        pairing = "recent"
        other_concepts = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == user_id,
            KnowledgeUnit.content_subtype == "concept",
            KnowledgeUnit.status == "active",
            KnowledgeUnit.id != concept.id,
        ).order_by(KnowledgeUnit.created_at.desc()).limit(20).all()
        for oc in other_concepts:
            candidates.append({"content_id": oc.id, "similarity": 0.6})

    # 补标题（透出给用户选）
    ids = [c["content_id"] for c in candidates]
    if ids:
        title_map = {
            row.id: (row.content_raw or "")[:80]
            for row in db.query(KnowledgeUnit.id, KnowledgeUnit.content_raw)
            .filter(KnowledgeUnit.id.in_(ids)).all()
        }
        for c in candidates:
            c["title"] = title_map.get(c["content_id"], "")
    return candidates, pairing


@router.post("/concepts/collide", response_model=CollisionResponse, summary="Collide two concepts")
async def collide_concepts(
    request: CollisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Find a similar concept and generate a cross-domain insight."""
    concept = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.id == request.concept_id,
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.content_subtype == "concept",
    ).first()
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")

    # 显式指定对手（候选清单或自定义选择的 partner_id）跳过配对；否则三级配对取第一
    if request.partner_id:
        concept_b = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.id == request.partner_id,
            KnowledgeUnit.user_id == current_user.id,
            KnowledgeUnit.content_subtype == "concept",
            KnowledgeUnit.status == "active",
            KnowledgeUnit.id != concept.id,
        ).first()
        if not concept_b:
            raise HTTPException(status_code=404, detail="指定的碰撞对手不存在或不可用")
        best_sim, pairing = 0.0, "manual"
    else:
        candidates, pairing = _find_collision_candidates(db, current_user.id, concept)
        if not candidates:
            raise HTTPException(status_code=400, detail="No suitable collision candidates found")
        concept_b = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == candidates[0]["content_id"]).first()
        if not concept_b:
            raise HTTPException(status_code=404, detail="Collision candidate not found")
        best_sim = candidates[0]["similarity"]

    prompt = f"""两个概念即将发生碰撞：

概念 A：{concept.content_raw}
概念 B：{concept_b.content_raw}

它们有一定关联，但不完全相同。请基于这两个概念，推导出一个新的认知洞见。
要求：
- 不是简单拼接，而是真正的跨界推导
- 用一句话概括核心洞见
- 给出简要推导过程

返回 JSON：
{{
  "insight": "核心洞见",
  "derivation": "推导过程"
}}
"""

    user_settings = json.loads(current_user.settings or '{}')

    try:
        raw = await chat_completion(
            prompt=prompt,
            task_type="creative",
            system_prompt="You are a cross-domain insight generator. Always return valid JSON.",
            preferred_model=request.preferred_model,
        )
        raw = raw.strip()

        if not raw:
            raise ValueError("LLM returned empty response")

        json_str = raw
        if "```json" in raw:
            parts = raw.split("```json")
            if len(parts) > 1:
                json_str = parts[1].split("```")[0].strip()
        elif "```" in raw:
            parts = raw.split("```")
            if len(parts) > 1:
                json_str = parts[1].split("```")[0].strip()

        if not json_str.startswith("{"):
            obj_start = raw.find("{")
            obj_end = raw.rfind("}")
            if obj_start != -1 and obj_end != -1 and obj_end > obj_start:
                json_str = raw[obj_start:obj_end + 1]

        result = json.loads(json_str)

        collision = KnowledgeUnit(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            brain_side="both",
            content_raw=result.get("insight", ""),
            content_type="collision_result",
            content_subtype="collision_result",
            source_id=concept.id,
            source_content_type="knowledge",
            verification_status="unverified",
            trust_level="tentative",
            verification_history='[]',
            pipeline_stage="collided",
            origin_type="llm_generated",
            # 双亲出处：源概念 A + 候选概念 B（后续在详情页可回查「由 A×B 碰撞而来」）
            collision_parents=json.dumps([
                {"id": concept.id, "title": (concept.content_raw or "")[:80]},
                {"id": concept_b.id, "title": (concept_b.content_raw or "")[:80]},
            ], ensure_ascii=False),
            attached_practice_ids='[]',
        )
        db.add(collision)

        # Keep the source concept in the 'extracted' stage so it stays available for
        # further collisions; only the generated insight occupies the 'collided' stage.
        # (Previously the concept itself was moved to 'collided', which removed it from
        # the extract list and made the collided-stage count mix concepts with results.)
        _record_transition(
            db, current_user.id, "knowledge", collision.id,
            "extracted", "collided", concept.brain_side, "both",
            action="collide",
        )

        # Create graph edge
        edge = GraphEdge(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            source_id=concept.id,
            target_id=concept_b.id,
            source_brain_side=concept.brain_side,
            target_brain_side=concept_b.brain_side,
            edge_type="collision",
            strength=best_sim,
            cross_brain=(concept.brain_side != concept_b.brain_side),
            context=result.get("insight", ""),
        )
        db.add(edge)

        db.commit()
        db.refresh(collision)

        # Generate embedding for the collision result so it can participate in future similarity searches.
        try:
            await embed_document_chunks(
                collision.content_raw,
                content_type="knowledge",
                doc_id=collision.id,
                user_id=current_user.id,
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception(f"Failed to generate embedding for collision {collision.id}")

        return CollisionResponse(
            collision_id=collision.id,
            concept_a=concept.content_raw,
            concept_b=concept_b.content_raw,
            similarity=round(best_sim, 2),
            insight=result.get("insight", ""),
            derivation=result.get("derivation", ""),
            pairing=pairing,
        )
    except ValueError:
        db.rollback()
        logging.getLogger(__name__).exception("Concept collision failed")
        raise HTTPException(
            status_code=500,
            detail="概念碰撞失败，请查看服务端日志",
        )
    except Exception:
        db.rollback()
        logging.getLogger(__name__).exception("Concept collision failed")
        raise HTTPException(
            status_code=500,
            detail="概念碰撞失败，请查看服务端日志",
        )


@router.post("/collisions/{collision_id}/review", response_model=ReviewResponse, summary="Approve or reject a collision result")
async def review_collision(
    collision_id: str,
    request: ReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Approve (annotate) or reject a collision result."""
    collision = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.id == collision_id,
        KnowledgeUnit.user_id == current_user.id,
        KnowledgeUnit.content_subtype == "collision_result",
    ).first()
    if not collision:
        raise HTTPException(status_code=404, detail="Collision result not found")

    if collision.pipeline_stage != "collided":
        raise HTTPException(status_code=400, detail="Only collided results can be reviewed")

    old_stage = collision.pipeline_stage or "collided"
    old_brain_side = collision.brain_side or "both"
    if request.action == "approve":
        collision.pipeline_stage = "approved"
        collision.content_type = "knowledge"
        new_stage = "approved"
        new_brain_side = "personal"
        collision.brain_side = new_brain_side
        # Persist reviewer feedback as personal annotation if provided.
        if request.feedback:
            collision.content_processed = request.feedback
    else:
        collision.status = "rejected"
        collision.pipeline_stage = "rejected"
        new_stage = "rejected"
        new_brain_side = old_brain_side
        if request.feedback:
            collision.content_processed = request.feedback

    _record_transition(
        db, current_user.id, "knowledge", collision.id,
        old_stage, new_stage, old_brain_side, new_brain_side,
        action="review",
    )

    collision.updated_at = datetime.now()
    db.commit()
    db.refresh(collision)

    return ReviewResponse(collision_id=collision.id, action=request.action, new_stage=new_stage)


class TransitionHistoryItem(BaseModel):
    id: str
    content_type: str
    content_id: str
    from_stage: str
    to_stage: str
    brain_side_before: Optional[str]
    brain_side_after: Optional[str]
    action: str
    created_at: datetime


@router.get("/{content_type}/{content_id}/history", response_model=List[TransitionHistoryItem], summary="Pipeline transition history for a content item")
async def get_transition_history(
    content_type: str,
    content_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return stage/brain-side transition history for a given content item."""
    history = db.query(PipelineTransition).filter(
        PipelineTransition.user_id == current_user.id,
        PipelineTransition.content_type == content_type,
        PipelineTransition.content_id == content_id,
    ).order_by(PipelineTransition.created_at.asc()).all()

    return [
        TransitionHistoryItem(
            id=h.id,
            content_type=h.content_type,
            content_id=h.content_id,
            from_stage=h.from_stage,
            to_stage=h.to_stage,
            brain_side_before=h.brain_side_before,
            brain_side_after=h.brain_side_after,
            action=h.action,
            created_at=h.created_at,
        )
        for h in history
    ]


class ConvertBrainSideRequest(BaseModel):
    target_brain_side: Literal["personal", "network"]
    reason: Optional[str] = None


class ConvertBrainSideResponse(BaseModel):
    content_type: str
    content_id: str
    brain_side: str
    previous_brain_side: str


@router.post("/{content_type}/{content_id}/convert-brain-side", response_model=ConvertBrainSideResponse, summary="Convert content brain side")
async def convert_brain_side(
    content_type: str,
    content_id: str,
    request: ConvertBrainSideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Convert a pipeline item's brain side. Network → personal requires a reason."""
    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid content type")

    item = _get_content(db, current_user.id, content_type, content_id)
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")

    old_side = getattr(item, "brain_side", "both")
    current_stage = getattr(item, "pipeline_stage", "raw") or "raw"

    if request.target_brain_side == old_side:
        raise HTTPException(status_code=400, detail="Target brain side is the same as current")

    # Personal → network is only allowed before annotation (approved)
    if old_side == "personal" and request.target_brain_side == "network" and current_stage == "approved":
        raise HTTPException(status_code=400, detail="已注卡的个人脑知识不能回退到网络脑")

    # Network → personal should ideally include a relevance reason
    if old_side == "network" and request.target_brain_side == "personal" and not request.reason:
        pass  # Still allow; front-end can enforce if desired

    item.brain_side = request.target_brain_side
    item.updated_at = datetime.now()

    _record_transition(
        db, current_user.id, content_type, content_id,
        current_stage, current_stage, old_side, request.target_brain_side,
        action="brain_convert",
    )
    db.commit()
    db.refresh(item)

    return ConvertBrainSideResponse(
        content_type=content_type,
        content_id=content_id,
        brain_side=request.target_brain_side,
        previous_brain_side=old_side,
    )
