# -*- coding: utf-8 -*-
"""知识单元查重合并。

新建知识单元前先调 find_similar_unit：title 精确/前缀匹配出候选（无 title 候选时
退回全量小库）。vec 可用时走 sqlite-vec KNN 全库召回（候选池不受 MAX_FULL_SCAN
截断）+ 回表校验过滤；不可用时落回原路径——对候选算 content 向量余弦
（embeddings 表有现成向量就直接用，没有就现场 embed）。相似度 >=
MERGE_SIMILARITY_THRESHOLD 时返回旧单元，调用方走 merge_into_unit 更新而不是新建。
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
    """优先用 embeddings 表现成向量（整文档向量，否则第 0 父块代表块），没有就现场 embed。"""
    row = (
        db.query(Embedding)
        .filter(Embedding.content_type == "knowledge", Embedding.content_id == unit.id)
        .first()
    )
    if row is None:
        # 第 0 父块代表向量：旧平铺 id "...::chunk::0" 或新父子 id "...::chunk::0.x"
        row = (
            db.query(Embedding)
            .filter(
                Embedding.content_type == "knowledge",
                (Embedding.content_id == f"{unit.id}{CHUNK_ID_SEP}0")
                | (Embedding.content_id.like(f"{unit.id}{CHUNK_ID_SEP}0.%")),
            )
            .order_by(Embedding.content_id)
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
    tenant=None,
) -> Optional[KnowledgeUnit]:
    """返回与 (title, content) 高度相似的现有知识单元，没有则返回 None。

    向量服务不可用（mock fallback）时返回 None —— 无法可靠判重，降级为正常新建。
    tenant 非空时查重范围限该租户的团队内容；否则限本人个人空间（tenant_id 为空）。
    """
    from app.core.tenant_scope import scope_condition
    units = (
        db.query(KnowledgeUnit)
        .filter(scope_condition(KnowledgeUnit, user_id, tenant), KnowledgeUnit.status == "active")
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

    # vec KNN 路径：高阈值最近邻全库召回，候选池不再受 MAX_FULL_SCAN 截断；
    # 回表校验（容忍索引脏行）+ 原过滤口径（title 候选优先/租户作用域/active）。
    # k=20（内部超取 ×4）足够覆盖 0.88 阈值以上的邻居。租户场景跨用户，
    # 不按 user_id 分区过滤，vec_knn 内回内容行按 tenant_id 收口，命中后再
    # 按候选单元集过滤。
    # vec_knn 返回 None（未加载/该维度无索引/异常）落回原逐单元暴力余弦。
    candidate_ids = {u.id for u in (_title_candidates(units, title) or units)}
    # 开源版无 vec_index（剥离面）：落回逐单元暴力余弦
    hits = None
    if hits is not None:
        unit_by_id = {u.id: u for u in units}
        content_by_eid = {
            r.id: r.content_id
            for r in db.query(Embedding.id, Embedding.content_id)
            .filter(Embedding.id.in_([eid for eid, _ in hits])).all()
        } if hits else {}
        best: Optional[KnowledgeUnit] = None
        best_sim = 0.0
        for eid, distance in hits:  # 距离升序 = 相似度降序
            cid = content_by_eid.get(eid)
            if cid is None:
                continue  # 索引脏行：Embedding 已删，跳过
            # 只认整文档向量或第 0 父块的块（旧 "0" / 新 "0.x"，与原口径一致）
            if cid in candidate_ids:
                unit_id = cid
            elif CHUNK_ID_SEP in cid:
                base, _, chunk_no = cid.rpartition(CHUNK_ID_SEP)
                if not (chunk_no == "0" or chunk_no.startswith("0.")) or base not in candidate_ids:
                    continue
                unit_id = base
            else:
                continue
            sim = 1.0 - distance
            if sim > best_sim:
                best_sim = sim
                best = unit_by_id[unit_id]
        if best is not None and best_sim >= threshold:
            return best
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
            q = session.query(Embedding).filter(
                Embedding.content_type == "knowledge",
                (Embedding.content_id == unit.id)
                | (Embedding.content_id.like(f"{unit.id}{CHUNK_ID_SEP}%")),
            )
            # 开源版无 vec_index 影子索引（剥离面）：只清 embeddings 表
            q.delete(synchronize_session=False)
            session.commit()
        finally:
            session.close()
        await embed_document_chunks(
            unit.content_raw or "", content_type="knowledge",
            doc_id=unit.id, user_id=unit.user_id,
        )
    except Exception:
        pass
