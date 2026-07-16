"""Graphify-powered knowledge graph endpoints.

The graph is built per-user from their notes/clips/knowledge units by the
graphify CLI (see app.services.graphify_service). These endpoints expose build
status/control, the enriched graph JSON, plain-language query/path/explain,
and the generated markdown report.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, Note, BrowserClip, KnowledgeUnit
from app.services import graphify_service as gfs

router = APIRouter()


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)


class PathRequest(BaseModel):
    a: str = Field(..., min_length=1, max_length=300)
    b: str = Field(..., min_length=1, max_length=300)


class ExplainRequest(BaseModel):
    node: str = Field(..., min_length=1, max_length=300)


def _content_last_updated(db: Session, user_id: str) -> Optional[datetime]:
    latest: Optional[datetime] = None
    for model in (Note, BrowserClip, KnowledgeUnit):
        ts = (db.query(model.updated_at)
              .filter(model.user_id == user_id)
              .order_by(model.updated_at.desc())
              .limit(1)
              .scalar())
        if ts and (latest is None or ts > latest):
            latest = ts
    return latest


def _source_meta(db: Session, user_id: str) -> Dict[str, Dict[str, Any]]:
    """Map source_id -> {type, title, brain_side, url} for enriching graph nodes."""
    meta: Dict[str, Dict[str, Any]] = {}
    for n in db.query(Note).filter(Note.user_id == user_id).all():
        meta[n.id] = {"type": "note", "title": n.title, "brain_side": n.brain_side, "url": None}
    for c in db.query(BrowserClip).filter(BrowserClip.user_id == user_id).all():
        meta[c.id] = {"type": "clip", "title": c.title, "brain_side": c.brain_side, "url": c.url}
    for k in db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id).all():
        meta[k.id] = {"type": "knowledge", "title": k.source_title, "brain_side": k.brain_side, "url": k.source_url}
    return meta


@router.get("/status", summary="Graphify build status")
def graphify_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    st = gfs.get_build_status(current_user.id)
    graph = gfs.load_graph(current_user.id) if st.get("has_graph") else None

    last_built_at = None
    stale = False
    if graph is not None:
        path = gfs._graph_json_path(current_user.id)
        last_built_at = datetime.utcfromtimestamp(path.stat().st_mtime).isoformat() + "Z"
        content_ts = _content_last_updated(db, current_user.id)
        if content_ts:
            built_ts = datetime.utcfromtimestamp(path.stat().st_mtime)
            stale = content_ts.replace(tzinfo=None) > built_ts

    return {
        **st,
        "last_built_at": last_built_at,
        "stale": stale,
        "node_count": len(graph.get("nodes", [])) if graph else 0,
        "edge_count": len(graph.get("links", [])) if graph else 0,
    }


@router.post("/build", summary="Build or rebuild the user's knowledge graph")
def graphify_build(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    st = gfs.start_build_background(db, current_user.id)
    state = st.get("state")
    if state in ("exporting", "building"):
        return {"ok": True, "status": st}
    return {"ok": state == "done", "status": st}


@router.get("/graph", summary="Get the enriched knowledge graph")
def graphify_graph(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    graph = gfs.load_graph(current_user.id)
    if graph is None:
        raise HTTPException(status_code=404, detail="图谱尚未构建，请先点击「重建图谱」")

    meta = _source_meta(db, current_user.id)
    nodes: List[Dict[str, Any]] = []
    for node in graph.get("nodes", []):
        src = gfs.parse_source_from_node(node)
        enriched = {
            "id": node.get("id"),
            "label": node.get("label"),
            "file_type": node.get("file_type"),
            "community": node.get("community"),
            "source_url": node.get("source_url"),
            "captured_at": node.get("captured_at"),
        }
        if src and src["id"] in meta:
            enriched["source"] = meta[src["id"]]
        elif src:
            enriched["source"] = {"type": src["type"], "id": src["id"]}
        else:
            enriched["source"] = None
        nodes.append(enriched)

    links = [
        {
            "source": e.get("source"),
            "target": e.get("target"),
            "relation": e.get("relation"),
            "confidence": e.get("confidence"),
        }
        for e in graph.get("links", [])
    ]

    # node.community is a numeric id; human names come from cluster-only's labels file
    community_labels = gfs.load_community_labels(current_user.id)
    return {"nodes": nodes, "links": links, "community_labels": community_labels}


@router.post("/query", summary="Ask a plain-language question against the graph")
def graphify_query(
    req: QueryRequest,
    current_user: User = Depends(get_current_user),
):
    return gfs.query_graph(current_user.id, req.question)


@router.post("/path", summary="Shortest path between two graph nodes")
def graphify_path(
    req: PathRequest,
    current_user: User = Depends(get_current_user),
):
    return gfs.path_graph(current_user.id, req.a, req.b)


@router.post("/explain", summary="Explain a graph node and its neighbors")
def graphify_explain(
    req: ExplainRequest,
    current_user: User = Depends(get_current_user),
):
    return gfs.explain_graph(current_user.id, req.node)


@router.get("/report", summary="Get the generated markdown graph report")
def graphify_report(current_user: User = Depends(get_current_user)):
    path = gfs.graph_report_path(current_user.id)
    if path is None:
        raise HTTPException(status_code=404, detail="报告尚未生成，请先构建图谱")
    return {"content": path.read_text(encoding="utf-8")}
