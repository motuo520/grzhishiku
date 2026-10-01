import json
import logging
import math
import os
import re
import threading
import time
import uuid
from collections import defaultdict
from typing import List, Dict, Any, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.crypto import decrypt_capsule_content
from app.core.tenant_scope import get_active_tenant, scope_condition
from app.models.base import User, Note, Capsule, BrowserClip, KnowledgeUnit, GraphEdge, Tag, Embedding, Document, content_tags
from app.schemas.graph import (
    ManualEdgeCreate, ManualEdgeOut, ManualEdgeListItem, ManualEdgeListResponse,
    LinkSuggestionsResponse,
)

router = APIRouter()


def _extract_keywords(text: str) -> set:
    """Extract simple keywords from text (Chinese + English)."""
    if not text:
        return set()
    # Remove markdown, URLs, and punctuation
    text = re.sub(r'[#!\*\[\]\(\)\|]', ' ', text)
    text = re.sub(r'https?://\S+', ' ', text)
    # Split by non-word chars
    words = re.findall(r'[\u4e00-\u9fff]{2,4}|[a-zA-Z]{3,}', text.lower())
    # Filter out common stop words (simple English stop words)
    stop_words = {"the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use", "with", "have", "this", "will", "your", "from", "they", "know", "want", "been", "good", "much", "some", "time", "very", "when", "come", "here", "just", "like", "long", "make", "many", "over", "such", "take", "than", "them", "well", "were"}
    return {w for w in words if w not in stop_words}


def _resolve_node_tenant_id(db: Session, node_id: str) -> Optional[str]:
    """解析内容行的租户归属（边盖章用）：个人内容返回 None。"""
    from app.models.content import Document
    for Model in (Note, Capsule, BrowserClip, KnowledgeUnit, Document):
        row = db.query(Model.tenant_id).filter(Model.id == node_id).first()
        if row is not None:
            return row[0]
    return None


def _create_edge(
    db: Session,
    user_id: str,
    source_id: str,
    target_id: str,
    source_brain_side: str,
    target_brain_side: str,
    edge_type: str,
    weight: float,
    context: str = "",
    auto_created: bool = True,
    dedupe_same_type: bool = False,
) -> Optional[GraphEdge]:
    """Create a graph edge if both source and target exist for the user."""
    if source_id == target_id:
        return None
    # 团队内容的边 stamp 租户归属（堵注销悬边：团队边不随个人注销删），
    # 去重同空间口径——团队边按租户去重，避免不同成员的 auto-link 各建一条
    tenant_id = _resolve_node_tenant_id(db, source_id)
    scope_cond = GraphEdge.tenant_id == tenant_id if tenant_id else and_(
        GraphEdge.user_id == user_id, GraphEdge.tenant_id.is_(None)
    )
    # Avoid duplicate edges (bidirectional check)
    q = db.query(GraphEdge).filter(
        scope_cond,
        or_(
            and_(GraphEdge.source_id == source_id, GraphEdge.target_id == target_id),
            and_(GraphEdge.source_id == target_id, GraphEdge.target_id == source_id),
        )
    )
    if dedupe_same_type:
        # 手动双链（08-27 拍板放开）：只与同类型边互斥——已有 graphify 语义边/
        # 相似边不挡手动断言，两类边语义不同（机器推断 vs 用户显式关联），允许共存
        q = q.filter(GraphEdge.edge_type == edge_type)
    existing = q.first()
    if existing:
        return None

    s = source_brain_side or "unknown"
    t = target_brain_side or "unknown"
    cross_brain = s != t and s != "unknown" and t != "unknown"
    edge = GraphEdge(
        id=str(uuid.uuid4()),
        user_id=user_id,
        tenant_id=tenant_id,
        source_id=source_id,
        target_id=target_id,
        source_brain_side=source_brain_side,
        target_brain_side=target_brain_side,
        edge_type=edge_type,
        strength=weight,
        weight=weight,
        context=context,
        cross_brain=cross_brain,
        auto_created=auto_created,
    )
    db.add(edge)
    return edge


def cleanup_content_edges(db: Session, content_id: str, user_id: Optional[str] = None) -> int:
    """Delete graph edges referencing a piece of content. Call when content is deleted
    so soft/hard-deleted nodes don't linger as phantom nodes via their edges."""
    q = db.query(GraphEdge).filter(
        or_(GraphEdge.source_id == content_id, GraphEdge.target_id == content_id)
    )
    if user_id:
        q = q.filter(GraphEdge.user_id == user_id)
    return q.delete(synchronize_session=False)


def _resolve_node_brain_side(db: Session, node_id: str) -> str:
    """Resolve brain_side from content tables, fallback to 'unknown'."""
    from app.models.content import Document
    for Model, default, attr in [
        (Note, "personal", "brain_side"),
        (Capsule, "personal", "brain_side"),
        (BrowserClip, "network", "brain_side"),
        (KnowledgeUnit, "network", "brain_side"),
        (Document, "personal", "brain_side"),  # 09-17 P2-4 文档入图：本地资产默认个人脑
    ]:
        obj = db.query(Model).filter(Model.id == node_id).first()
        if obj:
            side = getattr(obj, attr, None)
            return side if side else default
    return "unknown"


