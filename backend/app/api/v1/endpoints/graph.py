import re
import uuid
from collections import defaultdict
from typing import List, Dict, Any, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, Note, Capsule, BrowserClip, KnowledgeUnit, GraphEdge, Tag, content_tags

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
) -> Optional[GraphEdge]:
    """Create a graph edge if both source and target exist for the user."""
    if source_id == target_id:
        return None
    # Avoid duplicate edges (bidirectional check)
    existing = db.query(GraphEdge).filter(
        GraphEdge.user_id == user_id,
        or_(
            and_(GraphEdge.source_id == source_id, GraphEdge.target_id == target_id),
            and_(GraphEdge.source_id == target_id, GraphEdge.target_id == source_id),
        )
    ).first()
    if existing:
        return None

    s = source_brain_side or "unknown"
    t = target_brain_side or "unknown"
    cross_brain = s != t and s != "unknown" and t != "unknown"
    edge = GraphEdge(
        id=str(uuid.uuid4()),
        user_id=user_id,
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


def cleanup_content_edges(db: Session, content_id: str) -> int:
    """Delete graph edges referencing a piece of content. Call when content is deleted
    so soft/hard-deleted nodes don't linger as phantom nodes via their edges."""
    return db.query(GraphEdge).filter(
        or_(GraphEdge.source_id == content_id, GraphEdge.target_id == content_id)
    ).delete(synchronize_session=False)


def _resolve_node_brain_side(db: Session, node_id: str) -> str:
    """Resolve brain_side from content tables, fallback to 'unknown'."""
    for Model, default, attr in [
        (Note, "personal", "brain_side"),
        (Capsule, "personal", "brain_side"),
        (BrowserClip, "network", "brain_side"),
        (KnowledgeUnit, "network", "brain_side"),
    ]:
        obj = db.query(Model).filter(Model.id == node_id).first()
        if obj:
            side = getattr(obj, attr, None)
            return side if side else default
    return "unknown"


def _batch_brain_sides(db: Session, ids) -> Dict[str, str]:
    """Batch-resolve brain_side for many node ids (one query per content table)."""
    result: Dict[str, str] = {}
    remaining = set(ids)
    for Model, default, attr in [
        (Note, "personal", "brain_side"),
        (Capsule, "personal", "brain_side"),
        (BrowserClip, "network", "brain_side"),
        (KnowledgeUnit, "network", "brain_side"),
    ]:
        if not remaining:
            break
        rows = db.query(Model.id, getattr(Model, attr)).filter(Model.id.in_(remaining)).all()
        for rid, side in rows:
            result[rid] = side if side else default
            remaining.discard(rid)
    for rid in remaining:
        result[rid] = "unknown"
    return result


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
            "label": (obj.content_body or "Capsule")[:50],
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
    """Collect all graph nodes for a user."""
    nodes: List[Dict[str, Any]] = []
    for note in db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active").all():
        nodes.append(_build_node_dict(db, note, "note"))
    for capsule in db.query(Capsule).filter(Capsule.user_id == current_user.id).all():
        nodes.append(_build_node_dict(db, capsule, "capsule"))
    for clip in db.query(BrowserClip).filter(BrowserClip.user_id == current_user.id, BrowserClip.status == "active").all():
        nodes.append(_build_node_dict(db, clip, "clip"))
    for unit in db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id).all():
        nodes.append(_build_node_dict(db, unit, "knowledge"))
    for tag in db.query(Tag).filter(Tag.user_id == current_user.id).all():
        nodes.append(_build_node_dict(db, tag, "tag"))
    return nodes


def _compute_degrees(edges: List[GraphEdge]) -> Dict[str, int]:
    degrees: Dict[str, int] = defaultdict(int)
    for e in edges:
        degrees[e.source_id] += 1
        degrees[e.target_id] += 1
    return degrees


def _node_label(db: Session, node_id: str) -> str:
    for Model, attr in [(Note, "title"), (BrowserClip, "title"), (KnowledgeUnit, "content_raw"), (Capsule, "content_body")]:
        obj = db.query(Model).filter(Model.id == node_id).first()
        if obj:
            val = getattr(obj, attr, None) or node_id
            return (val if isinstance(val, str) else str(val))[:50]
    return node_id


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
            labels[rid] = (val if isinstance(val, str) else (str(val) if val else rid))[:50] if val else rid
            remaining.discard(rid)
    return labels


def _node_brain_side_from_edge(db: Session, edge: GraphEdge, node_id: str) -> str:
    """Return brain_side for a node referenced by an edge, with fallback."""
    side = edge.source_brain_side if edge.source_id == node_id else edge.target_brain_side
    if side:
        return side
    return _resolve_node_brain_side(db, node_id)


def _auto_link_for_clip(user_id: str, clip_id: str, db: Session):
    """Lightweight auto-link for a single new clip."""
    clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.user_id == user_id).first()
    if not clip:
        return
    knowledge = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id).all()
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
    notes = db.query(Note).filter(Note.user_id == user_id, Note.status == "active").all()
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
    clips = db.query(BrowserClip).filter(BrowserClip.user_id == user_id, BrowserClip.status == "active").all()
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
        other_note = db.query(Note).filter(Note.id == nt.content_id).first()
        other_side = other_note.brain_side or "personal" if other_note else "personal"
        _create_edge(
            db, user_id, note_id, nt.content_id,
            note.brain_side or "personal", other_side,
            "tag", 0.5,
            f"Shared tag",
        )
    # Similarity with other notes
    note_keywords = _extract_keywords(note.title + " " + note_content)
    other_notes_objs = db.query(Note).filter(Note.user_id == user_id, Note.status == "active", Note.id != note_id).all()
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
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    edges = db.query(GraphEdge).filter(
        GraphEdge.user_id == current_user.id
    ).all()

    # First pass: qualify by brain_side, keep edge data without per-bridge label queries
    candidates = []
    for edge in edges:
        s_side = _node_brain_side_from_edge(db, edge, edge.source_id)
        t_side = _node_brain_side_from_edge(db, edge, edge.target_id)
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
    label_map = _batch_node_labels(db, label_ids)

    bridges = [{
        "edge_id": edge.id,
        "personal_node": {"id": pid, "label": label_map.get(pid, pid), "brain_side": pside},
        "network_node": {"id": nid, "label": label_map.get(nid, nid), "brain_side": nside},
        "type": edge.edge_type,
        "strength": edge.strength,
        "context": edge.context,
    } for edge, pid, pside, nid, nside in candidates]

    return {"bridges": bridges, "total": total}


@router.get("/tag-network", summary="Tag co-occurrence network", description="Get tag nodes and co-occurrence edges for the current user.")
async def get_tag_network(
    min_cooccurrence: int = Query(1, ge=1, description="Minimum co-occurrence count to include an edge"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return a network of tags where edges represent how often two tags appear on the same content."""
    tags = db.query(Tag).filter(Tag.user_id == current_user.id).all()
    tag_map = {tag.id: tag for tag in tags}

    # Fetch all content-tag associations for this user
    rows = db.query(content_tags.c.content_id, content_tags.c.tag_id).filter(content_tags.c.tag_id.in_(list(tag_map.keys()))).all()

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
