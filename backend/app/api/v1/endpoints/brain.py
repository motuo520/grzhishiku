from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, text
from typing import List, Optional, Dict, Any
import json

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.crypto import decrypt_capsule_content
from app.models.base import (
    User, Note, BrowserClip, KnowledgeUnit, Capsule, GraphEdge, Tag, content_tags
)
from app.schemas.brain import (
    BrainStatus, BrainSwitchRequest, FusionSearchRequest, FusionSearchResponse,
    FusionSearchResult, CrossLinkCreate, CrossLinkResponse, CrossBrainGraph, BrainSide
)
from app.services.embedding_service import embedding_service

router = APIRouter()

# fusion-search 时间胶囊候选上限：正文落库为密文，匹配前必须逐条 AES 解密
# （无法 SQL 下推），大库不设限会拖死请求；notes/clips/knowledge 走 ILIKE
# 预过滤，匹配行 Python 打分很便宜，不设上限
_CAPSULE_FUSION_CANDIDATE_LIMIT = 2000


@router.get("/status", response_model=BrainStatus, summary="Brain status", description="Get current brain status from database.")
async def get_brain_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Read from DB, fallback to session-like default
    active_brain = current_user.active_brain or "personal"
    # 计数限当前空间：团队空间数团队内容，个人空间只数本人 tenant_id 为空的行
    from app.core.tenant_scope import get_active_tenant, scope_condition
    tenant = get_active_tenant(db, current_user)
    personal_count = (
        db.query(Note).filter(scope_condition(Note, current_user.id, tenant), Note.status == "active").count()
        + db.query(Capsule).filter(scope_condition(Capsule, current_user.id, tenant)).count()
    )
    network_count = (
        db.query(BrowserClip).filter(scope_condition(BrowserClip, current_user.id, tenant), BrowserClip.status == "active").count()
        + db.query(KnowledgeUnit).filter(scope_condition(KnowledgeUnit, current_user.id, tenant)).count()
    )
    both_count = db.query(GraphEdge).filter(
        scope_condition(GraphEdge, current_user.id, tenant), GraphEdge.cross_brain == True
    ).count()

    # 未归档条数（Dashboard 行动页「N 条待整理」）：口径与站内事实快照一致
    # （site_knowledge._folder_content_counts，note/clip/knowledge 三表 UNION，None 键=未归档）
    from app.services.site_knowledge import _folder_content_counts
    unfiled_count = _folder_content_counts(db, current_user.id, tenant, "both").get(None, 0)

    return BrainStatus(
        active_brain=active_brain,
        personal_count=personal_count,
        network_count=network_count,
        both_count=both_count,
        total_items=personal_count + network_count,
        unfiled_count=unfiled_count,
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
    escaped_query = query.replace("\\", "\\\\").replace("%", "\%").replace("_", "\_")
    brain_sides = request.brain_sides or []
    if request.brain_side:
        brain_sides = [request.brain_side]
    if not brain_sides:
        brain_sides = [BrainSide.PERSONAL, BrainSide.NETWORK]
    results: List[Dict[str, Any]] = []
    limit = request.limit or 20
    # 租户上下文：检索范围换团队内容（tenant_id=T），个人空间则限本人且 tenant_id 为空
    from app.core.tenant_scope import get_active_tenant, scope_condition
    tenant = get_active_tenant(db, current_user)

    # --- Personal brain search (notes + capsules) ---
    if BrainSide.PERSONAL in brain_sides or BrainSide.BOTH in brain_sides:
        # Notes: title + content FTS-like match
        notes = db.query(Note).filter(
            scope_condition(Note, current_user.id, tenant),
            Note.status == "active",
            or_(
                Note.title.ilike(f"%{escaped_query}%", escape="\\"),
                Note.content.ilike(f"%{escaped_query}%", escape="\\")
            )
        ).all()

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
                "origin": "user",
                "raw_title": note.title,
            })

        # Capsules：正文落库为密文，需解密后在 Python 侧匹配（无法 SQL ilike）；
        # 逐条解密前先按 updated_at 截断到上限，避免大库全量解密
        capsules = db.query(Capsule).filter(
            scope_condition(Capsule, current_user.id, tenant)
        ).order_by(Capsule.updated_at.desc()).limit(_CAPSULE_FUSION_CANDIDATE_LIMIT).all()

        for cap in capsules:
            body = decrypt_capsule_content(cap.content_body)
            if query not in body.lower():
                continue
            relevance = 0.75
            snippet = _extract_snippet(body, request.query)
            results.append({
                "id": cap.id,
                "type": "capsule",
                "title": _highlight(body[:50], request.query),
                "brain_side": BrainSide.PERSONAL,
                "content": _highlight(snippet, request.query),
                "relevance_score": round(relevance, 3),
                "source_url": None,
                "created_at": cap.created_at.isoformat() if cap.created_at else "",
                "origin": "user",
                "raw_title": body[:50],
            })

    # --- Network brain search (clips + knowledge) ---
    if BrainSide.NETWORK in brain_sides or BrainSide.BOTH in brain_sides:
        clips = db.query(BrowserClip).filter(
            scope_condition(BrowserClip, current_user.id, tenant),
            BrowserClip.status == "active",
            or_(
                BrowserClip.title.ilike(f"%{escaped_query}%", escape="\\"),
            BrowserClip.excerpt.ilike(f"%{escaped_query}%", escape="\\"),
            BrowserClip.full_text.ilike(f"%{escaped_query}%", escape="\\")
        )
    ).all()

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
                "origin": "user",
                "raw_title": clip.title,
            })

        knowledge = db.query(KnowledgeUnit).filter(
            scope_condition(KnowledgeUnit, current_user.id, tenant),
            KnowledgeUnit.content_raw.ilike(f"%{escaped_query}%", escape="\\")
        ).all()

        for ku in knowledge:
            ku_origin = "ai" if (ku.origin_type or "") == "llm_generated" else "user"
            if request.origin == "user" and ku_origin == "ai":
                continue  # 「只看我的原文」：排除管线提取/碰撞等 AI 产物
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
                "origin": ku_origin,
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
    origin: Optional[str] = Query(None, description="user=只看我的原文"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await fusion_search(
        FusionSearchRequest(query=q, limit=limit, offset=offset, origin=origin),
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
    # 建议来源限当前空间（与 fusion-search 同口径）
    from app.core.tenant_scope import get_active_tenant, scope_condition
    tenant = get_active_tenant(db, current_user)
    # 1. Popular tags
    tags = db.query(Tag).filter(scope_condition(Tag, current_user.id, tenant)).limit(10).all()
    for t in tags:
        if t.name not in suggestions:
            suggestions.append(t.name)
    # 2. Recent note titles (partial match)
    if q:
        # 与 fusion-search 同口径：LIKE 元字符 %/_ 按字面匹配
        escaped_q = q.replace("\\", "\\\\").replace("%", "\%").replace("_", "\_")
        notes = db.query(Note).filter(
            scope_condition(Note, current_user.id, tenant),
            Note.status == "active",
            Note.title.ilike(f"%{escaped_q}%", escape="\\")
        ).limit(5).all()
        for n in notes:
            if n.title not in suggestions:
                suggestions.append(n.title)
    # 3. Knowledge source domains
    domains = db.query(BrowserClip.domain).filter(
        scope_condition(BrowserClip, current_user.id, tenant),
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
    # 统计限当前空间（与 fusion-search 同口径）
    from app.core.tenant_scope import get_active_tenant, scope_condition
    tenant = get_active_tenant(db, current_user)
    # Personal stats
    note_count = db.query(Note).filter(scope_condition(Note, current_user.id, tenant), Note.status == "active").count()
    capsule_count = db.query(Capsule).filter(scope_condition(Capsule, current_user.id, tenant)).count()
    tag_count = db.query(Tag).filter(scope_condition(Tag, current_user.id, tenant)).count()
    note_chars = db.query(func.sum(func.length(Note.content))).filter(
        scope_condition(Note, current_user.id, tenant), Note.status == "active"
    ).scalar() or 0
    capsule_chars = sum(
        len(decrypt_capsule_content(row.content_body or ""))
        for row in db.query(Capsule.content_body).filter(scope_condition(Capsule, current_user.id, tenant)).all()
    )
    total_words = note_chars + capsule_chars

    # Network stats
    clip_count = db.query(BrowserClip).filter(scope_condition(BrowserClip, current_user.id, tenant), BrowserClip.status == "active").count()
    knowledge_count = db.query(KnowledgeUnit).filter(scope_condition(KnowledgeUnit, current_user.id, tenant)).count()
    domains = db.query(BrowserClip.domain).filter(
        scope_condition(BrowserClip, current_user.id, tenant), BrowserClip.status == "active", BrowserClip.domain != None
    ).distinct().count()
    verified = db.query(KnowledgeUnit).filter(
        scope_condition(KnowledgeUnit, current_user.id, tenant), KnowledgeUnit.verification_status == "confirmed"
    ).count()

    # Fusion stats
    cross_brain_edges = db.query(GraphEdge).filter(
        scope_condition(GraphEdge, current_user.id, tenant), GraphEdge.cross_brain == True
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
    # 归属校验限当前空间：跨空间建边直接 404，防止个人/团队内容被拴在一起
    from app.core.tenant_scope import get_active_tenant, scope_condition
    tenant = get_active_tenant(db, current_user)
    owned = False
    for Model in [Note, Capsule, BrowserClip, KnowledgeUnit]:
        if db.query(Model).filter(Model.id == request.source_id, scope_condition(Model, current_user.id, tenant)).first():
            owned = True
            break
    if not owned:
        raise HTTPException(status_code=404, detail="Source item not found")

    owned = False
    for Model in [Note, Capsule, BrowserClip, KnowledgeUnit]:
        if db.query(Model).filter(Model.id == request.target_id, scope_condition(Model, current_user.id, tenant)).first():
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
        tenant_id=tenant.id if tenant else None,
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
    # 图谱限当前空间：节点/边都按空间口径，跨空间内容不进图
    from app.core.tenant_scope import get_active_tenant, scope_condition
    tenant = get_active_tenant(db, current_user)
    user_ids = set()
    for Model in [Note, Capsule, BrowserClip, KnowledgeUnit]:
        for row in db.query(Model.id).filter(scope_condition(Model, current_user.id, tenant)).all():
            user_ids.add(row[0])

    # Get cross-brain edges where both source and target belong to current user
    edges = db.query(GraphEdge).filter(
        scope_condition(GraphEdge, current_user.id, tenant),
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
        note = db.query(Note).filter(Note.id == node_id, scope_condition(Note, current_user.id, tenant)).first()
        if note:
            nodes.append({
                "id": note.id,
                "label": note.title,
                "type": "note",
                "brain_side": "personal",
            })
            continue
        
        clip = db.query(BrowserClip).filter(BrowserClip.id == node_id, scope_condition(BrowserClip, current_user.id, tenant)).first()
        if clip:
            nodes.append({
                "id": clip.id,
                "label": clip.title,
                "type": "clip",
                "brain_side": "network",
            })
            continue
        
        knowledge = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == node_id, scope_condition(KnowledgeUnit, current_user.id, tenant)).first()
        if knowledge:
            nodes.append({
                "id": knowledge.id,
                "label": (knowledge.content_raw or '')[:30],
                "type": "knowledge",
                "brain_side": "network",
            })
            continue
        
        capsule = db.query(Capsule).filter(Capsule.id == node_id, scope_condition(Capsule, current_user.id, tenant)).first()
        if capsule:
            nodes.append({
                "id": capsule.id,
                "label": decrypt_capsule_content(capsule.content_body)[:30],
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