def _build_node_dict(db: Session, obj: Any, node_type: str) -> Dict[str, Any]:
    """Build a rich node dict with brain_side, source_type and created_at."""
    if node_type == "note":
        return {
            "id": obj.id,
            "label": obj.title or "(无标题)",
            "type": "note",
            "brain_side": obj.brain_side or "personal",
            "source_type": "manual_input",
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
        }
    if node_type == "capsule":
        return {
            "id": obj.id,
            "label": (decrypt_capsule_content(obj.content_body) or "Capsule")[:50],
            "type": "capsule",
            "brain_side": obj.brain_side or "personal",
            "source_type": "capsule",
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
        }
    if node_type == "clip":
        return {
            "id": obj.id,
            "label": obj.title or "(无标题)",
            "type": "clip",
            "brain_side": obj.brain_side or "network",
            "source_type": "browser_clip",
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
        }
    if node_type == "knowledge":
        return {
            "id": obj.id,
            "label": (obj.content_raw or "Knowledge")[:50],
            "type": "knowledge",
            "brain_side": obj.brain_side or "network",
            "source_type": obj.source_type or "knowledge",
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
        }
    if node_type == "tag":
        return {
            "id": f"tag:{obj.id}",
            "label": obj.name,
            "type": "tag",
            "brain_side": "both",
            "source_type": "tag",
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
        }
    return {"id": str(obj.id), "label": str(obj.id), "type": node_type, "brain_side": "unknown", "source_type": "unknown", "created_at": None}


def _get_all_nodes_for_user(db: Session, current_user: User) -> List[Dict[str, Any]]:
    """Collect all graph nodes for a user.

    空间口径（批 C 补）：团队上下文按租户全量（content_filter）+ 目录级可见性
    收口（不可见夹内容不进图）；个人空间恒等旧口径（user_id + tenant 空）。
    capsule/tag 无 folder_id，维持原查询不动。
    """
    from app.core.tenant_scope import content_filter, content_visible_condition
    tenant = get_active_tenant(db, current_user)
    nodes: List[Dict[str, Any]] = []
    for note in content_filter(
        db.query(Note).filter(Note.status == "active"), Note, current_user, tenant
    ).filter(content_visible_condition(db, Note, current_user, tenant)).all():
        nodes.append(_build_node_dict(db, note, "note"))
    for capsule in db.query(Capsule).filter(Capsule.user_id == current_user.id).all():
        nodes.append(_build_node_dict(db, capsule, "capsule"))
    for clip in content_filter(
        db.query(BrowserClip).filter(BrowserClip.status == "active"), BrowserClip, current_user, tenant
    ).filter(content_visible_condition(db, BrowserClip, current_user, tenant)).all():
        nodes.append(_build_node_dict(db, clip, "clip"))
    for unit in content_filter(
        db.query(KnowledgeUnit).filter(KnowledgeUnit.status == "active"), KnowledgeUnit, current_user, tenant
    ).filter(content_visible_condition(db, KnowledgeUnit, current_user, tenant)).all():
        nodes.append(_build_node_dict(db, unit, "knowledge"))
    for tag in db.query(Tag).filter(Tag.user_id == current_user.id).all():
        nodes.append(_build_node_dict(db, tag, "tag"))
    return nodes


def _batch_node_labels(db: Session, node_ids) -> Dict[str, str]:
    """Batch-resolve labels for many node ids (one query per content table)."""
    labels: Dict[str, str] = {}
    remaining = set(node_ids or [])
    if not remaining:
        return labels
    for Model, attr in [(Note, "title"), (BrowserClip, "title"), (KnowledgeUnit, "content_raw"), (Capsule, "content_body")]:
        if not remaining:
            break
        rows = db.query(Model.id, getattr(Model, attr)).filter(Model.id.in_(remaining)).all()
        for rid, val in rows:
            if Model is Capsule and isinstance(val, str):
                val = decrypt_capsule_content(val)
            labels[rid] = (val if isinstance(val, str) else (str(val) if val else rid))[:50] if val else rid
            remaining.discard(rid)
    return labels


def _batch_node_meta(db: Session, node_ids) -> Dict[str, dict]:
    """节点 meta 一次解析：label + 内容类型（前端路由用）+ clip 外链 url（直达原文用）。"""
    meta: Dict[str, dict] = {}
    remaining = set(node_ids or [])
    if not remaining:
        return meta
    specs = [
        (Note, "title", "note", None),
        (BrowserClip, "title", "clip", "url"),
        (KnowledgeUnit, "content_raw", "knowledge", None),
        (Document, "title", "document", None),
        (Capsule, "content_body", "capsule", None),
    ]
    for Model, attr, ctype, url_attr in specs:
        if not remaining:
            break
        cols = [Model.id, getattr(Model, attr)] + ([getattr(Model, url_attr)] if url_attr else [])
        for row in db.query(*cols).filter(Model.id.in_(remaining)).all():
            rid, val = row[0], row[1]
            url = row[2] if url_attr else None
            if Model is Document and not val:
                val = None  # 落 original_name 由下方兜底查询补
            if Model is Capsule and isinstance(val, str):
                val = decrypt_capsule_content(val)
            label = (val if isinstance(val, str) else (str(val) if val else rid))[:50] if val else rid
            meta[rid] = {"label": label, "type": ctype, "url": url}
            remaining.discard(rid)
    # Document 标题为空时用原始文件名兜底
    if remaining:
        doc_rows = db.query(Document.id, Document.original_name).filter(Document.id.in_(remaining)).all()
        for rid, name in doc_rows:
            meta[rid] = {"label": (name or rid)[:50], "type": "document", "url": None}
            remaining.discard(rid)
    return meta


_SHARED_CONCEPT_RE = re.compile(r"经概念「([^」]*)」")


def _shared_title_keywords(label_a: str, label_b: str) -> List[str]:
    """共同点兜底：两端标题的关键词交集（jieba 分词零 LLM）。存量 graphify 边无
    经概念枢纽时也能给出最浅但诚实的共同点（两边标题里真实共现的词）。"""
    import jieba
    def _tokens(s: str) -> set:
        out = set()
        for tok in jieba.lcut(s or ""):
            tok = tok.strip()
            if len(tok) >= 2 and not re.fullmatch(r"[\W_]+", tok):
                out.add(tok)
        return out
    return sorted(_tokens(label_a) & _tokens(label_b))[:3]


