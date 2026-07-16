from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, text
from typing import List, Optional, Dict, Any
import json

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import (
    User, Note, BrowserClip, KnowledgeUnit, Capsule, GraphEdge, Tag, content_tags
)
from app.schemas.brain import (
    BrainStatus, BrainSwitchRequest, FusionSearchRequest, FusionSearchResponse,
    FusionSearchResult, CrossLinkCreate, CrossLinkResponse, CrossBrainGraph, BrainSide
)
from app.services.embedding_service import embedding_service

router = APIRouter()


@router.get("/status", response_model=BrainStatus, summary="Brain status", description="Get current brain status from database.")
async def get_brain_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Read from DB, fallback to session-like default
    active_brain = current_user.active_brain or "personal"
    personal_count = (
        db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active").count()
        + db.query(Capsule).filter(Capsule.user_id == current_user.id).count()
    )
    network_count = (
        db.query(BrowserClip).filter(BrowserClip.user_id == current_user.id, BrowserClip.status == "active").count()
        + db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id).count()
    )
    both_count = db.query(GraphEdge).filter(
        GraphEdge.user_id == current_user.id, GraphEdge.cross_brain == True
    ).count()

    return BrainStatus(
        active_brain=active_brain,
        personal_count=personal_count,
        network_count=network_count,
        both_count=both_count,
        total_items=personal_count + network_count,
    )


