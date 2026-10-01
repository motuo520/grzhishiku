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
from app.core.tenant_scope import get_active_tenant, scope_condition
from app.models.base import User, Note, BrowserClip, KnowledgeUnit
from app.services import graphify_service as gfs

router = APIRouter()


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    preferred_model: Optional[str] = Field(None, max_length=100)


class BuildRequest(BaseModel):
    preferred_model: Optional[str] = Field(None, max_length=100)


class PathRequest(BaseModel):
    a: str = Field(..., min_length=1, max_length=300)
    b: str = Field(..., min_length=1, max_length=300)


class ExplainRequest(BaseModel):
    node: str = Field(..., min_length=1, max_length=300)


class EntityDedupRequest(BaseModel):
    # 默认 True：预览优先，显式传 false 才真合并（消歧是写操作，默认零副作用）
    dry_run: bool = True


def _content_last_updated(db: Session, user_id: str, tenant=None) -> Optional[datetime]:
    """当前空间内容的最新更新时间（团队空间看整租户，个人空间只看本人空租户行）。"""
    latest: Optional[datetime] = None
    for model in (Note, BrowserClip, KnowledgeUnit):
        ts = (db.query(model.updated_at)
              .filter(scope_condition(model, user_id, tenant))
              .order_by(model.updated_at.desc())
              .limit(1)
              .scalar())
        if ts and (latest is None or ts > latest):
            latest = ts
    return latest


def _source_meta(db: Session, user_id: str, tenant=None) -> Dict[str, Dict[str, Any]]:
    """Map source_id -> {type, title, brain_side, url, evolution_stage} for enriching graph nodes."""
    meta: Dict[str, Dict[str, Any]] = {}
    for n in db.query(Note).filter(scope_condition(Note, user_id, tenant)).all():
        meta[n.id] = {"type": "note", "title": n.title, "brain_side": n.brain_side, "url": None,
                      "evolution_stage": n.evolution_stage or "collected"}
    for c in db.query(BrowserClip).filter(scope_condition(BrowserClip, user_id, tenant)).all():
        # clip 无进化阶段字段 → 落默认层（3D z 轴分层口径与物理图一致）
        meta[c.id] = {"type": "clip", "title": c.title, "brain_side": c.brain_side, "url": c.url,
                      "evolution_stage": "collected"}
    for k in db.query(KnowledgeUnit).filter(scope_condition(KnowledgeUnit, user_id, tenant)).all():
        meta[k.id] = {"type": "knowledge", "title": k.source_title, "brain_side": k.brain_side, "url": k.source_url,
                      "evolution_stage": k.evolution_stage or "collected"}
    # 文档入图（09-17 P2-4）：图片文档附 image_url（/uploads 静态路径，既有公开口径），
    # 前端节点详情出缩略图；文档无进化阶段字段 → 落默认层
    from app.models.content import Document
    from app.services.document_service import is_image_document
    for d in db.query(Document).filter(scope_condition(Document, user_id, tenant)).all():
        m = {"type": "document", "title": d.title or d.original_name, "brain_side": d.brain_side,
             "url": None, "evolution_stage": "collected"}
        if d.file_path and is_image_document(d.file_path, d.file_type):
            m["image_url"] = f"/uploads/{d.file_path}"
        meta[d.id] = m
    return meta


@router.get("/status", summary="Graphify build status")
def graphify_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 构建状态按空间取行（09-12）：团队空间读团队共享行，不再把个人构建状态透进团队
    tenant = get_active_tenant(db, current_user)
    tenant_id = tenant.id if tenant else None
    st = gfs.get_build_status(current_user.id, tenant_id=tenant_id)
    # 产物目录已空间化（09-12）：团队空间读团队目录（tenant_{id}/）的图，不透个人产物
    graph = gfs.load_graph(current_user.id, tenant_id=tenant_id) if st.get("has_graph") else None

    last_built_at = None
    stale = False
    if graph is not None:
        path = gfs._graph_json_path(current_user.id, tenant_id)
        last_built_at = datetime.utcfromtimestamp(path.stat().st_mtime).isoformat() + "Z"
        content_ts = _content_last_updated(db, current_user.id, tenant)
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