def _shared_tag_names(db: Session, id_pairs: List[tuple]) -> Dict[tuple, List[str]]:
    """跨脑标签边的共同点=两端共享标签名（零 LLM，批量一次查）。"""
    all_ids = {i for pair in id_pairs for i in pair}
    if not all_ids:
        return {}
    rows = (db.query(content_tags.c.content_id, Tag.name)
            .join(Tag, Tag.id == content_tags.c.tag_id)
            .filter(content_tags.c.content_id.in_(all_ids)).all())
    by_id: Dict[str, set] = {}
    for cid, name in rows:
        by_id.setdefault(cid, set()).add(name)
    return {pair: sorted(by_id.get(pair[0], set()) & by_id.get(pair[1], set())) for pair in id_pairs}


def _space_cond(model, user_id: str, tenant_id: Optional[str]):
    """auto-link 扫描限当前空间：团队内容扫同租户（tenant_id=T），
    个人内容扫本人且 tenant_id 为空——避免跨空间连边。"""
    if tenant_id:
        return model.tenant_id == tenant_id
    return and_(model.user_id == user_id, model.tenant_id.is_(None))


def _auto_link_for_clip(user_id: str, clip_id: str, db: Session):
    """Lightweight auto-link for a single new clip."""
    clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.user_id == user_id).first()
    if not clip:
        return
    knowledge = db.query(KnowledgeUnit).filter(_space_cond(KnowledgeUnit, user_id, clip.tenant_id)).all()
    domain = clip.domain or ""
    for ku in knowledge:
        ku_domain = ""
        if ku.source_url:
            from urllib.parse import urlparse
            try:
                ku_domain = urlparse(ku.source_url).netloc.lower().replace("www.", "")
            except Exception:
                pass
        if ku_domain and ku_domain == domain:
            _create_edge(
                db, user_id, clip.id, ku.id,
                clip.brain_side or "network", ku.brain_side or "network",
                "source", 0.7,
                f"Same domain: {domain}",
            )
    db.commit()


def _auto_link_for_knowledge(user_id: str, ku_id: str, db: Session):
    """Lightweight auto-link for a single new knowledge unit."""
    ku = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == ku_id, KnowledgeUnit.user_id == user_id).first()
    if not ku:
        return
    notes = db.query(Note).filter(_space_cond(Note, user_id, ku.tenant_id), Note.status == "active").all()
    ku_keywords = _extract_keywords(ku.content_raw or "")
    for note in notes:
        overlap = ku_keywords & _extract_keywords(note.title + " " + (note.content or ""))
        if len(overlap) > 2:
            _create_edge(
                db, user_id, ku.id, note.id,
                ku.brain_side or "network", note.brain_side or "personal",
                "support", 0.9,
                f"Knowledge supports note. Keywords: {', '.join(list(overlap)[:5])}",
            )
    db.commit()


def _auto_link_for_note(user_id: str, note_id: str, db: Session):
    """Lightweight auto-link for a single new/updated note."""
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == user_id, Note.status == "active").first()
    if not note:
        return
    clips = db.query(BrowserClip).filter(
        _space_cond(BrowserClip, user_id, note.tenant_id), BrowserClip.status == "active"
    ).all()
    note_content = note.content or ""
    urls_in_note = set(re.findall(r'https?://[^\s\)]+', note_content))
    for clip in clips:
        if clip.url and clip.url in urls_in_note:
            _create_edge(
                db, user_id, note.id, clip.id,
                note.brain_side or "personal", clip.brain_side or "network",
                "reference", 0.8,
                f"Note references clip URL: {clip.url}",
            )
    # Tags
    note_tags = db.query(content_tags).filter(
        content_tags.c.content_type == "note",
        content_tags.c.content_id == note_id
    ).all()
    tag_ids = [nt.tag_id for nt in note_tags]
    other_notes = db.query(content_tags).filter(
        content_tags.c.content_type == "note",
        content_tags.c.tag_id.in_(tag_ids) if tag_ids else False,
        content_tags.c.content_id != note_id
    ).all()
    for nt in other_notes:
        # 同标签他笔记也限当前空间（团队/个人标签本不混用，这里兜底防跨空间连边）
        other_note = db.query(Note).filter(
            Note.id == nt.content_id, _space_cond(Note, user_id, note.tenant_id)
        ).first()
        other_side = other_note.brain_side or "personal" if other_note else "personal"
        _create_edge(
            db, user_id, note_id, nt.content_id,
            note.brain_side or "personal", other_side,
            "tag", 0.5,
            "Shared tag",
        )
    # Similarity with other notes
    note_keywords = _extract_keywords(note.title + " " + note_content)
    other_notes_objs = db.query(Note).filter(
        _space_cond(Note, user_id, note.tenant_id), Note.status == "active", Note.id != note_id
    ).all()
    for other in other_notes_objs:
        overlap = note_keywords & _extract_keywords(other.title + " " + (other.content or ""))
        if len(overlap) > 3:
            _create_edge(
                db, user_id, note_id, other.id,
                note.brain_side or "personal", other.brain_side or "personal",
                "similar", 0.6,
                f"Keyword overlap: {', '.join(list(overlap)[:5])}",
            )
    db.commit()


def auto_link_note(db: Session, note: Note, user_id: str):
    """Exported wrapper for notes.py to auto-link a single note."""
    _auto_link_for_note(user_id, note.id, db)


def auto_link_knowledge(db: Session, unit: KnowledgeUnit, user_id: str):
    """Exported wrapper for knowledge.py to auto-link a single knowledge unit."""
    _auto_link_for_knowledge(user_id, unit.id, db)


def auto_link_clip(db: Session, clip: BrowserClip, user_id: str):
    """Exported wrapper for clips.py to auto-link a single clip."""
    _auto_link_for_clip(user_id, clip.id, db)


