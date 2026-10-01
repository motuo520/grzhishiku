"""3D 图谱 V2 阶段一：确定性两层布局（节点层 + 社区超节点层）落库。

坐标算法选型：确定性 Fruchterman-Reingold 力导向（numpy 向量化），
而非 UMAP / 复刻 d3-force-3d，理由：
- 语义图节点是 LLM 抽取的概念，没有现成嵌入向量，UMAP 无从用起
  （UMAP 只在物理图有先例——那边节点=文档、嵌入现成）；
- d3-force-3d 没有 Python 对应物，复刻其速度积分物理无意义——
  立项口径是「确定性 + 社区内聚」，不是复刻 d3 物理；
- 本实现全程无 RNG：黄金角螺旋初始化 + 固定迭代次数 + 线性降温 +
  排序后的节点序 + numpy 纯算术，同输入必逐位同输出（跨机器一致）。

z 轴：进化阶段地层（与前端 galaxyLayout.ts 的 LAYER_GAP / STAGE_LAYERS
同口径），collected 在最底、internalized 在最高。

超节点：社区成员质心 + 成员数，供前端 LOD 缩放态零成本取坐标。
"""
import logging
import math
import uuid
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.base import GraphLayout, KnowledgeUnit, Note

logger = logging.getLogger(__name__)

# 与前端 galaxyLayout.ts / graphShared.ts 同口径
STAGE_LAYERS = ["collected", "understood", "practiced", "validated", "internalized"]
LAYER_GAP = 70.0
# 布局归一化幅度（与物理图 UMAP ±200 同尺度，前端相机参数可复用）
EXTENT = 200.0
# 力导向迭代参数：固定值保确定性
ITERATIONS = 150
COHESION = 0.03          # 每轮向社区质心的回拉强度
_REPULSE_BLOCK = 512     # 斥力分块行数：O(n²) 时间但 O(block×n) 内存，防大图爆内存
_COORD_DECIMALS = 4      # 入库小数位：跨次 JSON 序列化稳定


def layer_z(stage: Optional[str], layers: Optional[List[str]] = None) -> float:
    """进化阶段 → z 轴海拔；未知阶段落默认层（collected）。"""
    keys = layers or STAGE_LAYERS
    i = keys.index(stage) if stage in keys else 0
    return (i - (len(keys) - 1) / 2) * LAYER_GAP


def compute_xy(
    node_ids: List[str],
    links: List[Dict[str, Any]],
    communities: Optional[Dict[str, int]] = None,
) -> Dict[str, Tuple[float, float]]:
    """确定性 FR 力导向 2D 布局。同输入必同输出（无 RNG，纯算术）。"""
    ids = sorted({str(i) for i in node_ids})
    n = len(ids)
    if n == 0:
        return {}
    if n == 1:
        return {ids[0]: (0.0, 0.0)}
    import numpy as np

    idx = {nid: i for i, nid in enumerate(ids)}

    # 黄金角螺旋初始化：均匀分散且完全确定，无需随机种子
    order = np.arange(n, dtype=np.float64)
    golden = math.pi * (3.0 - math.sqrt(5.0))
    r = 10.0 * np.sqrt(order + 0.5)
    pos = np.stack([r * np.cos(order * golden), r * np.sin(order * golden)], axis=1)

    # 边去重 + 端点校验（graphify 产物里可能有指向已删节点的悬挂边）
    seen = set()
    ea, eb = [], []
    for l in links:
        a, b = idx.get(str(l.get("source"))), idx.get(str(l.get("target")))
        if a is None or b is None or a == b:
            continue
        key = (a, b) if a < b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        ea.append(a)
        eb.append(b)
    ea = np.array(ea, dtype=np.int64)
    eb = np.array(eb, dtype=np.int64)

    # 社区成员索引（质心内聚力用）
    comm_members: List[np.ndarray] = []
    if communities:
        by_comm: Dict[int, List[int]] = defaultdict(list)
        for nid, cid in communities.items():
            i = idx.get(str(nid))
            if i is not None and cid is not None:
                by_comm[int(cid)].append(i)
        comm_members = [np.array(m, dtype=np.int64) for m in by_comm.values() if len(m) >= 2]

    k = 2.0 * EXTENT / math.sqrt(n)
    k2 = k * k
    t0 = EXTENT * 0.25  # 首轮最大位移

    for it in range(ITERATIONS):
        disp = np.zeros((n, 2), dtype=np.float64)

        # 斥力（全对，分块算防 O(n²) 内存）
        for start in range(0, n, _REPULSE_BLOCK):
            block = pos[start:start + _REPULSE_BLOCK]              # b×2
            diff = block[:, None, :] - pos[None, :, :]             # b×n×2
            dist = np.maximum(np.linalg.norm(diff, axis=2), 1e-6)  # b×n
            rep = (diff / dist[:, :, None]) * (k2 / dist)[:, :, None]
            # 自身对自身 diff=0，rep 自然为 0，无需特判
            disp[start:start + _REPULSE_BLOCK] += rep.sum(axis=1)

        # 引力（沿边）
        if len(ea):
            diff = pos[ea] - pos[eb]                               # e×2
            dist = np.maximum(np.linalg.norm(diff, axis=1), 1e-6)
            att = (diff / dist[:, None]) * (dist * dist / k)[:, None]
            np.add.at(disp, ea, -att)
            np.add.at(disp, eb, att)

        # 社区内聚：向质心弱回拉（保簇形，不压过边引力）
        for members in comm_members:
            centroid = pos[members].mean(axis=0)
            disp[members] += (centroid - pos[members]) * COHESION

        # 线性降温限位移
        norm = np.maximum(np.linalg.norm(disp, axis=1), 1e-6)
        t = t0 * (1.0 - it / ITERATIONS)
        pos += disp * (np.minimum(norm, t) / norm)[:, None]

    # 归一化：质心归零，最长轴压到 ±EXTENT
    pos -= pos.mean(axis=0)
    extent = float(np.max(np.abs(pos)))
    if extent > 0:
        pos *= EXTENT / extent
    return {ids[i]: (round(float(pos[i, 0]), _COORD_DECIMALS),
                     round(float(pos[i, 1]), _COORD_DECIMALS)) for i in range(n)}


