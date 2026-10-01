# -*- coding: utf-8 -*-
"""实体消歧审计（09-17 GraphRAG P1①）：只读诊断报表，不写任何数据。

读产物 graph.json（个人 graphify_data/{user_id}/corpus/graphify-out/、团队
tenant_{tenant_id}/ 同口径，复用 graphify_service.load_graph），输出三段：
①同 norm_label ≥2 节点的组（dedup 合并即弃的漏网）；②高相似未合并候选对
（首字+bigram 分桶 + difflib ratio≥0.85，cap 50）；③统计。产物缺失/损坏
返回空报告不炸（warning 留痕）。
"""
import difflib
import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.base import Note, BrowserClip, KnowledgeUnit, Document
from app.services.graphify_service import load_graph

logger = logging.getLogger(__name__)

_SOURCE_RE = re.compile(r"(note|clip|knowledge|document)__([A-Za-z0-9_-]+)\.md")
_MODELS = {"note": Note, "clip": BrowserClip, "knowledge": KnowledgeUnit, "document": Document}
_CANDIDATE_CAP = 50
_RATIO_FLOOR = 0.85

_EMPTY = {
    "groups": [],
    "candidates": [],
    "stats": {"nodes": 0, "edges": 0, "hub_without_source": 0,
              "dup_groups": 0, "candidate_pairs": 0},
}


def _norm_label(node: Dict[str, Any]) -> str:
    """归一化名：产物带 norm_label 用之，否则 label 小写去空白（与 graphify dedup 同口径）。"""
    nl = node.get("norm_label")
    if isinstance(nl, str) and nl.strip():
        return nl.strip().lower()
    return (node.get("label") or "").strip().lower()


def entity_dedup_audit(db: Session, user_id: str, tenant=None) -> Dict[str, Any]:
    """只读审计：入口 tenant=None=个人空间，否则按租户口径读团队产物。"""
    graph = load_graph(user_id, tenant_id=tenant.id if tenant else None)
    if not graph:
        logger.warning("entity dedup audit: graph.json 缺失/损坏 user=%s tenant=%s",
                       user_id, getattr(tenant, "id", None))
        return {k: (dict(v) if isinstance(v, dict) else list(v)) for k, v in _EMPTY.items()}

    nodes = graph.get("nodes", [])
    links = graph.get("links", [])

    # source_file → 文档标题（四表查标题，带缓存防 N+1）
    title_cache: Dict[str, Optional[str]] = {}

    def _doc_title(source_file) -> Optional[str]:
        if not isinstance(source_file, str):
            return None
        m = _SOURCE_RE.search(source_file)
        if not m:
            return None
        key = f"{m.group(1)}:{m.group(2)}"
        if key in title_cache:
            return title_cache[key]
        model = _MODELS.get(m.group(1))
        title = None
        if model is not None:
            obj = db.query(model).filter(model.id == m.group(2)).first()
            if obj is not None:
                title = (getattr(obj, "title", None) or getattr(obj, "source_title", None)
                         or getattr(obj, "original_name", None) or getattr(obj, "url", None))
        title_cache[key] = title
        return title

    # ① 同 norm_label ≥2 的组（dedup 漏网）
    by_norm: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for n in nodes:
        nl = _norm_label(n)
        if nl:
            by_norm[nl].append(n)
    groups = []
    for nl, ns in by_norm.items():
        if len(ns) < 2:
            continue
        groups.append({
            "norm_label": nl,
            "nodes": [{
                "id": n.get("id"),
                "label": n.get("label"),
                "source_file": _doc_title(n.get("source_file")) or n.get("source_file"),
                "community": n.get("community"),
            } for n in ns],
        })
    groups.sort(key=lambda g: -len(g["nodes"]))

    # ② 高相似未合并候选对：label 按首字+bigram 分桶，ratio≥0.85 的不同 norm 对
    labels: List[str] = []
    for n in nodes:
        label = (n.get("label") or "").strip()
        if label and label not in labels:
            labels.append(label)
    buckets: Dict[str, List[str]] = defaultdict(list)
    for label in labels:
        keys = {label[:1]} | {label[i:i + 2] for i in range(len(label) - 1)}
        for k in keys:
            buckets[k].append(label)
    pairs = []
    seen = set()
    for bucket in buckets.values():
        for i in range(len(bucket)):
            for j in range(i + 1, len(bucket)):
                a, b = bucket[i], bucket[j]
                key = (a, b) if a < b else (b, a)
                if key in seen:
                    continue
                seen.add(key)
                if a.strip().lower() == b.strip().lower():
                    continue  # 同 norm（大小写/空白差异）已在 ① 里，不重复报
                r = difflib.SequenceMatcher(None, a, b).ratio()
                if r >= _RATIO_FLOOR:
                    pairs.append({"a": a, "b": b, "ratio": round(r, 3)})
    pairs.sort(key=lambda p: -p["ratio"])
    pairs = pairs[:_CANDIDATE_CAP]

    return {
        "groups": groups,
        "candidates": pairs,
        "stats": {
            "nodes": len(nodes),
            "edges": len(links),
            "hub_without_source": sum(1 for n in nodes if not n.get("source_file")),
            "dup_groups": len(groups),
            "candidate_pairs": len(pairs),
        },
    }