@router.get("/build-estimate", summary="Estimate graph build cost for a model")
async def graphify_build_estimate(
    model: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """构建成本预估：平台模型返回预计花费与当前云端余额（不够钱前置提示）。"""
    bare = model[len("platform:"):] if model.startswith("platform:") else model
    # 估价按空间（09-12）：团队空间估全团语料（与实际构建口径一致），不透个人内容
    tenant = get_active_tenant(db, current_user)
    est = gfs.estimate_build_cost(db, current_user.id, bare,
                                  tenant_id=tenant.id if tenant else None)
    # 开源版 Ollama-only：无 platform: 计费模型，不查余额
    return est


@router.post("/build", summary="Build or rebuild the user's knowledge graph")
async def graphify_build(
    req: Optional[BuildRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preferred = req.preferred_model if req else None
    # 团队空间构建已放行（09-12 产物目录空间化落地）：语料只收团队内容、产物落
    # graphify_data/tenant_{tenant_id}/、状态写团队共享行、边同步只动团队边——
    # 与个人空间全链互不踩（见 graphify_service 模块注释的空间口径）
    tenant = get_active_tenant(db, current_user)
    tenant_id = tenant.id if tenant else None
    # 推理档模型禁入批量构建（09-03 实捕 sys-glm-5.3-flash 建 793 篇撞 4h 超时卡死）：
    # 强制思考的模型单篇要思考数十秒，配速 3-10 倍超标，大图必超时
    if preferred and gfs.is_reasoning_model(preferred):
        raise HTTPException(
            status_code=400,
            detail="推理档模型（强制思考）不适合批量图谱构建——单篇要思考数十秒，大图必超时。请改用 flash 非推理档模型。",
        )
    # 开源版 Ollama-only：无平台计费模型与会员门，本地模型直接构建
    st = gfs.start_build_background(current_user.id, preferred_model=preferred, tenant_id=tenant_id)
    state = st.get("state")
    if state in ("exporting", "building"):
        return {"ok": True, "status": st}
    return {"ok": state == "done", "status": st}


class AutoEvolveRequest(BaseModel):
    enabled: bool = False
    model: Optional[str] = Field(None, max_length=100)


@router.get("/auto-evolve", summary="Get graph auto-evolve configuration")
def get_auto_evolve(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cfg = gfs.get_auto_evolve_config(current_user)
    # 最近构建时间按空间取（09-12）：团队空间看团队目录产物（配置仍是个人级，
    # 团队空间自进化按触发者配置跑——graphify_service 模块注释的拍板口径）
    tenant = get_active_tenant(db, current_user)
    mtime = gfs.last_built_mtime(current_user.id, tenant_id=tenant.id if tenant else None)
    last_built_at = datetime.fromtimestamp(mtime).isoformat() if mtime else None
    return {**cfg, "last_built_at": last_built_at}


@router.put("/auto-evolve", summary="Update graph auto-evolve configuration")
def set_auto_evolve(
    req: AutoEvolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cfg = gfs.set_auto_evolve_config(current_user, req.enabled, req.model, db)
    return cfg


@router.get("/graph", summary="Get the enriched knowledge graph")
def graphify_graph(
    include_quarantined: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 产物按当前激活空间读（09-12 目录空间化）：团队空间读团队目录的图与布局
    tenant = get_active_tenant(db, current_user)
    tenant_id = tenant.id if tenant else None
    graph = gfs.load_graph(current_user.id, tenant_id=tenant_id)
    if graph is None:
        raise HTTPException(status_code=404, detail="图谱尚未构建，请先点击「重建图谱」")

    meta = _source_meta(db, current_user.id, tenant)
    raw_nodes = graph.get("nodes", [])
    # 置信度网关隔离区（09-17 P2-1b）：AMBIGUOUS 低置信边默认不进主图（读侧过滤，
    # 产物不动）；include_quarantined=1 全量返回并打 quarantined 标记（图谱页开关）。
    raw_links = graph.get("links", [])
    quarantined_ids = set()
    if not include_quarantined:
        kept_links = []
        has_q = set()
        for e in raw_links:
            if gfs.is_quarantined_link(e):
                has_q.add(e.get("source"))
                has_q.add(e.get("target"))
            else:
                kept_links.append(e)
        linked = set()
        for e in kept_links:
            linked.add(e.get("source"))
            linked.add(e.get("target"))
        # 只被隔离边连接的节点连带剔除（不孤悬主图；本来就零度的节点不动）
        drop = {n for n in has_q if n not in linked}
        if drop:
            raw_nodes = [n for n in raw_nodes if n.get("id") not in drop]
        raw_links = kept_links
    else:
        quarantined_ids = {id(e) for e in raw_links if gfs.is_quarantined_link(e)}
    # hub 概念节点（无单一出处）的 grounding：按标签文本找回最多 3 篇原文，
    # 让「查看来源」对综合概念也能直达（08-22 用户：落列表页一脸蒙）
    grounded_map = gfs._ground_hub_concepts(current_user.id, raw_nodes, tenant_id=tenant_id)
    # 3D V2：读落库布局（无则节点不带 x/y/z，前端回退客户端力导向）
    from app.services import graph_layout_service as gls
    layout_coords, supernodes = gls.load_semantic_layout(db, current_user.id, tenant_id=tenant_id)
    nodes: List[Dict[str, Any]] = []
    for node in raw_nodes:
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
            # meta 不带 id（_source_meta 只出 type/title/brain_side/url），
            # 缺 id 会让前端「查看来源」退化成列表页——必须回填
            enriched["source"] = {**meta[src["id"]], "id": src["id"]}
        elif src:
            enriched["source"] = {"type": src["type"], "id": src["id"]}
        else:
            enriched["source"] = None
            grounded = [
                {"type": meta[cid]["type"], "id": cid, "title": meta[cid]["title"]}
                for cid in grounded_map.get(node.get("id"), [])
                if cid in meta
            ]
            if grounded:
                enriched["grounded"] = grounded
        # 进化阶段富化（3D 视图 z 轴海拔）：有出处取出处行的阶段，
        # hub 概念节点无出处 → 默认层；clip 出处在 _source_meta 已落 collected
        src_meta = meta.get(src["id"]) if src else None
        enriched["evolution_stage"] = (src_meta or {}).get("evolution_stage") or "collected"
        coord = layout_coords.get(node.get("id"))
        if coord:
            enriched["x"], enriched["y"], enriched["z"] = coord
        nodes.append(enriched)

    # 手动双链上语义图（08-27 拍板定义贴法）：内容↔概念节点是 1:N，
    # 贴「该内容出处节点中 id 字典序最小者」作代表——确定性，随构建产物稳定。
    # 内容在构建产物里没有出处节点（构建未覆盖）→ 本次不贴，重建覆盖后自动出现。
    from app.models.base import GraphEdge
    rep_node: Dict[str, str] = {}
    for node in raw_nodes:
        src = gfs.parse_source_from_node(node)
        nid = node.get("id")
        if src and nid is not None:
            nid = str(nid)
            cur = rep_node.get(src["id"])
            if cur is None or nid < cur:
                rep_node[src["id"]] = nid
    # 手动边按空间贴图（09-12）：团队空间贴全团手动边（不限作者），个人空间只贴本人个人边
    manual_edges = db.query(GraphEdge).filter(
        scope_condition(GraphEdge, current_user.id, tenant),
        GraphEdge.edge_type == "manual",
    ).all()
    manual_links: List[Dict[str, Any]] = []
    for me in manual_edges:
        a, b = rep_node.get(me.source_id), rep_node.get(me.target_id)
        if a and b and a != b:
            manual_links.append({
                "source": a,
                "target": b,
                "relation": "手动关联",
                "confidence": None,
                "edge_type": "manual",
                "weight": 1.0,
            })

    # Wiki 条目上语义图（09-16 条目进图谱）：fresh/stale 条目每条合成一个
    # wiki 节点，边按 source_ids 贴「来源内容的代表节点」（与手动边同一
    # rep_node 映射；来源内容未被构建覆盖 → 只出节点不贴边）。坐标三轴必须
    # 齐全（前端 3D hasBackendCoords 全有才用落库布局）：来源节点有坐标取
    # 质心，否则按 entry_id 哈希落原点旁确定性环位（同一条目位置不跳变）。
    # 只在有图谱数据时合成（nodes 空 → 无代表节点可贴，直接跳过）。
    wiki_links: List[Dict[str, Any]] = []
    if nodes:
        import hashlib
        import json as _json
        import math as _math
        from app.models.knowledge import WikiEntry
        node_by_id = {str(n.get("id")): n for n in nodes}
        wiki_entries = db.query(WikiEntry).filter(
            scope_condition(WikiEntry, current_user.id, tenant),
            WikiEntry.status.in_(("fresh", "stale")),
        ).all()
        for entry in wiki_entries:
            try:
                src_list = _json.loads(entry.source_ids or "[]")
            except (TypeError, ValueError):
                src_list = []
            member_nids: List[str] = []
            for s in src_list:
                if not isinstance(s, dict):
                    continue
                rn = rep_node.get(s.get("id"))
                if rn and rn not in member_nids:
                    member_nids.append(rn)
            coords = [(node_by_id[m]["x"], node_by_id[m]["y"], node_by_id[m]["z"])
                      for m in member_nids
                      if node_by_id[m].get("x") is not None
                      and node_by_id[m].get("y") is not None
                      and node_by_id[m].get("z") is not None]
            if coords:
                x = sum(c[0] for c in coords) / len(coords)
                y = sum(c[1] for c in coords) / len(coords)
                z = sum(c[2] for c in coords) / len(coords)
            else:
                h = hashlib.md5(str(entry.id).encode("utf-8")).digest()
                angle = (h[0] / 255.0) * 2 * _math.pi
                radius = 40.0 + (h[1] / 255.0) * 40.0
                x, y, z = radius * _math.cos(angle), radius * _math.sin(angle), 0.0
            comm_count: Dict[Any, int] = {}
            for m in member_nids:
                c = node_by_id[m].get("community")
                if c is not None:
                    comm_count[c] = comm_count.get(c, 0) + 1
            community = (sorted(comm_count.items(), key=lambda kv: (-kv[1], str(kv[0])))[0][0]
                         if comm_count else None)
            nodes.append({
                "id": f"wiki:{entry.id}",
                "label": entry.title,
                "file_type": "wiki",
                "community": community,
                "source_url": None,
                "captured_at": entry.updated_at.isoformat() if entry.updated_at else None,
                # source 带 id：详情面板「查看来源」直达百科页（/graph/wiki?entry=）
                "source": {"type": "wiki", "id": entry.id, "title": entry.title},
                # 条目无进化阶段字段 → 落默认层（与 clip 同口径）
                "evolution_stage": "collected",
                "x": round(x, 1), "y": round(y, 1), "z": round(z, 1),
            })
            for m in member_nids:
                wiki_links.append({
                    "source": f"wiki:{entry.id}",
                    "target": m,
                    "relation": "溯源",
                    "confidence": "EXTRACTED",
                })

    links = [
        {
            "source": e.get("source"),
            "target": e.get("target"),
            "relation": e.get("relation"),
            "confidence": e.get("confidence"),
            "quarantined": id(e) in quarantined_ids if include_quarantined else None,
        }
        for e in raw_links
    ] + manual_links + wiki_links


    # node.community is a numeric id; human names come from cluster-only's labels file
    community_labels = gfs.load_community_labels(current_user.id, tenant_id=tenant_id)
    for sup in supernodes:
        sup["label"] = community_labels.get(sup["id"])
    return {"nodes": nodes, "links": links, "community_labels": community_labels,
            "supernodes": supernodes}


@router.get("/physical-graph", summary="Get the physical (similarity) graph",
            description="零 LLM 物理图：嵌入相似度 + 标签共现。与 /graphify/graph 同契约，"
                        "多带 evolution_stage（3D z 轴海拔）与 stage_layers（层序）。")
def graphify_physical_graph(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 开源版无 physical_graph_service（剥离面）：返回空图而非 500
    return {"nodes": [], "links": [], "notice": "开源本地版不含相似度物理图"}


@router.post("/layout/rebuild", summary="Recompute the stored 3D layout from the current build artifact",
             description="存量补算入口：从已有构建产物重算两层布局并整删整插入库（幂等）。")
def graphify_layout_rebuild(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services import graph_layout_service as gls
    # 按当前激活空间重算（09-12）：团队空间读团队产物、整删整插只动团队布局行
    tenant = get_active_tenant(db, current_user)
    stats = gls.rebuild_semantic_layout(db, current_user.id,
                                        tenant_id=tenant.id if tenant else None)
    if stats is None:
        raise HTTPException(status_code=404, detail="图谱尚未构建，请先点击「重建图谱」")
    return {"ok": True, **stats}


@router.post("/digests/rebuild", summary="Recompute community digests from the current build artifact",
             description="存量补算入口：从已有构建产物重算社区摘要（无 LLM 纯聚合）并整删整插入库（幂等）。")
def graphify_digests_rebuild(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services import community_digest as cd
    # 按当前激活空间重算（09-12）：团队空间读团队产物、摘要行打团队戳
    tenant = get_active_tenant(db, current_user)
    stats = cd.build_semantic_digests(db, current_user.id,
                                      tenant_id=tenant.id if tenant else None)
    if stats is None:
        raise HTTPException(status_code=404, detail="图谱尚未构建，请先点击「重建图谱」")
    return {"ok": True, **stats}


@router.post("/query", summary="Ask a plain-language question against the graph")
async def graphify_query(
    req: QueryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 按当前激活空间查图（09-12）：团队空间查团队目录的产物
    tenant = get_active_tenant(db, current_user)
    return await gfs.query_graph(current_user.id, req.question, preferred_model=req.preferred_model,
                                 tenant_id=tenant.id if tenant else None)


@router.post("/path", summary="Shortest path between two graph nodes")
def graphify_path(
    req: PathRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tenant = get_active_tenant(db, current_user)
    return gfs.path_graph(current_user.id, req.a, req.b,
                          tenant_id=tenant.id if tenant else None)


@router.post("/explain", summary="Explain a graph node and its neighbors")
def graphify_explain(
    req: ExplainRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tenant = get_active_tenant(db, current_user)
    return gfs.explain_graph(current_user.id, req.node,
                             tenant_id=tenant.id if tenant else None)


@router.get("/entity-audit", summary="实体消歧审计（诊断报表，只读不写）")
def graphify_entity_audit(current_user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    from app.services.graph_audit_service import entity_dedup_audit
    return entity_dedup_audit(db, current_user.id, tenant=tenant)


@router.post("/entity-dedup", summary="实体消歧执行链：dry_run 预览 LLM 判定，false 真合并")
async def graphify_entity_dedup(req: EntityDedupRequest,
                                current_user: User = Depends(get_current_user),
                                db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    from app.services import graph_dedup_service as gds
    try:
        proposal = await gds.propose_entity_merges(db, current_user.id, tenant=tenant)
    except ValueError as e:
        # LLM 通道不可用/判定输出全废：报错不落假结果（血泪#34）
        raise HTTPException(status_code=502, detail=str(e))
    if req.dry_run:
        return {"dry_run": True, **proposal}
    applied = gds.apply_entity_merges(db, current_user.id, proposal["merges"], tenant=tenant)
    return {"dry_run": False, **proposal, "applied": applied}


@router.post("/backfill-edge-evidence", summary="存量边证据血缘回填（手动触发，幂等只补 NULL）")
def graphify_backfill_edge_evidence(current_user: User = Depends(get_current_user),
                                    db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    return gfs.backfill_edge_evidence(db, current_user.id, tenant=tenant)


@router.get("/snapshots", summary="图谱版本快照列表（新的在前）")
def graphify_list_snapshots(current_user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    return {"snapshots": gfs.list_snapshots(current_user.id,
                                            tenant_id=tenant.id if tenant else None)}


@router.post("/snapshots", summary="手动留底当前图谱产物")
def graphify_create_snapshot(current_user: User = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    sid = gfs.snapshot_graph(current_user.id,
                             tenant_id=tenant.id if tenant else None, trigger="manual")
    if sid is None:
        raise HTTPException(status_code=404, detail="图谱尚未构建，无可快照产物")
    return {"ok": True, "snapshot_id": sid}


@router.post("/snapshots/{snapshot_id}/rollback", summary="一键回滚到指定快照（当前产物自动留底 pre-rollback 快照）")
def graphify_rollback_snapshot(snapshot_id: str,
                               current_user: User = Depends(get_current_user),
                               db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    try:
        result = gfs.rollback_snapshot(db, current_user.id, snapshot_id,
                                       tenant_id=tenant.id if tenant else None)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error"))
    return result


@router.get("/report", summary="Get the generated markdown graph report")
def graphify_report(current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    tenant = get_active_tenant(db, current_user)
    path = gfs.graph_report_path(current_user.id, tenant_id=tenant.id if tenant else None)
    if path is None:
        raise HTTPException(status_code=404, detail="报告尚未生成，请先构建图谱")
    return {"content": path.read_text(encoding="utf-8")}