# ── auto-link 后台队列（09-14：每次保存在请求路径同步跑全库扫描，快编 N 次 /
# 批量归档 Promise.all N 篇 = N 个扫描并发打满单 worker 小机，顶到 pm2 内存线
# 重启就是一片 502——实捕见当日存底）──
# 写入路径只入队即返回；后台按内容 id 防抖合并（连续快编只按最新内容扫一次），
# 任务自带会话按 id 重取对象（保存后秒删 = 安全 no-op）。ENV=test 同步直跑
# （断言即时性的既有回归不变）。失败 warning 留痕（同 best-effort 旧语义）。
logger = logging.getLogger(__name__)

_AUTO_LINK_DEBOUNCE = 0.8
_auto_link_pending: Dict[str, Tuple[str, str, str, float]] = {}
_auto_link_lock = threading.Lock()
_auto_link_worker: Optional[threading.Thread] = None


def queue_auto_link(kind: str, content_id: str, user_id: str, db: Optional[Session] = None) -> None:
    """入队 auto-link（kind: note/clip/knowledge）。写入路径只调这个。
    ENV=test 用调用方会话同步直跑（测试库是桥接会话，另开 SessionLocal 会
    读到生产文件库——断言即时性的既有回归靠这条不变）。"""
    if os.environ.get("ENV") == "test":
        _run_auto_link_job(kind, content_id, user_id, db=db)
        return
    global _auto_link_worker
    with _auto_link_lock:
        _auto_link_pending[f"{kind}:{content_id}"] = (kind, content_id, user_id, time.time())
        if _auto_link_worker is None or not _auto_link_worker.is_alive():
            _auto_link_worker = threading.Thread(target=_auto_link_worker_loop, daemon=True)
            _auto_link_worker.start()


def _auto_link_worker_loop() -> None:
    while True:
        time.sleep(_AUTO_LINK_DEBOUNCE)
        with _auto_link_lock:
            due = [k for k, (_, _, _, ts) in _auto_link_pending.items()
                   if time.time() - ts >= _AUTO_LINK_DEBOUNCE]
            jobs = [_auto_link_pending.pop(k) for k in due]
            remaining = bool(_auto_link_pending)
        for kind, content_id, user_id, _ in jobs:
            _run_auto_link_job(kind, content_id, user_id)
        if not remaining:
            return  # 队列空即退，下次入队重新拉起（不留常驻线程）


def _run_auto_link_job(kind: str, content_id: str, user_id: str, db: Optional[Session] = None) -> None:
    """单任务：按 id 重取（最新内容），对象没了就 no-op。db 缺省另开独立会话；
    传入（测试桥接）时不关不滚由调用方管。"""
    own_db = db is None
    if own_db:
        from app.core.database import SessionLocal
        db = SessionLocal()
    try:
        if kind == "note":
            obj = db.query(Note).filter(Note.id == content_id, Note.status == "active").first()
            if obj:
                auto_link_note(db, obj, user_id)
        elif kind == "clip":
            obj = db.query(BrowserClip).filter(BrowserClip.id == content_id,
                                               BrowserClip.status == "active").first()
            if obj:
                auto_link_clip(db, obj, user_id)
        elif kind == "knowledge":
            obj = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == content_id,
                                                 KnowledgeUnit.status == "active").first()
            if obj:
                auto_link_knowledge(db, obj, user_id)
    except Exception as e:
        logger.warning("auto-link 后台任务失败（%s %s）: %s", kind, content_id, e)
        if own_db:
            try:
                db.rollback()
            except Exception:
                pass
    finally:
        if own_db:
            db.close()


