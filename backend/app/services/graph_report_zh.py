"""图谱报告中文化：graphify 上游 GRAPH_REPORT.md 是全英文模板（脚手架文字全英文），
构建收尾时从 graph.json + 社区标签重新生成中文版并覆盖同名文件（读取端点不变）。

纪律：
- 纯数据加工零 LLM；失败时英文原报告保留（先写临时文件再替换，半途不毁原件）。
- 关系词中文化复用对话链路同一张表（端点 llm.py 的 _RELATION_ZH，延迟 import）。
- token 消耗从被覆盖前的英文原报告里抢救（我们自己不重新统计）。
"""
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"Token cost: ([\d,]+) input · ([\d,]+) output")

_CONF_ZH = {"EXTRACTED": "抽取确定", "INFERRED": "推断", "AMBIGUOUS": "模糊"}


def _relation_zh(raw: str) -> str:
    from app.services.graph_predicates import build_zh_table  # 延迟 import 破 service→endpoint 环
    return build_zh_table().get((raw or "").lower(), raw or "相关")


def _parse_source_file(sf: str):
    """source_file（note__<uuid>.md 形态）→ (类型, id)。"""
    m = re.match(r"^(note|clip|document|knowledge)__([0-9a-zA-Z-]{36})\.md$", sf or "")
    return (m.group(1), m.group(2)) if m else None


def _source_route(node: Dict[str, Any]) -> Optional[str]:
    """概念节点 → 原文路由：note 进详情页，clip 有 source_url 开原网页，
    document/knowledge 进各自列表页。"""
    parsed = _parse_source_file(node.get("source_file") or "")
    if not parsed:
        return None
    ctype, cid = parsed
    if ctype == "note":
        return f"/ingest/notes/{cid}"
    if ctype == "clip":
        return node.get("source_url") or "/ingest/clipper"
    if ctype == "document":
        return "/ingest/documents"
    return "/knowledge/all"


def _resolve_source_titles(db, source_files: List[str]) -> Dict[str, str]:
    """source_file → 内容标题（批量按类型一次查；db 缺省/失败时回落空=展示概念名）。"""
    if db is None or not source_files:
        return {}
    from app.models.base import BrowserClip, Document, KnowledgeUnit, Note
    parsed = {sf: _parse_source_file(sf) for sf in source_files}
    parsed = {sf: p for sf, p in parsed.items() if p}
    titles: Dict[str, str] = {}
    for model, ctype, attr in ((Note, "note", "title"), (BrowserClip, "clip", "title"),
                               (KnowledgeUnit, "knowledge", "content_raw"),
                               (Document, "document", "title")):
        ids = [p[1] for p in parsed.values() if p[0] == ctype]
        if not ids:
            continue
        for rid, val in db.query(model.id, getattr(model, attr)).filter(model.id.in_(ids)).all():
            key = f"{ctype}__{rid}.md"
            titles[key] = (val or "")[:40]
    # Document 标题空时原始文件名兜底
    doc_ids = [p[1] for sf, p in parsed.items()
               if p[0] == "document" and not titles.get(sf)]
    if doc_ids:
        for rid, name in db.query(Document.id, Document.original_name).filter(Document.id.in_(doc_ids)).all():
            titles[f"document__{rid}.md"] = (name or "")[:40]
    return titles


