# -*- coding: utf-8 -*-
"""知识单元查重合并。

新建知识单元前先调 find_similar_unit：title 精确/前缀匹配出候选（无 title 候选时
退回全量小库），对候选算 content 向量余弦（embeddings 表有现成向量就直接用，
没有就现场 embed），相似度 >= MERGE_SIMILARITY_THRESHOLD 时返回旧单元，
调用方走 merge_into_unit 更新而不是新建。
"""

import json
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.base import Embedding, KnowledgeUnit
from app.services.chunking import CHUNK_ID_SEP
from app.services.embedding_service import embedding_service

# 内容余弦相似度达到此值即视为同一知识单元，走合并
MERGE_SIMILARITY_THRESHOLD = 0.88
# 无 title 候选时全量比较的单元数上限
MAX_FULL_SCAN = 200


def _title_candidates(units: List[KnowledgeUnit], title: str) -> List[KnowledgeUnit]:
    title = (title or "").strip()
    if not title:
        return []
    out = []
    for u in units:
        ut = (u.source_title or "").strip()
        if ut and (ut == title or ut.startswith(title) or title.startswith(ut)):
            out.append(u)
    return out


async def _content_vector(db: Session, unit: KnowledgeUnit) -> Optional[list]:
    """优先用 embeddings 表现成向量（整文档向量，否则第 0 块），没有就现场 embed。"""
    row = (
        db.query(Embedding)
        .filter(Embedding.content_type == "knowledge", Embedding.content_id == unit.id)
        .first()
    )
    if row is None:
        row = (
            db.query(Embedding)
            .filter(
                Embedding.content_type == "knowledge",
                Embedding.content_id == f"{unit.id}{CHUNK_ID_SEP}0",
            )
            .first()
        )
    if row is not None:
        try:
            return json.loads(row.embedding_json)
        except (json.JSONDecodeError, TypeError):
            pass
    result = await embedding_service.embed((unit.content_raw or "")[:2000], store=False)
    if result.get("model_used") == "mock/fallback":
        return None
    return result.get("embedding") or None


async def find_similar_unit(
    db: Session,
    user_id: str,
    title: str,
    content: str,
    threshold: float = MERGE_SIMILARITY_THRESHOLD,
) -> Optional[KnowledgeUnit]:
    """返回与 (title, content) 高度相似的现有知识单元，没有则返回 None。

    向量服务不可用（mock fallback）时返回 None —— 无法可靠判重，降级为正常新建。
    """
    units = (
        db.query(KnowledgeUnit)
        .filter(KnowledgeUnit.user_id == user_id, KnowledgeUnit.status == "active")
        .all()
    )
    if not units:
        return None

    candidates = _title_candidates(units, title)
    if not candidates:
        candidates = units[:MAX_FULL_SCAN]

    query = await embedding_service.embed((content or "")[:2000], store=False)
    if query.get("model_used") == "mock/fallback":
        return None
    query_vec = query.get("embedding") or []
    if not query_vec:
        return None

    best: Optional[KnowledgeUnit] = None
    best_sim = 0.0
    for unit in candidates:
        vec = await _content_vector(db, unit)
        if not vec:
            continue
        sim = embedding_service._cosine_similarity(query_vec, vec)
        if sim > best_sim:
            best_sim = sim
            best = unit

    if best is not None and best_sim >= threshold:
        return best
    return None


def merge_into_unit(unit: KnowledgeUnit, new_content: str) -> KnowledgeUnit:
    """把新内容合并进已有知识单元：追加（去重）、标注合并时间、invoke_count+1。
    title 保持旧单元不变；updated_at 由 ORM onupdate 自动刷新。"""
    existing = (unit.content_raw or "").strip()
    addition = (new_content or "").strip()
    if addition and addition not in existing:
        stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        unit.content_raw = f"{existing}\n\n[合并于 {stamp}]\n{addition}" if existing else addition
    unit.invoke_count = (unit.invoke_count or 0) + 1
    return unit


async def reembed_unit(unit: KnowledgeUnit) -> None:
    """合并后内容变了，删掉旧向量（含块向量）按新内容重算。失败静默。"""
    try:
        from app.core.database import SessionLocal
        from app.services.chunking import embed_document_chunks

        session = SessionLocal()
        try:
            session.query(Embedding).filter(
                Embedding.content_type == "knowledge",
                (Embedding.content_id == unit.id)
                | (Embedding.content_id.like(f"{unit.id}{CHUNK_ID_SEP}%")),
            ).delete(synchronize_session=False)
            session.commit()
        finally:
            session.close()
        await embed_document_chunks(
            unit.content_raw or "", content_type="knowledge",
            doc_id=unit.id, user_id=unit.user_id,
        )
    except Exception:
        pass