# ─────────────────────────────────────────────────────────────────────────────
@router.get("/nodes", summary="List graph nodes", description="Get all graph nodes for the current user. Optional brain_side filter.")
async def get_nodes(
    brain_side: Optional[str] = Query(None, description="Filter by brain side: personal, network, both"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    nodes = _get_all_nodes_for_user(db, current_user)
    if brain_side:
        nodes = [n for n in nodes if n.get("brain_side") == brain_side]
    return {"nodes": nodes, "total": len(nodes)}


@router.get("/bridges", summary="Cross-brain bridges", description="List cross-brain bridge node pairs connecting personal and network content.")
async def get_bridges(
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 空间口径（09-13 补）：团队空间只看本租户边，个人空间只看本人个人边——
    # 旧口径只按 user_id，团队空间里个人空间的跨脑桥全漏出来
    tenant = get_active_tenant(db, current_user)
    edges = db.query(GraphEdge).filter(
        scope_condition(GraphEdge, current_user.id, tenant),
        GraphEdge.cross_brain == True
    ).all()

    candidates = []
    for edge in edges:
        s_side = edge.source_brain_side or "unknown"
        t_side = edge.target_brain_side or "unknown"
        # Only keep true personal<->network bridges
        if {s_side, t_side} != {"personal", "network"}:
            continue
        # Ensure personal is first, network is second
        if s_side == "network" and t_side == "personal":
            personal_id, network_id = edge.target_id, edge.source_id
            personal_side, network_side = t_side, s_side
        else:
            personal_id, network_id = edge.source_id, edge.target_id
            personal_side, network_side = s_side, t_side
        candidates.append((edge, personal_id, personal_side, network_id, network_side))

    total = len(candidates)
    # Sort by strength desc and limit BEFORE resolving labels
    candidates.sort(key=lambda c: c[0].strength or 0, reverse=True)
    candidates = candidates[:limit]

    label_ids = {pid for _, pid, _, nid, _ in candidates} | {nid for _, _, _, nid, _ in candidates}
    meta_map = _batch_node_meta(db, label_ids)

    # 共同点抽取：graphify 语义边从 context 提「经概念」枢纽概念；标签边取两端共享标签名
    tag_pairs = [(pid, nid) for edge, pid, _, nid, _ in candidates if edge.edge_type == "tag"]
    shared_tags = _shared_tag_names(db, tag_pairs) if tag_pairs else {}

    bridges = []
    for edge, pid, pside, nid, nside in candidates:
        pmeta = meta_map.get(pid, {"label": pid, "type": "unknown", "url": None})
        nmeta = meta_map.get(nid, {"label": nid, "type": "unknown", "url": None})
        shared: List[str] = []
        if edge.edge_type == "graphify":
            m = _SHARED_CONCEPT_RE.search(edge.context or "")
            if m:
                shared = [s.strip() for s in m.group(1).split("、") if s.strip()]
        elif edge.edge_type == "tag":
            shared = shared_tags.get((pid, nid), [])
        if not shared:
            # 兜底：无枢纽概念/共享标签时用两端标题关键词交集（诚实：字面共现词）
            shared = _shared_title_keywords(pmeta["label"], nmeta["label"])
        bridges.append({
            "edge_id": edge.id,
            "personal_node": {"id": pid, "label": pmeta["label"], "brain_side": pside,
                              "type": pmeta["type"], "url": pmeta["url"]},
            "network_node": {"id": nid, "label": nmeta["label"], "brain_side": nside,
                             "type": nmeta["type"], "url": nmeta["url"]},
            "type": edge.edge_type,
            "strength": edge.strength,
            "context": edge.context,
            "shared_points": shared,
        })

    return {"bridges": bridges, "total": total}


@router.get("/tag-network", summary="Tag co-occurrence network", description="Get tag nodes and co-occurrence edges for the current user.")
async def get_tag_network(
    min_cooccurrence: int = Query(1, ge=1, description="Minimum co-occurrence count to include an edge"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return a network of tags where edges represent how often two tags appear on the same content."""
    # 空间口径（09-13 补）：标签与内容关联都限当前空间——标签按租户上下文过滤，
    # 共现统计只数本空间内容行（四类口径与 wiki _tag_type_specs 同源，
    # content_tags 无 user_id/tenant_id 列，必须 join 内容表收口）
    # 四类口径内联（开源版无 wiki_service；与主仓 wiki_service.members._tag_type_specs 同源）
    from app.models.base import Document as _Doc

    def _tag_type_specs():
        return [
            ("note", Note, Note.status == "active"),
            ("knowledge", KnowledgeUnit, KnowledgeUnit.status == "active"),
            ("clip", BrowserClip, BrowserClip.status == "active"),
            ("document", _Doc,
             (_Doc.doc_status == "active") & (_Doc.extraction_status == "success")),
        ]
    tenant = get_active_tenant(db, current_user)
    tags = db.query(Tag).filter(scope_condition(Tag, current_user.id, tenant)).all()
    tag_map = {tag.id: tag for tag in tags}

    # Fetch content-tag associations for in-scope content only
    rows = []
    if tag_map:
        for ctype, model, cond in _tag_type_specs():
            rows.extend(
                db.query(content_tags.c.content_id, content_tags.c.tag_id)
                .join(model, (model.id == content_tags.c.content_id)
                      & (content_tags.c.content_type == ctype))
                .filter(
                    content_tags.c.tag_id.in_(list(tag_map.keys())),
                    scope_condition(model, current_user.id, tenant),
                    cond,
                )
                .all()
            )

    # Group by content_id -> list of tag_ids
    content_tags_map: Dict[str, List[str]] = defaultdict(list)
    for content_id, tag_id in rows:
        content_tags_map[content_id].append(tag_id)

    # Count co-occurrences
    cooccurrence: Dict[Tuple[str, str], int] = defaultdict(int)
    for tag_ids in content_tags_map.values():
        unique = sorted(set(tag_ids))
        for i in range(len(unique)):
            for j in range(i + 1, len(unique)):
                pair = (unique[i], unique[j])
                cooccurrence[pair] += 1

    edges = [
        {
            "source": source,
            "target": target,
            "source_name": tag_map[source].name,
            "target_name": tag_map[target].name,
            "weight": count,
        }
        for (source, target), count in cooccurrence.items()
        if count >= min_cooccurrence and source in tag_map and target in tag_map
    ]

    # Compute usage count per tag from the association rows
    tag_usage: Dict[str, int] = defaultdict(int)
    for _, tag_id in rows:
        if tag_id in tag_map:
            tag_usage[tag_id] += 1

    nodes = [
        {
            "id": tag.id,
            "name": tag.name,
            "color": tag.color or "#8b949e",
            "usage_count": tag_usage.get(tag.id, 0),
        }
        for tag in tags
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 路径探索（09-02 重写）：双源自家 BFS，结构化输出 + 直达原文路由。
# 旧实现转发 graphify CLI `path a b`——英文散文文本，datalist 选 id 难用，全拆。
# physical=相似度图（免构建，内容节点）；semantic=语义图（需构建，概念节点）。


class PathExploreRequest(BaseModel):
    a: str
    b: str
    src: str = "physical"  # physical | semantic
    cross_only: bool = False  # 只看跨脑路径（仅 physical 有意义；语义图概念不分脑）


def _bfs_path(adj: Dict[str, List[Tuple[str, dict]]], a: str, b: str,
              cross_only: bool = False,
              side_of: Optional[Dict[str, Optional[str]]] = None) -> Optional[List[Tuple[str, Optional[dict]]]]:
    """最短跳数 BFS（无权，同跳数下先到先赢）。返回 [(node_id, 进入该节点的边)]，首跳边为 None。

    cross_only=True 时路径必须至少跨一次脑（personal↔network）：状态扩成
    (node, 是否已跨脑)，目标态要求 crossed。side_of 缺省或某端未知（标签节点）
    的边不算跨脑。"""
    from collections import deque
    if a == b:
        return [(a, None)] if not cross_only else None

    def _is_cross(e: Optional[dict]) -> bool:
        return bool(e and e.get("cross_brain"))

    start = (a, False)
    prev: Dict[Tuple[str, bool], Tuple[Optional[Tuple[str, bool]], Optional[dict]]] = {start: (None, None)}
    q = deque([start])
    while q:
        cur_node, cur_crossed = q.popleft()
        for nxt, edge in adj.get(cur_node, []):
            crossed = cur_crossed or _is_cross(edge)
            state = (nxt, crossed)
            if state in prev:
                continue
            prev[state] = ((cur_node, cur_crossed), edge)
            if nxt == b and (not cross_only or crossed):
                path: List[Tuple[str, Optional[dict]]] = []
                st: Optional[Tuple[str, bool]] = state
                while st is not None:
                    p, e = prev[st]
                    path.append((st[0], e))
                    st = p
                path.reverse()
                return path
            q.append(state)
    return None


def _physical_route(node: dict) -> Optional[str]:
    t = node.get("file_type")
    if t == "note":
        return f"/ingest/notes/{node['id']}"
    if t == "clip":
        return node.get("source_url") or "/ingest/clipper"
    if t == "knowledge":
        return "/knowledge/all"
    if t == "document":
        return "/ingest/documents"
    return None  # tag 节点/胶囊等不给入口


def _physical_path(db: Session, user_id: str, a: str, b: str, cross_only: bool = False,
                   tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """相似度图路径：内容节点 BFS（边=相似/标签/手动关联，关系词本就中文）。
    带脑侧：hop 带 brain_side；边带 cross_brain 标记；cross_only=只看跨脑路径。"""
    # 开源版无 physical_graph_service（剥离面）：相似度图不可用
    return {"ok": False, "error": "开源本地版不含相似度图（physical graph），请使用语义图"}
    g = build_physical_graph(db, user_id, tenant_id=tenant_id)
    nodes = {n["id"]: n for n in g.get("nodes", [])}
    if a not in nodes or b not in nodes:
        return {"ok": False, "error": "内容不在相似度图里（需 active 且有正文）"}

    def _side(nid: str) -> Optional[str]:
        n = nodes.get(nid) or {}
        return (n.get("source") or {}).get("brain_side")

    adj: Dict[str, List[Tuple[str, dict]]] = defaultdict(list)
    # 手动边先进邻接表：同跳数 BFS 先到先赢——手动关联是用户的显式断言，压过机器边
    ordered_links = sorted(g.get("links", []),
                           key=lambda l: 0 if l.get("edge_type") == "manual" else 1)
    for l in ordered_links:
        sa, sb = _side(l["source"]), _side(l["target"])
        info = {"relation": l.get("relation") or "相关",
                "confidence": l.get("confidence"), "weight": l.get("weight"),
                "cross_brain": bool(sa and sb and sa != sb)}
        adj[l["source"]].append((l["target"], info))
        adj[l["target"]].append((l["source"], info))
    path = _bfs_path(adj, a, b, cross_only=cross_only)
    if not path:
        err = "这两点之间没有跨脑路径" if cross_only else None
        return {"ok": True, "found": False, "hops": [], "src": "physical", **({"error_hint": err} if err else {})}
    hops = [{
        "id": nid,
        "label": nodes[nid].get("label"),
        "type": nodes[nid].get("file_type"),
        "brain_side": _side(nid),
        "url": nodes[nid].get("source_url"),
        "route": _physical_route(nodes[nid]),
        "via": edge,
    } for nid, edge in path]
    return {"ok": True, "found": True, "hops": hops, "length": len(hops) - 1, "src": "physical"}


def _semantic_path(user_id: str, a: str, b: str, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """语义图路径：概念节点 BFS（graph.json 本地文件，零 LLM 零 CLI）。
    产物按空间读（09-12）：团队空间读团队目录的 graph.json。"""
    from app.services import graphify_service as gfs
    from app.services.graph_report_zh import _source_route
    from app.services.graph_predicates import build_zh_table
    _RELATION_ZH = build_zh_table()  # 开源版 llm 是单文件形态，谓词表直取 graph_predicates
    gp = gfs._graph_json_path(user_id, tenant_id)
    if not gp.exists():
        return {"ok": False, "error": "语义图尚未构建——可以先切到「相似度图」免构建探索"}
    g = json.loads(gp.read_text(encoding="utf-8"))
    nodes = {n.get("id"): n for n in g.get("nodes", [])}
    if a not in nodes or b not in nodes:
        return {"ok": False, "error": "节点不在语义图里（可能重建后 id 变了，请重新选择）"}
    adj: Dict[str, List[Tuple[str, dict]]] = defaultdict(list)
    for l in g.get("links", []):
        info = {"relation": _RELATION_ZH.get((l.get("relation") or "").lower(), l.get("relation") or "相关"),
                "confidence": l.get("confidence"), "weight": l.get("weight")}
        adj[l["source"]].append((l["target"], info))
        adj[l["target"]].append((l["source"], info))
    path = _bfs_path(adj, a, b)
    if not path:
        return {"ok": True, "found": False, "hops": [], "src": "semantic"}
    hops = [{
        "id": nid,
        "label": nodes[nid].get("label") or nid,
        "type": nodes[nid].get("file_type"),
        "url": nodes[nid].get("source_url"),
        "route": _source_route(nodes[nid]),
        "via": edge,
    } for nid, edge in path]
    return {"ok": True, "found": True, "hops": hops, "length": len(hops) - 1, "src": "semantic"}


@router.post("/path-explore", summary="Path explore", description="Structured shortest path between two nodes over physical or semantic graph.")
async def path_explore(
    req: PathExploreRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if req.a == req.b:
        return {"ok": False, "error": "起点和终点是同一个"}
    # 物理/语义图都按当前空间取（团队空间=团队内容/团队产物，个人空间=本人个人行）
    tenant = get_active_tenant(db, current_user)
    tenant_id = tenant.id if tenant else None
    if req.src == "semantic":
        return _semantic_path(current_user.id, req.a, req.b, tenant_id=tenant_id)
    return _physical_path(db, current_user.id, req.a, req.b, cross_only=req.cross_only,
                          tenant_id=tenant_id)


# ─────────────────────────────────────────────────────────────────────────────
# 手动双链（edge_type="manual"）：用户显式关联两条内容。
# 战略价值：sync_edges_from_build 全量重建只清 edge_type=="graphify" AND
# auto_created==True 的边，manual 边天然活过图谱重建。


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# 四表轮查的固定顺序（与 _resolve_node_brain_side 一致）
_CONTENT_TABLES = [(Note, "note"), (Capsule, "capsule"), (BrowserClip, "clip"), (KnowledgeUnit, "knowledge")]


def _resolve_owned_content(db: Session, current_user: User, tenant, content_id: str):
    """四表轮查 + 空间口径 ownership（个人=本人且 tenant 为空；租户上下文=同租户内容）。
    命中返回 (obj, type_name)，未命中 (None, None)。"""
    for Model, type_name in _CONTENT_TABLES:
        obj = db.query(Model).filter(
            Model.id == content_id, scope_condition(Model, current_user.id, tenant)
        ).first()
        if obj is not None:
            return obj, type_name
    return None, None


def _resolve_node_brief(db: Session, node_id: str) -> Optional[Dict[str, Any]]:
    """四表轮查节点摘要（标题口径同 _build_node_dict）；内容已删除返回 None。"""
    for Model, type_name in _CONTENT_TABLES:
        obj = db.query(Model).filter(Model.id == node_id).first()
        if obj is not None:
            d = _build_node_dict(db, obj, type_name)
            return {"id": d["id"], "title": d["label"], "type": d["type"], "brain_side": d["brain_side"]}
    return None


def _edge_scope_cond(tenant, user_id: str):
    """边的空间口径（与 _create_edge 的去重口径一致）：团队边按租户，个人边本人且 tenant 为空。"""
    if tenant is not None:
        return GraphEdge.tenant_id == tenant.id
    return and_(GraphEdge.user_id == user_id, GraphEdge.tenant_id.is_(None))


def _edge_out(db: Session, edge: GraphEdge, peer_id: str, created: bool) -> Dict[str, Any]:
    return {
        "id": edge.id,
        "source_id": edge.source_id,
        "target_id": edge.target_id,
        "edge_type": edge.edge_type,
        "weight": edge.weight or 1.0,
        "context": edge.context,
        "created": created,
        "peer": _resolve_node_brief(db, peer_id),
    }


@router.post("/edges", response_model=ManualEdgeOut, summary="Create a manual edge",
             description="Manually link two content items. Idempotent: returns the existing edge with created=false when the pair is already linked.")
async def create_manual_edge(
    request: ManualEdgeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if request.source_id == request.target_id:
        raise HTTPException(status_code=400, detail="不能关联自身")
    tenant = get_active_tenant(db, current_user)
    src_obj, _ = _resolve_owned_content(db, current_user, tenant, request.source_id)
    if src_obj is None:
        raise HTTPException(status_code=404, detail="源内容不存在")
    tgt_obj, _ = _resolve_owned_content(db, current_user, tenant, request.target_id)
    if tgt_obj is None:
        raise HTTPException(status_code=404, detail="目标内容不存在")

    edge = _create_edge(
        db, current_user.id, request.source_id, request.target_id,
        _resolve_node_brain_side(db, request.source_id),
        _resolve_node_brain_side(db, request.target_id),
        "manual", 1.0,
        request.context or "",
        auto_created=False,
        dedupe_same_type=True,
    )
    if edge is None:
        # _create_edge 双向去重命中（自环已在上游 400 拦截）：幂等返回既有手动边
        existing = db.query(GraphEdge).filter(
            _edge_scope_cond(tenant, current_user.id),
            GraphEdge.edge_type == "manual",
            or_(
                and_(GraphEdge.source_id == request.source_id, GraphEdge.target_id == request.target_id),
                and_(GraphEdge.source_id == request.target_id, GraphEdge.target_id == request.source_id),
            ),
        ).first()
        if existing is None:
            # 理论上到不了（自环已拦），兜底按冲突处理
            raise HTTPException(status_code=409, detail="关联创建冲突，请重试")
        return _edge_out(db, existing, request.target_id, created=False)

    db.commit()
    return _edge_out(db, edge, request.target_id, created=True)


@router.get("/edges", response_model=ManualEdgeListResponse, summary="List manual edges of a content item",
            description="Bidirectional list of manual edges touching the given content id, with peer node info.")
async def list_manual_edges(
    content_id: str = Query(..., description="Content id (note/capsule/clip/knowledge)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    obj, _ = _resolve_owned_content(db, current_user, tenant, content_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="内容不存在")

    edges = db.query(GraphEdge).filter(
        _edge_scope_cond(tenant, current_user.id),
        GraphEdge.edge_type == "manual",
        or_(GraphEdge.source_id == content_id, GraphEdge.target_id == content_id),
    ).order_by(GraphEdge.created_at.desc()).all()

    items = []
    for e in edges:
        peer_id = e.target_id if e.source_id == content_id else e.source_id
        items.append(ManualEdgeListItem(
            id=e.id, source_id=e.source_id, target_id=e.target_id,
            context=e.context, weight=e.weight or 1.0,
            peer=_resolve_node_brief(db, peer_id),
        ))
    return {"edges": items, "total": len(items)}


@router.get("/edges/suggestions", response_model=LinkSuggestionsResponse, summary="Manual-link candidate suggestions",
            description="Three-tier candidates: graph neighbors by weight -> embedding cosine [0.55,0.85] -> recent content fallback. No LLM calls.")
async def link_suggestions(
    content_id: str = Query(..., description="Content id (note/capsule/clip/knowledge)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    obj, _ = _resolve_owned_content(db, current_user, tenant, content_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="内容不存在")

    scope_cond = _edge_scope_cond(tenant, current_user.id)
    # 排除自身与已是 manual 邻居的条目（再推荐无意义）
    excluded = {content_id}
    manual_edges = db.query(GraphEdge).filter(
        scope_cond,
        GraphEdge.edge_type == "manual",
        or_(GraphEdge.source_id == content_id, GraphEdge.target_id == content_id),
    ).all()
    for e in manual_edges:
        excluded.add(e.target_id if e.source_id == content_id else e.source_id)

    candidates: List[Dict[str, Any]] = []
    seen = set(excluded)
    pairing = "recent"

    # ① 图谱邻居（graphify/manual 边）按 weight 降序
    neighbor_edges = db.query(GraphEdge).filter(
        scope_cond,
        GraphEdge.edge_type.in_(["graphify", "manual"]),
        or_(GraphEdge.source_id == content_id, GraphEdge.target_id == content_id),
    ).order_by(GraphEdge.weight.desc()).all()
    for e in neighbor_edges:
        pid = e.target_id if e.source_id == content_id else e.source_id
        if pid in seen:
            continue
        seen.add(pid)
        candidates.append({"content_id": pid, "similarity": e.weight or 0.0})
    if candidates:
        pairing = "graphify"

    # ② 不足 5 条补 embeddings 余弦 [0.55,0.85]（不限 content_type）
    if len(candidates) < 5:
        # 团队空间：锚点内容可能是其他成员建的，向量行 user_id 记创建者——
        # 按 content_id 取向量，不按当前用户限（个人空间维持本人口径不变）
        own_emb_q = db.query(Embedding).filter(Embedding.content_id == content_id)
        if tenant is None:
            own_emb_q = own_emb_q.filter(Embedding.user_id == current_user.id)
        own_emb = own_emb_q.first()
        if own_emb is not None:
            try:
                vec_a = json.loads(own_emb.embedding_json)
                sims: List[Dict[str, Any]] = []
                # 开源版无 vec_index 影子索引（剥离面）：直接走 Embedding 表逐行余弦兜底
                from app.services.embedding_service import similarity_profile as _sim_profile
                _band = _sim_profile()
                _lo, _hi = _band["band_low"], _band["band_high"]
                scan = None
                if scan is not None:
                    content_by_eid = {
                        r.id: r.content_id
                        for r in db.query(Embedding.id, Embedding.content_id).filter(
                            Embedding.id.in_([eid for eid, _ in scan]),
                            Embedding.content_id != content_id,
                        ).all()
                    } if scan else {}
                    for eid, distance in scan:
                        cid = content_by_eid.get(eid)
                        if cid is None or cid in seen:
                            continue
                        sim = 1.0 - distance
                        if _lo <= sim <= _hi:
                            sims.append({"content_id": cid, "similarity": sim})
                else:
                    others_q = db.query(Embedding).filter(Embedding.content_id != content_id)
                    if tenant is None:
                        others_q = others_q.filter(Embedding.user_id == current_user.id)
                    others = others_q.limit(200).all()
                    for emb in others:
                        if emb.content_id in seen:
                            continue
                        try:
                            sim = _cosine_similarity(vec_a, json.loads(emb.embedding_json))
                        except Exception:
                            continue
                        if _lo <= sim <= _hi:
                            sims.append({"content_id": emb.content_id, "similarity": sim})
                sims.sort(key=lambda x: x["similarity"], reverse=True)
                for c in sims:
                    if len(candidates) >= 5:
                        break
                    # 空间隔离兜底：跨空间/已删内容不推荐（暴力路径不按空间取向量，
                    # 团队/个人双向都靠这道回表校验收口）
                    obj, _t = _resolve_owned_content(db, current_user, tenant, c["content_id"])
                    if obj is None:
                        continue
                    seen.add(c["content_id"])
                    candidates.append(c)
                if sims and pairing != "graphify":
                    pairing = "embedding"
            except Exception:
                pass

    # ③ 再不足补最近内容兜底（similarity 0.6）
    if len(candidates) < 5:
        for Model, _type_name in _CONTENT_TABLES:
            if len(candidates) >= 5:
                break
            rows = db.query(Model).filter(
                scope_condition(Model, current_user.id, tenant)
            ).order_by(Model.created_at.desc()).limit(10).all()
            for row in rows:
                if len(candidates) >= 5:
                    break
                if row.id in seen:
                    continue
                seen.add(row.id)
                candidates.append({"content_id": row.id, "similarity": 0.6})

    # 截 top5，四表轮查补标题和类型（已删除的内容跳过）
    result = []
    for c in candidates[:5]:
        brief = _resolve_node_brief(db, c["content_id"])
        if brief is None:
            continue
        result.append({
            "content_id": c["content_id"],
            "title": brief["title"],
            "type": brief["type"],
            "similarity": round(c["similarity"], 3),
        })
    return {"candidates": result, "pairing": pairing}


@router.delete("/edges/{edge_id}", summary="Delete a manual edge",
               description="Only manual edges in the caller's space can be deleted; anything else returns 404.")
async def delete_manual_edge(
    edge_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    edge = db.query(GraphEdge).filter(
        GraphEdge.id == edge_id,
        GraphEdge.edge_type == "manual",
        _edge_scope_cond(tenant, current_user.id),
    ).first()
    if edge is None:
        raise HTTPException(status_code=404, detail="关联不存在")
    db.delete(edge)
    db.commit()
    return {"deleted": True, "id": edge_id}