def compute_layout(
    nodes: List[Dict[str, Any]],
    links: List[Dict[str, Any]],
    stage_of: Optional[Dict[str, str]] = None,
    layers: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """两层布局主入口。

    返回 {"positions": {node_id: (x, y, z)},
          "supernodes": {community_id: {"x","y","z","size"}}}
    z = 进化阶段地层；超节点坐标 = 成员质心（z 取成员均值），size = 成员数。
    """
    node_ids = [str(n.get("id")) for n in nodes if n.get("id") is not None]
    communities = {str(n.get("id")): n.get("community")
                   for n in nodes if n.get("id") is not None and n.get("community") is not None}
    xy = compute_xy(node_ids, links, communities or None)
    stage_of = stage_of or {}
    positions = {nid: (xy[nid][0], xy[nid][1],
                       round(layer_z(stage_of.get(nid), layers), _COORD_DECIMALS))
                 for nid in xy}

    by_comm: Dict[int, List[str]] = defaultdict(list)
    for nid, cid in communities.items():
        if nid in positions:
            by_comm[int(cid)].append(nid)
    supernodes: Dict[int, Dict[str, Any]] = {}
    for cid in sorted(by_comm):
        members = by_comm[cid]
        xs = [positions[m][0] for m in members]
        ys = [positions[m][1] for m in members]
        zs = [positions[m][2] for m in members]
        supernodes[cid] = {
            "x": round(sum(xs) / len(xs), _COORD_DECIMALS),
            "y": round(sum(ys) / len(ys), _COORD_DECIMALS),
            "z": round(sum(zs) / len(zs), _COORD_DECIMALS),
            "size": len(members),
        }
    return {"positions": positions, "supernodes": supernodes}


def _semantic_stage_map(db: Session, user_id: str, nodes: List[Dict[str, Any]],
                        tenant_id: Optional[str] = None) -> Dict[str, str]:
    """节点 id → 进化阶段：有出处的取出处行阶段，hub 概念落默认层。

    与 endpoints/graphify.py 的 evolution_stage 富化口径一致（clip 无阶段字段
    → collected）。出处行按空间取（09-12）：团队空间全团内容不限作者。
    """
    from sqlalchemy import and_ as _and
    from app.services import graphify_service as gfs

    def _scope(model):
        if tenant_id:
            return model.tenant_id == tenant_id
        return _and(model.user_id == user_id, model.tenant_id.is_(None))

    stages: Dict[str, str] = {}
    # clip 无进化阶段字段（端点口径=collected），只查 note / knowledge
    for model in (Note, KnowledgeUnit):
        for cid, stage in db.query(model.id, model.evolution_stage).filter(
                _scope(model)).all():
            stages[cid] = stage or "collected"
    out: Dict[str, str] = {}
    for node in nodes:
        src = gfs.parse_source_from_node(node)
        if src and src["id"] in stages:
            out[str(node.get("id"))] = stages[src["id"]]
    return out


def _layout_scope(user_id: str, tenant_id: Optional[str]):
    """布局行归属条件（09-12 空间化，口径同 graph_edges）：团队=tenant_id=T
    全员共享（不限计算者），个人=本人且 tenant_id 为空。"""
    from sqlalchemy import and_ as _and
    if tenant_id:
        return GraphLayout.tenant_id == tenant_id
    return _and(GraphLayout.user_id == user_id, GraphLayout.tenant_id.is_(None))


def rebuild_semantic_layout(db: Session, user_id: str,
                            tenant_id: Optional[str] = None) -> Optional[Dict[str, int]]:
    """从当前构建产物重算语义图布局并整删整插入库（幂等）。

    返回 {"nodes": n, "communities": m}；无构建产物返回 None（调用方 404）。
    graphify 全量重建后旧坐标作废——本函数即重算口径；手动边逻辑不涉及本表。
    空间口径（09-12）：产物源 graph.json 读本空间目录，整删整插只动本空间的行，
    团队行打 tenant_id 戳（全空间共享一份布局）。
    """
    from app.services import graphify_service as gfs

    graph = gfs.load_graph(user_id, tenant_id=tenant_id)
    if not graph:
        return None
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    layout = compute_layout(nodes, links, stage_of=_semantic_stage_map(db, user_id, nodes, tenant_id=tenant_id))

    try:
        db.query(GraphLayout).filter(
            _layout_scope(user_id, tenant_id),
            GraphLayout.graph_source == "semantic",
        ).delete(synchronize_session=False)
        communities = {str(n.get("id")): n.get("community")
                       for n in nodes if n.get("id") is not None}
        for nid, (x, y, z) in layout["positions"].items():
            db.add(GraphLayout(
                id=str(uuid.uuid4()), user_id=user_id, tenant_id=tenant_id, graph_source="semantic",
                node_id=nid, kind="node", community_id=communities.get(nid),
                x=x, y=y, z=z,
            ))
        for cid, sup in layout["supernodes"].items():
            db.add(GraphLayout(
                id=str(uuid.uuid4()), user_id=user_id, tenant_id=tenant_id, graph_source="semantic",
                node_id=f"community:{cid}", kind="community", community_id=cid,
                size=sup["size"], x=sup["x"], y=sup["y"], z=sup["z"],
            ))
        db.commit()
    except Exception:
        # 与 sync_edges_from_build 同理：DELETE 挂在事务里，失败必须回滚，
        # 否则下次 commit 误删旧坐标
        db.rollback()
        logger.warning("graph layout rebuild failed user=%s tenant=%s", user_id, tenant_id, exc_info=True)
        raise
    return {"nodes": len(layout["positions"]), "communities": len(layout["supernodes"])}


def load_semantic_layout(
    db: Session, user_id: str, tenant_id: Optional[str] = None,
) -> Tuple[Dict[str, Tuple[float, float, float]], List[Dict[str, Any]]]:
    """读库：节点坐标 + 超节点列表（label 由调用方按 community_labels 回填）。
    按空间读（09-12）：团队空间只读团队布局行，不透个人坐标。"""
    rows = db.query(GraphLayout).filter(
        _layout_scope(user_id, tenant_id),
        GraphLayout.graph_source == "semantic",
    ).all()
    coords: Dict[str, Tuple[float, float, float]] = {}
    supernodes: List[Dict[str, Any]] = []
    for row in rows:
        if row.kind == "community":
            supernodes.append({
                "id": str(row.community_id),
                "x": row.x, "y": row.y, "z": row.z,
                "size": row.size or 0,
            })
        else:
            coords[row.node_id] = (row.x, row.y, row.z)
    supernodes.sort(key=lambda s: s["id"])
    return coords, supernodes