@router.post("/switch", response_model=BrainStatus, summary="Switch brain", description="Switch active brain context and persist to DB.")
async def switch_brain(
    request: BrainSwitchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # BrainSide is a str Enum; use .value to get the actual string
    new_val = request.target_brain.value
    current_user.active_brain = new_val
    db.commit()
    db.refresh(current_user)
    return await get_brain_status(db, current_user)


def _extract_snippet(text: Optional[str], query: str, radius: int = 50) -> str:
    """Extract a snippet around the first query match."""
    if not text:
        return ""
    text_lower = text.lower()
    query_lower = query.lower()
    idx = text_lower.find(query_lower)
    if idx == -1:
        # Try word-by-word match
        words = query_lower.split()
        for w in words:
            idx = text_lower.find(w)
            if idx != -1:
                break
    if idx == -1:
        return text[:200] + "..." if len(text) > 200 else text
    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet


def _highlight(text: Optional[str], query: str) -> str:
    """Simple highlight by wrapping query in markers."""
    if not text:
        return ""
    # Escape regex special chars in query
    import re
    words = [w for w in query.lower().split() if len(w) >= 2]
    result = text
    for w in words:
        pattern = re.compile(re.escape(w), re.IGNORECASE)
        result = pattern.sub(lambda m: f"[[{m.group()}]]", result)
    return result


@router.post("/fusion-search", response_model=FusionSearchResponse, summary="Fusion search", description="Search across both brains with hybrid ranking.")
async def fusion_search(
    request: FusionSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = request.query.lower().strip()
    brain_sides = request.brain_sides or []
    if request.brain_side:
        brain_sides = [request.brain_side]
    if not brain_sides:
        brain_sides = [BrainSide.PERSONAL, BrainSide.NETWORK]
    results: List[Dict[str, Any]] = []
    limit = request.limit or 20

    # --- Personal brain search (notes + capsules) ---
    if BrainSide.PERSONAL in brain_sides or BrainSide.BOTH in brain_sides:
        # Notes: title + content FTS-like match
        notes = db.query(Note).filter(
            Note.user_id == current_user.id,
            Note.status == "active",
            or_(
                Note.title.ilike(f"%{query}%"),
                Note.content.ilike(f"%{query}%")
            )
        ).limit(limit * 2).all()

        for note in notes:
            title_match = query in (note.title or "").lower()
            content_match = query in (note.content or "").lower()
            fts_score = (0.6 if title_match else 0.0) + (0.3 if content_match else 0.0)
            # Semantic score fallback (0.5 if no embedding)
            semantic_score = 0.5
            # Hybrid: 60% FTS + 40% semantic
            relevance = fts_score * 0.6 + semantic_score * 0.4
            snippet = _extract_snippet(note.content or note.title, request.query)
            results.append({
                "id": note.id,
                "type": "note",
                "title": _highlight(note.title, request.query),
                "brain_side": BrainSide.PERSONAL,
                "content": _highlight(snippet, request.query),
                "relevance_score": round(relevance, 3),
                "source_url": None,
                "created_at": note.created_at.isoformat() if note.created_at else "",
                "raw_title": note.title,
            })

        # Capsules
        capsules = db.query(Capsule).filter(
            Capsule.user_id == current_user.id,
            Capsule.content_body.ilike(f"%{query}%")
        ).limit(limit).all()

        for cap in capsules:
            relevance = 0.75
            snippet = _extract_snippet(cap.content_body, request.query)
            results.append({
                "id": cap.id,
                "type": "capsule",
                "title": _highlight(cap.content_body[:50], request.query),
                "brain_side": BrainSide.PERSONAL,
                "content": _highlight(snippet, request.query),
                "relevance_score": round(relevance, 3),
                "source_url": None,
                "created_at": cap.created_at.isoformat() if cap.created_at else "",
                "raw_title": cap.content_body[:50],
            })

    # --- Network brain search (clips + knowledge) ---
    if BrainSide.NETWORK in brain_sides or BrainSide.BOTH in brain_sides:
        clips = db.query(BrowserClip).filter(
            BrowserClip.user_id == current_user.id,
            BrowserClip.status == "active",
            or_(
                BrowserClip.title.ilike(f"%{query}%"),
                BrowserClip.excerpt.ilike(f"%{query}%"),
                BrowserClip.full_text.ilike(f"%{query}%")
            )
        ).limit(limit * 2).all()

        for clip in clips:
            title_match = query in (clip.title or "").lower()
            excerpt_match = query in (clip.excerpt or "").lower()
            fts_score = (0.6 if title_match else 0.0) + (0.3 if excerpt_match else 0.0)
            relevance = fts_score * 0.6 + 0.5 * 0.4
            snippet = _extract_snippet(clip.excerpt or clip.full_text, request.query)
            results.append({
                "id": clip.id,
                "type": "clip",
                "title": _highlight(clip.title, request.query),
                "brain_side": BrainSide.NETWORK,
                "content": _highlight(snippet, request.query),
                "relevance_score": round(relevance, 3),
                "source_url": clip.url,
                "created_at": clip.created_at.isoformat() if clip.created_at else "",
                "raw_title": clip.title,
            })

        knowledge = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.user_id == current_user.id,
            KnowledgeUnit.content_raw.ilike(f"%{query}%")
        ).limit(limit * 2).all()

        for ku in knowledge:
            relevance = 0.78
            snippet = _extract_snippet(ku.content_raw, request.query)
            results.append({
                "id": ku.id,
                "type": "knowledge",
                "title": _highlight(ku.content_raw[:50], request.query),
                "brain_side": BrainSide.NETWORK,
                "content": _highlight(snippet, request.query),
                "relevance_score": round(relevance, 3),
                "source_url": ku.source_url,
                "created_at": ku.created_at.isoformat() if ku.created_at else "",
                "raw_title": ku.content_raw[:50],
            })

    # Sort by relevance descending
    results.sort(key=lambda x: x["relevance_score"], reverse=True)
    total = len(results)
    sliced = results[request.offset:request.offset + limit]

    # Build Pydantic-compatible response (remove raw_title helper)
    for r in sliced:
        r.pop("raw_title", None)

    return FusionSearchResponse(
        results=[FusionSearchResult(**r) for r in sliced],
        total=total,
        query=request.query,
        brain_sides=brain_sides,
    )


@router.get("/search", response_model=FusionSearchResponse, summary="Search (GET)", description="Alias for fusion-search using a query parameter.")
async def search_get(
    q: str = Query(..., min_length=1, max_length=1000, description="Search query"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await fusion_search(
        FusionSearchRequest(query=q, limit=limit, offset=offset),
        db,
        current_user,
    )


@router.post("/search", response_model=FusionSearchResponse, summary="Search (POST)", description="Alias for fusion-search using a JSON body.")
async def search_post(
    request: FusionSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await fusion_search(request, db, current_user)


@router.get("/search/suggestions", summary="Search suggestions", description="Get search suggestions based on user history and popular tags.")
async def get_search_suggestions(
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    suggestions: List[str] = []
    # 1. Popular tags
    tags = db.query(Tag).filter(Tag.user_id == current_user.id).limit(10).all()
    for t in tags:
        if t.name not in suggestions:
            suggestions.append(t.name)
    # 2. Recent note titles (partial match)
    if q:
        notes = db.query(Note).filter(
            Note.user_id == current_user.id,
            Note.status == "active",
            Note.title.ilike(f"%{q}%")
        ).limit(5).all()
        for n in notes:
            if n.title not in suggestions:
                suggestions.append(n.title)
    # 3. Knowledge source domains
    domains = db.query(BrowserClip.domain).filter(
        BrowserClip.user_id == current_user.id,
        BrowserClip.status == "active",
        BrowserClip.domain != None
    ).distinct().limit(5).all()
    for d in domains:
        if d[0] and d[0] not in suggestions:
            suggestions.append(d[0])

    return {"suggestions": suggestions[:10]}


@router.get("/stats", summary="Brain stats", description="Get detailed personal/network/fusion statistics.")
async def get_brain_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Personal stats
    note_count = db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active").count()
    capsule_count = db.query(Capsule).filter(Capsule.user_id == current_user.id).count()
    tag_count = db.query(Tag).filter(Tag.user_id == current_user.id).count()
    total_words = 0
    for note in db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active").all():
        total_words += len((note.content or "").split())
    for cap in db.query(Capsule).filter(Capsule.user_id == current_user.id).all():
        total_words += len((cap.content_body or "").split())

    # Network stats
    clip_count = db.query(BrowserClip).filter(BrowserClip.user_id == current_user.id, BrowserClip.status == "active").count()
    knowledge_count = db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id).count()
    domains = db.query(BrowserClip.domain).filter(
        BrowserClip.user_id == current_user.id, BrowserClip.status == "active", BrowserClip.domain != None
    ).distinct().count()
    verified = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.verification_status == "confirmed"
    ).count()

    # Fusion stats
    cross_brain_edges = db.query(GraphEdge).filter(
        GraphEdge.user_id == current_user.id, GraphEdge.cross_brain == True
    ).count()
    total_content = note_count + capsule_count + clip_count + knowledge_count
    fusion_ratio = round(cross_brain_edges / max(total_content, 1), 4)

    return {
        "personal": {
            "notes": note_count,
            "capsules": capsule_count,
            "tags": tag_count,
            "total_chars": total_words,
        },
        "network": {
            "clips": clip_count,
            "knowledge": knowledge_count,
            "domains": domains,
            "verified": verified,
        },
        "fusion": {
            "cross_brain_links": cross_brain_edges,
            "fusion_ratio": fusion_ratio,
            "collaboration_count": cross_brain_edges,
        }
    }


@router.post("/cross-link", summary="Create cross-brain link", description="Create an association between personal and network brain items.")
async def create_cross_link(
    request: CrossLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Verify ownership of source and target
    owned = False
    for Model in [Note, Capsule, BrowserClip, KnowledgeUnit]:
        if db.query(Model).filter(Model.id == request.source_id, Model.user_id == current_user.id).first():
            owned = True
            break
    if not owned:
        raise HTTPException(status_code=404, detail="Source item not found")
    
    owned = False
    for Model in [Note, Capsule, BrowserClip, KnowledgeUnit]:
        if db.query(Model).filter(Model.id == request.target_id, Model.user_id == current_user.id).first():
            owned = True
            break
    if not owned:
        raise HTTPException(status_code=404, detail="Target item not found")

    # Determine brain sides for source and target
    source_brain = "unknown"
    target_brain = "unknown"
    
    if request.source_type in ["note", "capsule"]:
        source_brain = "personal"
    elif request.source_type in ["clip", "knowledge"]:
        source_brain = "network"
    
    if request.target_type in ["note", "capsule"]:
        target_brain = "personal"
    elif request.target_type in ["clip", "knowledge"]:
        target_brain = "network"
    
    cross_brain = source_brain != target_brain
    
    edge = GraphEdge(
        id=f"{request.source_id}-{request.target_id}",
        user_id=current_user.id,
        source_id=request.source_id,
        target_id=request.target_id,
        source_brain_side=source_brain,
        target_brain_side=target_brain,
        edge_type=request.link_type,
        strength=request.strength or 1.0,
        weight=request.strength or 1.0,
        context=request.context,
        cross_brain=cross_brain,
        auto_created=False,
    )
    
    db.merge(edge)
    db.commit()
    
    return CrossLinkResponse(
        id=edge.id,
        source_id=request.source_id,
        source_type=request.source_type,
        source_brain_side=source_brain,
        target_id=request.target_id,
        target_type=request.target_type,
        target_brain_side=target_brain,
        link_type=request.link_type,
        strength=request.strength,
        cross_brain=cross_brain,
        created_at=edge.created_at.isoformat() if edge.created_at else "",
    )


@router.get("/cross-brain-graph", summary="Cross-brain graph", description="Get the cross-brain association graph.")
async def get_cross_brain_graph(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Collect all user-owned content IDs
    user_ids = set()
    for Model in [Note, Capsule, BrowserClip, KnowledgeUnit]:
        for row in db.query(Model.id).filter(Model.user_id == current_user.id).all():
            user_ids.add(row[0])
    
    # Get cross-brain edges where both source and target belong to current user
    edges = db.query(GraphEdge).filter(
        GraphEdge.cross_brain == True,
        GraphEdge.source_id.in_(user_ids),
        GraphEdge.target_id.in_(user_ids),
    ).limit(100).all()
    
    node_ids = set()
    for edge in edges:
        node_ids.add(edge.source_id)
        node_ids.add(edge.target_id)
    
    # Build nodes from various tables (user-scoped)
    nodes = []
    for node_id in node_ids:
        # Try to find in each table (already verified ownership, but filter anyway)
        note = db.query(Note).filter(Note.id == node_id, Note.user_id == current_user.id).first()
        if note:
            nodes.append({
                "id": note.id,
                "label": note.title,
                "type": "note",
                "brain_side": "personal",
            })
            continue
        
        clip = db.query(BrowserClip).filter(BrowserClip.id == node_id, BrowserClip.user_id == current_user.id).first()
        if clip:
            nodes.append({
                "id": clip.id,
                "label": clip.title,
                "type": "clip",
                "brain_side": "network",
            })
            continue
        
        knowledge = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == node_id, KnowledgeUnit.user_id == current_user.id).first()
        if knowledge:
            nodes.append({
                "id": knowledge.id,
                "label": knowledge.content_raw[:30],
                "type": "knowledge",
                "brain_side": "network",
            })
            continue
        
        capsule = db.query(Capsule).filter(Capsule.id == node_id, Capsule.user_id == current_user.id).first()
        if capsule:
            nodes.append({
                "id": capsule.id,
                "label": capsule.content_body[:30],
                "type": "capsule",
                "brain_side": "personal",
            })
    
    edge_data = []
    for edge in edges:
        edge_data.append({
            "id": edge.id,
            "source": edge.source_id,
            "target": edge.target_id,
            "type": edge.edge_type,
            "cross_brain": edge.cross_brain,
            "strength": edge.strength,
            "weight": edge.weight,
        })
    
    return CrossBrainGraph(
        nodes=nodes,
        edges=edge_data,
        cross_brain_edges=len(edges),
        total_nodes=len(nodes),
        total_edges=len(edges),
    )