def regenerate_report_zh(user_id: str, db=None, tenant_id: Optional[str] = None) -> Optional[Path]:
    """从 graph.json 重新生成中文 GRAPH_REPORT.md。返回写出路径；无图返回 None。

    db 给了就把社区成员按来源内容分组并附原文链接（标题取自库）；
    没给则只列概念名（不报错，降级展示）。
    产物目录随空间（09-12）：团队空间读/写团队目录的报告。"""
    from app.services import graphify_service as gfs  # 延迟 import 破循环

    out_dir = gfs._out_dir(user_id, tenant_id)
    graph_path = out_dir / "graph.json"
    if not graph_path.exists():
        return None

    g = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes: List[Dict[str, Any]] = g.get("nodes", [])
    links: List[Dict[str, Any]] = g.get("links", [])
    hyperedges: List[Dict[str, Any]] = g.get("hyperedges", [])

    labels_path = out_dir / ".graphify_labels.json"
    community_labels: Dict[str, str] = {}
    if labels_path.exists():
        try:
            community_labels = json.loads(labels_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass

    # token 消耗从英文原报告抢救
    token_line = None
    old_report = out_dir / "GRAPH_REPORT.md"
    if old_report.exists():
        m = _TOKEN_RE.search(old_report.read_text(encoding="utf-8", errors="ignore"))
        if m:
            token_line = f"- 构建消耗：输入 {m.group(1)} tokens · 输出 {m.group(2)} tokens"

    label_of = {n.get("id"): n.get("label") or n.get("id") for n in nodes}
    degree: Dict[str, int] = {}
    conf_count = {"EXTRACTED": 0, "INFERRED": 0, "AMBIGUOUS": 0}
    for l in links:
        degree[l["source"]] = degree.get(l["source"], 0) + 1
        degree[l["target"]] = degree.get(l["target"], 0) + 1
        c = (l.get("confidence") or "").upper()
        conf_count[c] = conf_count.get(c, 0) + 1
    total_links = max(len(links), 1)

    # 社区成员数
    comm_members: Dict[str, int] = {}
    for n in nodes:
        c = n.get("community")
        if c is not None:
            comm_members[str(c)] = comm_members.get(str(c), 0) + 1

    core_nodes = sorted(degree.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    isolated = [label_of[nid] for nid in label_of if degree.get(nid, 0) <= 1]
    inferred_edges = [l for l in links if (l.get("confidence") or "").upper() == "INFERRED"]
    inferred_edges.sort(key=lambda l: -(l.get("weight") or 0))

    lines: List[str] = []
    lines.append(f"# 图谱报告（生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}）")
    lines.append("")
    lines.append("## 概览")
    lines.append(f"- {len(nodes)} 个概念节点 · {len(links)} 条关系边 · {len(comm_members)} 个社区")
    lines.append(
        "- 置信分布：" + " · ".join(
            f"{_CONF_ZH[k]} {round(v / total_links * 100)}%" for k, v in conf_count.items() if v
        )
    )
    if token_line:
        lines.append(token_line)
    lines.append("")

    if comm_members:
        # 社区成员按来源内容分组 + 原文链接（「21 个概念是哪些笔记提取的」的答法）
        titles = _resolve_source_titles(db, [n.get("source_file") or "" for n in nodes])
        lines.append("## 社区枢纽（导航用）")
        for cid in sorted(comm_members, key=lambda c: -comm_members[c]):
            name = community_labels.get(cid, f"社区 {int(cid) + 1}")
            members = [n for n in nodes if str(n.get("community")) == cid]
            by_src: Dict[str, List[str]] = {}
            for n in members:
                sf = n.get("source_file") or ""
                by_src.setdefault(sf, []).append(n.get("label") or n.get("id"))
            lines.append(f"- **{name}**（{len(members)} 个概念，来自 {len(by_src)} 条内容）：")
            for sf, concepts in sorted(by_src.items(), key=lambda kv: -len(kv[1]))[:12]:
                concept_str = "、".join(concepts[:8]) + ("…" if len(concepts) > 8 else "")
                route = _source_route(next(n for n in members if (n.get("source_file") or "") == sf))
                title = titles.get(sf)
                if route and title:
                    lines.append(f"  - [{title}]({route})：{concept_str}")
                elif route:
                    lines.append(f"  - [查看原文]({route})：{concept_str}")
                else:
                    lines.append(f"  - {concept_str}")
            if len(by_src) > 12:
                lines.append(f"  - …还有 {len(by_src) - 12} 条内容")
        lines.append("")

    if core_nodes:
        lines.append("## 核心概念（连接最多）")
        for i, (nid, deg) in enumerate(core_nodes, 1):
            lines.append(f"{i}. {label_of.get(nid, nid)} — {deg} 条连接")
        lines.append("")

    if inferred_edges:
        lines.append("## 值得留意的连接（模型推断，建议核对）")
        for l in inferred_edges[:10]:
            a = label_of.get(l["source"], l["source"])
            b = label_of.get(l["target"], l["target"])
            lines.append(f"- 《{a}》—{_relation_zh(l.get('relation'))}→《{b}》（推断）")
        lines.append("")

    if hyperedges:
        lines.append("## 组合关系（多概念共现）")
        for h in hyperedges[:10]:
            members = "、".join(label_of.get(nid, nid) for nid in h.get("nodes", []))
            lines.append(f"- **{h.get('label') or '未命名组合'}** — {members}")
        lines.append("")

    if isolated:
        lines.append("## 孤岛概念（≤1 条连接，可能需要补记）")
        lines.append("- " + "、".join(f"《{lb}》" for lb in isolated[:15]))
        lines.append("")

    questions: List[str] = []
    # 跨社区桥：一个节点的边横跨 ≥2 个社区
    comm_of = {n.get("id"): n.get("community") for n in nodes}
    for nid in label_of:
        comms = {comm_of.get(l["target"]) for l in links if l["source"] == nid} | \
                {comm_of.get(l["source"]) for l in links if l["target"] == nid}
        comms.discard(None)
        if len(comms) >= 2:
            questions.append(f"- 「{label_of[nid]}」为什么能把多个社区连在一起？（它是跨社区桥梁）")
    # 推断边密集节点
    inf_by_node: Dict[str, int] = {}
    for l in inferred_edges:
        inf_by_node[l["source"]] = inf_by_node.get(l["source"], 0) + 1
        inf_by_node[l["target"]] = inf_by_node.get(l["target"], 0) + 1
    for nid, cnt in sorted(inf_by_node.items(), key=lambda kv: -kv[1])[:3]:
        if cnt >= 2:
            questions.append(f"- 「{label_of.get(nid, nid)}」的 {cnt} 条推断关系都成立吗？（建议逐一核对）")
    # 孤岛
    if isolated:
        questions.append(f"- 「{isolated[0]}」还和系统的哪些部分相连？（可能是还没记到的内容）")
    if questions:
        lines.append("## 可以问自己的问题")
        lines.extend(questions[:8])
        lines.append("")

    content = "\n".join(lines)
    tmp = out_dir / "GRAPH_REPORT.md.tmp"
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(old_report)
    logger.info("图谱报告中文重生成完成 user=%s（%d 节点 %d 边）", user_id, len(nodes), len(links))
    return old_report
