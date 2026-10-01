"""站内知识服务：站内事实（库统计 / 明细）全部数据库直查，不靠模型猜。

背景（08-25 拍板「改，大改」）：chat 只有 RAG 内容检索，遇到「我有多少篇笔记」
「最近记了什么」「标签 X 下有什么」「图谱现在什么状态」这类关于库本身的问题
小模型只能编造（云端实捕：自称无法访问向量库、虚构能搜网页）。

本服务两条能力：
- library_snapshot：一次调用聚合库快照（各类型条数/文件夹树/top 标签/脑侧分布/
  近期新增/图谱边与构建状态/进化与核验分布），全部聚合 SQL，无 N+1；
- answer_site_intent：纯规则意图路由（正则，零 LLM），命中返回
  {intent, facts, text}，未命中返回 None。facts 里具体条目带 id（可并入 SSE
  sources），统计类事实不带 id。

空间口径与 chat 主链路一致：scope_condition(model, user_id, tenant)。
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import case, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.core.tenant_scope import scope_condition
from app.models.base import (
    BrowserClip, Capsule, Folder, GraphBuildState, GraphEdge,
    KnowledgeUnit, Note, Tag, content_tags,
)

# 内容类型：model / 中文名 / sources 用 source_type / 计数单位
_CONTENT_TYPES = [
    ("note", Note, "个人笔记", "篇"),
    ("clip", BrowserClip, "网页剪藏", "条"),
    ("knowledge", KnowledgeUnit, "知识卡片", "条"),
    ("capsule", Capsule, "胶囊", "个"),
]
_TYPE_LABEL = {k: label for k, _, label, _ in _CONTENT_TYPES}
_TYPE_UNIT = {k: unit for k, _, _, unit in _CONTENT_TYPES}

# 意图路由的类型词映射（顺序即优先级：前面的词先命中）
_TYPE_WORDS = [
    ("note", ("笔记", "便签")),
    ("clip", ("剪藏", "收藏")),
    ("knowledge", ("知识", "卡片")),
    ("capsule", ("胶囊",)),
]

_EDGE_TYPE_LABELS = {"graphify": "自动构建", "manual": "手动", "collision": "碰撞", "wiki": "wiki 链接"}


def _now_utc_naive() -> datetime:
    """与 server_default=func.now()（UTC 无时区）同口径的当前时间。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _like_escape(kw: str) -> str:
    """LIKE 模式转义（与检索主链路同写法）：反斜杠 / % / _ 全转义。"""
    return kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _brain_filter(query, model, brain_side: str):
    if brain_side != "both":
        query = query.filter(model.brain_side == brain_side)
    return query


# ---------------------------------------------------------------------------
# 库快照
# ---------------------------------------------------------------------------

def _aggregate_content(db: Session, model, user_id: str, tenant, brain_side: str,
                       t7: datetime, t30: datetime):
    """单表一条聚合 SQL：按脑侧分组的总数 + 近 7/30 天新增（CASE 条件计数）。"""
    q = db.query(
        model.brain_side,
        func.count(model.id),
        func.sum(case((model.created_at >= t7, 1), else_=0)),
        func.sum(case((model.created_at >= t30, 1), else_=0)),
    ).filter(scope_condition(model, user_id, tenant), model.status == "active")
    q = _brain_filter(q, model, brain_side)
    return q.group_by(model.brain_side).all()


def _folder_content_counts(db: Session, user_id: str, tenant, brain_side: str):
    """文件夹内容条数：note/clip/knowledge 三表 UNION ALL 一条 SQL（含未归档 NULL 行）。

    返回 {folder_id: count}，未归档（folder_id IS NULL）单独放 key None。
    """
    selects = []
    for model in (Note, BrowserClip, KnowledgeUnit):
        conds = [scope_condition(model, user_id, tenant), model.status == "active"]
        if brain_side != "both":
            conds.append(model.brain_side == brain_side)
        selects.append(
            select(model.folder_id.label("fid"), func.count(model.id).label("cnt"))
            .where(*conds).group_by(model.folder_id)
        )
    counts: Dict[Optional[str], int] = {}
    for fid, cnt in db.execute(union_all(*selects)).all():
        counts[fid] = counts.get(fid, 0) + (cnt or 0)
    return counts


def _live_tag_assoc_ids(db: Session, ids_by_type: Dict[str, set], brain_side: str):
    """关联内容的存活 id 集合（幽灵行口径同 tag_service：存在且 status != deleted）。

    三表 UNION ALL 一条 SQL；brain_side 非 both 时按内容脑侧过滤。
    """
    selects = []
    for ctype, model in (("note", Note), ("clip", BrowserClip), ("knowledge", KnowledgeUnit)):
        ids = ids_by_type.get(ctype)
        if not ids:
            continue
        conds = [model.id.in_(ids), model.status != "deleted"]
        if brain_side != "both":
            conds.append(model.brain_side == brain_side)
        selects.append(
            select(literal(ctype).label("ctype"), model.id.label("cid")).where(*conds)
        )
    if not selects:
        return set()
    return {(r[0], r[1]) for r in db.execute(union_all(*selects)).all()}


def library_snapshot(db: Session, user_id: str, tenant, brain_side: str = "both") -> dict:
    """聚合库快照。全部聚合查询，单次约 11 条 SQL：

    4 条内容聚合（计数+脑侧+近 7/30 天，一表一条）+ 1 文件夹行 + 1 文件夹条数
    UNION + 1 标签关联行 + 1 关联存活 UNION + 1 图谱边分组 + 1 构建状态 +
    1 进化/核验联合分组。
    """
    now = _now_utc_naive()
    t7, t30 = now - timedelta(days=7), now - timedelta(days=30)

    counts: Dict[str, int] = {}
    brain = {"personal": 0, "network": 0}
    recent = {"7d": 0, "30d": 0}
    for key, model, _, _ in _CONTENT_TYPES:
        total = 0
        for side, cnt, c7, c30 in _aggregate_content(db, model, user_id, tenant, brain_side, t7, t30):
            total += cnt or 0
            if side in brain:
                brain[side] += cnt or 0
            recent["7d"] += c7 or 0
            recent["30d"] += c30 or 0
        counts[key] = total
    counts["total"] = sum(counts.values())

    # 文件夹树（三层）+ 每夹条数
    folder_q = db.query(Folder).filter(scope_condition(Folder, user_id, tenant))
    if brain_side != "both":
        folder_q = folder_q.filter(Folder.brain_side == brain_side)
    folder_rows = folder_q.order_by(Folder.sort_order, Folder.created_at).all()
    folder_counts = _folder_content_counts(db, user_id, tenant, brain_side)
    unfiled = folder_counts.pop(None, 0)
    by_parent: Dict[Optional[str], list] = {}
    for f in folder_rows:
        by_parent.setdefault(f.parent_id, []).append(f)
    folders: List[dict] = []

    def _walk(parent_id, depth):
        if depth > 3:
            return
        for f in by_parent.get(parent_id, []):
            folders.append({
                "id": f.id, "name": f.name, "parent_id": f.parent_id,
                "depth": depth, "count": folder_counts.get(f.id, 0),
            })
            _walk(f.id, depth + 1)

    _walk(None, 1)

    # top 10 标签（活内容条数，幽灵行不计——口径同 tag_service._live_usage_breakdown）
    assoc_rows = (
        db.query(content_tags.c.tag_id, Tag.name, content_tags.c.content_type, content_tags.c.content_id)
        .join(Tag, content_tags.c.tag_id == Tag.id)
        .filter(scope_condition(Tag, user_id, tenant))
        .all()
    )
    ids_by_type: Dict[str, set] = {}
    for _, _, ctype, cid in assoc_rows:
        ids_by_type.setdefault(ctype, set()).add(cid)
    alive = _live_tag_assoc_ids(db, ids_by_type, brain_side)
    tag_counts: Dict[str, int] = {}
    tag_names: Dict[str, str] = {}
    for tid, tname, ctype, cid in assoc_rows:
        tag_names[tid] = tname
        if (ctype, cid) in alive:
            tag_counts[tid] = tag_counts.get(tid, 0) + 1
    top_tags = [
        {"name": tag_names[tid], "count": cnt}
        for tid, cnt in sorted(tag_counts.items(), key=lambda kv: (-kv[1], tag_names[kv[0]]))[:10]
        if cnt > 0
    ]

    # 图谱：边数（分类型）+ graphify 构建状态
    edge_rows = (
        db.query(GraphEdge.edge_type, func.count(GraphEdge.id))
        .filter(scope_condition(GraphEdge, user_id, tenant))
        .group_by(GraphEdge.edge_type)
        .all()
    )
    edges_by_type = {(et or "unknown"): cnt for et, cnt in edge_rows}
    # 构建状态按空间取行（09-12）：团队=tenant_id=T 共享行；个人=本人 '' 占位行
    # （'' 而非 NULL：SQLite 复合主键 NULL 不判重，见 models/graph_build.py 注释）
    if tenant:
        build_row = db.query(GraphBuildState).filter(GraphBuildState.tenant_id == tenant.id).first()
    else:
        build_row = db.query(GraphBuildState).filter(
            GraphBuildState.user_id == user_id, GraphBuildState.tenant_id == "").first()
    build = None
    if build_row:
        build = {
            "state": build_row.state, "has_graph": bool(build_row.has_graph),
            "doc_count": build_row.doc_count, "synced_edges": build_row.synced_edges,
            "finished_at": build_row.finished_at, "progress": build_row.progress,
            "error": build_row.error,
        }

    # 进化阶段 × 核验状态联合分组（一条 SQL，Python 侧拆两个分布）
    ev_rows = (
        db.query(KnowledgeUnit.evolution_stage, KnowledgeUnit.verification_status, func.count(KnowledgeUnit.id))
        .filter(scope_condition(KnowledgeUnit, user_id, tenant), KnowledgeUnit.status == "active")
    )
    ev_rows = _brain_filter(ev_rows, KnowledgeUnit, brain_side)
    evolution: Dict[str, int] = {}
    verification: Dict[str, int] = {}
    for stage, vs, cnt in ev_rows.group_by(
        KnowledgeUnit.evolution_stage, KnowledgeUnit.verification_status
    ).all():
        evolution[stage or "unknown"] = evolution.get(stage or "unknown", 0) + cnt
        verification[vs or "unknown"] = verification.get(vs or "unknown", 0) + cnt

    return {
        "brain_side": brain_side,
        "counts": counts,
        "brain": brain,
        "recent": recent,
        "folders": folders,
        "unfiled": unfiled,
        "top_tags": top_tags,
        "graph": {
            "edges_total": sum(edges_by_type.values()),
            "edges_by_type": edges_by_type,
            "build": build,
        },
        "evolution": evolution,
        "verification": verification,
    }


def snapshot_text(snap: dict) -> str:
    """快照渲染成紧凑文本块（注入 system prompt「站内事实」区，目标 ~400 字内）。"""
    c = snap["counts"]
    head = (
        f"库规模：笔记 {c['note']} 篇、剪藏 {c['clip']} 条、知识 {c['knowledge']} 条、"
        f"胶囊 {c['capsule']} 个，共 {c['total']} 条"
    )
    if snap["brain_side"] == "both":
        head += f"（个人脑 {snap['brain']['personal']} 条 / 网络脑 {snap['brain']['network']} 条）"
    parts = [head]
    r = snap["recent"]
    parts.append(f"新增：近 7 天 {r['7d']} 条，近 30 天 {r['30d']} 条")

    if snap["folders"]:
        names = {}
        children: Dict[Optional[str], list] = {}
        for f in snap["folders"]:
            names[f["id"]] = f
            children.setdefault(f["parent_id"], []).append(f)
        roots = sorted(children.get(None, []), key=lambda f: -f["count"])[:5]
        segs = []
        for root in roots:
            seg = f"{root['name']}({root['count']})"
            kids = sorted(children.get(root["id"], []), key=lambda f: -f["count"])[:3]
            if kids:
                seg += "＞" + "＞".join(f"{k['name']}({k['count']})" for k in kids)
            segs.append(seg)
        parts.append(f"文件夹：{'、'.join(segs)}；未归档 {snap['unfiled']} 条")

    if snap["top_tags"]:
        parts.append("常用标签：" + "、".join(f"{t['name']}({t['count']})" for t in snap["top_tags"][:6]))

    g = snap["graph"]
    edge_desc = "、".join(
        f"{_EDGE_TYPE_LABELS.get(et, et)} {cnt}" for et, cnt in g["edges_by_type"].items()
    )
    graph_seg = f"图谱：边 {g['edges_total']} 条"
    if edge_desc:
        graph_seg += f"（{edge_desc}）"
    build = g.get("build")
    if build:
        graph_seg += f"；graphify 构建状态 {build['state']}"
        if build.get("doc_count") is not None:
            graph_seg += f"（文档 {build['doc_count']} 篇、同步边 {build.get('synced_edges') or 0} 条）"
    else:
        graph_seg += "；尚未构建过图谱"
    parts.append(graph_seg)

    if snap["evolution"]:
        parts.append("知识进化阶段：" + "、".join(f"{k} {v}" for k, v in snap["evolution"].items()))
    if snap["verification"]:
        parts.append("知识核验状态：" + "、".join(f"{k} {v}" for k, v in snap["verification"].items()))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 意图路由（纯规则，零 LLM）
# ---------------------------------------------------------------------------

_COUNT_RE = re.compile(r"(多少|几[篇条个张]|数量|总数|一共|共有|有几)")
_LIST_RE = re.compile(r"(最近|最新|都有什么|有哪些|列出|罗列)")
_GRAPH_STATUS_RE = re.compile(r"图谱.*(状态|进度|怎么样|情况|什么样)|(状态|进度|怎么样|情况).{0,4}图谱")
_DRILL_FOLDER_RE = re.compile(
    r"[「《]?([^「」《》\s，。？！]{1,20})[」》]?\s*(?:个)?(?:文件夹|目录)\s*"
    r"(?:里|里面|下|下面)\s*(?:有什么|有哪些|都有什么|有多少|有什么内容)"
)
_DRILL_TAG_AFTER_RE = re.compile(
    r"标签\s*[「《]?([^「」《》\s，。？！]{1,20})[」》]?\s*"
    r"(?:里|里面|下|下面)\s*(?:有什么|有哪些|都有什么|有多少|有什么内容)"
)
_DRILL_TAG_BEFORE_RE = re.compile(
    r"[「《]?([^「」《》\s，。？！]{1,20})[」》]?\s*标签\s*"
    r"(?:里|里面|下|下面)\s*(?:有什么|有哪些|都有什么|有多少|有什么内容)"
)
_TITLE_RE = re.compile(r"「([^「」]{1,60})」|《([^《》]{1,60})》")
_NAME_PREFIX_RE = re.compile(r"^(我的|你的|这个|那个|一个)")


def _detect_type_word(message: str) -> Optional[str]:
    for key, words in _TYPE_WORDS:
        if any(w in message for w in words):
            return key
    return None


def _fmt_time(dt) -> str:
    return dt.strftime("%Y-%m-%d") if dt else "时间未知"


def _entity_fact(fid: str, stype: str, title: str, dt, preview: str = "") -> dict:
    return {
        "kind": "entity", "id": fid, "source_type": stype,
        "title": title, "time": _fmt_time(dt), "preview": (preview or "")[:200],
    }


def _stat_fact(label: str, value) -> dict:
    return {"kind": "stat", "label": label, "value": value}


def _type_count_intent(db: Session, user_id: str, tenant, brain_side: str, type_key: Optional[str]):
    """计数意图：指定类型给单类明细，未指定给全类型明细。"""
    now = _now_utc_naive()
    t7 = now - timedelta(days=7)
    targets = [ct for ct in _CONTENT_TYPES if type_key is None or ct[0] == type_key]
    facts = []
    lines = []
    for key, model, label, unit in targets:
        row = db.query(
            func.count(model.id),
            func.sum(case((model.created_at >= t7, 1), else_=0)),
        ).filter(scope_condition(model, user_id, tenant), model.status == "active")
        row = _brain_filter(row, model, brain_side).one()
        cnt, c7 = row[0] or 0, row[1] or 0
        facts.append(_stat_fact(f"{label}数量", cnt))
        facts.append(_stat_fact(f"{label}近7天新增", c7))
        lines.append(f"{label} {cnt} {unit}（近 7 天新增 {c7} {unit}）")
    text = "库中现有：" + "；".join(lines) + "。（数据库直查，active 口径）"
    return {"intent": "count", "facts": facts, "text": text}


def _graph_intent(db: Session, user_id: str, tenant, intent: str):
    """图谱计数/状态意图：边分类型计数 + graphify 构建状态。"""
    edge_rows = (
        db.query(GraphEdge.edge_type, func.count(GraphEdge.id))
        .filter(scope_condition(GraphEdge, user_id, tenant))
        .group_by(GraphEdge.edge_type)
        .all()
    )
    by_type = {(et or "unknown"): cnt for et, cnt in edge_rows}
    total = sum(by_type.values())
    facts = [_stat_fact("图谱边总数", total)]
    for et, cnt in by_type.items():
        facts.append(_stat_fact(f"图谱边·{_EDGE_TYPE_LABELS.get(et, et)}", cnt))
    desc = "、".join(f"{_EDGE_TYPE_LABELS.get(et, et)} {cnt}" for et, cnt in by_type.items())
    text = f"图谱现有边 {total} 条" + (f"（{desc}）" if desc else "")
    # 构建状态按空间取行（09-12，口径同上：团队共享行 / 个人 '' 占位行）
    if tenant:
        build = db.query(GraphBuildState).filter(GraphBuildState.tenant_id == tenant.id).first()
    else:
        build = db.query(GraphBuildState).filter(
            GraphBuildState.user_id == user_id, GraphBuildState.tenant_id == "").first()
    if build:
        facts.append(_stat_fact("graphify 构建状态", build.state))
        text += (f"；graphify 构建状态：{build.state}（文档 {build.doc_count or 0} 篇、"
                 f"同步边 {build.synced_edges or 0} 条）")
        if build.error:
            text += f"，最近错误：{str(build.error)[:80]}"
    else:
        text += "；尚未构建过图谱"
    return {"intent": intent, "facts": facts, "text": text + "。（数据库直查）"}


def _recent_intent(db: Session, user_id: str, tenant, brain_side: str, type_key: Optional[str]):
    """列表意图：按类型取最近 10 条（未指明类型默认个人笔记）。"""
    key = type_key or "note"
    model = dict((k, m) for k, m, _, _ in _CONTENT_TYPES)[key]
    label, unit = _TYPE_LABEL[key], _TYPE_UNIT[key]
    q = db.query(model).filter(scope_condition(model, user_id, tenant), model.status == "active")
    q = _brain_filter(q, model, brain_side)
    rows = q.order_by(model.updated_at.desc()).limit(10).all()
    facts = []
    for row in rows:
        if key == "note":
            title, preview = row.title or "无标题笔记", row.content or ""
        elif key == "clip":
            title, preview = row.title or row.url or "未命名剪藏", row.excerpt or row.full_text or ""
        elif key == "knowledge":
            title = row.source_title or row.content_type or "未命名知识"
            preview = row.content_raw or ""
        else:  # capsule 正文加密落库，明细不给预览
            title, preview = f"胶囊（{row.content_type or '未分类'}）", ""
        facts.append(_entity_fact(row.id, key, title, row.updated_at or row.created_at, preview))
    lines = [f"- {f['title']}（{f['time']}）" for f in facts]
    default_note = "（未指明类型，默认列个人笔记）" if type_key is None else ""
    if lines:
        text = f"最近的{label}{default_note}（按更新时间，前 10 条）：\n" + "\n".join(lines)
    else:
        text = f"库中暂无{label}。（数据库直查）"
    return {"intent": "list", "facts": facts, "text": text}


def _find_folder(db: Session, user_id: str, tenant, brain_side: str, name: str) -> Optional[Folder]:
    """按名字找文件夹：先精确后模糊 LIKE（转义），同空间口径。"""
    q = db.query(Folder).filter(scope_condition(Folder, user_id, tenant))
    if brain_side != "both":
        q = q.filter(Folder.brain_side == brain_side)
    exact = q.filter(Folder.name == name).first()
    if exact:
        return exact
    like = f"%{_like_escape(name)}%"
    return q.filter(Folder.name.ilike(like, escape="\\")).order_by(func.length(Folder.name)).first()


def _find_tag(db: Session, user_id: str, tenant, name: str) -> Optional[Tag]:
    q = db.query(Tag).filter(scope_condition(Tag, user_id, tenant))
    exact = q.filter(Tag.name == name).first()
    if exact:
        return exact
    like = f"%{_like_escape(name)}%"
    return q.filter(Tag.name.ilike(like, escape="\\")).order_by(func.length(Tag.name)).first()


def _folder_drill_intent(db: Session, user_id: str, tenant, brain_side: str, name: str):
    folder = _find_folder(db, user_id, tenant, brain_side, name)
    if not folder:
        return {"intent": "drill_folder", "facts": [], "text": f"库里没有找到名称含「{name}」的文件夹。（数据库直查）"}
    facts = []
    total = 0
    for key, model in (("note", Note), ("clip", BrowserClip), ("knowledge", KnowledgeUnit)):
        q = db.query(model).filter(
            scope_condition(model, user_id, tenant), model.status == "active",
            model.folder_id == folder.id,
        )
        q = _brain_filter(q, model, brain_side)
        rows = q.order_by(model.updated_at.desc()).limit(10).all()
        total += db.query(func.count(model.id)).filter(
            scope_condition(model, user_id, tenant), model.status == "active",
            model.folder_id == folder.id,
        ).scalar() or 0
        for row in rows:
            if key == "note":
                title, preview = row.title or "无标题笔记", row.content or ""
            elif key == "clip":
                title, preview = row.title or row.url or "未命名剪藏", row.excerpt or ""
            else:
                title = row.source_title or row.content_type or "未命名知识"
                preview = row.content_raw or ""
            facts.append(_entity_fact(row.id, key, title, row.updated_at or row.created_at, preview))
    facts.sort(key=lambda f: f["time"], reverse=True)
    facts = facts[:10]
    lines = [f"- [{_TYPE_LABEL[f['source_type']]}] {f['title']}（{f['time']}）" for f in facts]
    text = f"文件夹「{folder.name}」下共 {total} 条内容"
    if lines:
        text += "，最近 10 条：\n" + "\n".join(lines)
    else:
        text += "（空文件夹）"
    return {"intent": "drill_folder", "facts": facts, "text": text + "。（数据库直查）"}


def _tag_drill_intent(db: Session, user_id: str, tenant, brain_side: str, name: str):
    tag = _find_tag(db, user_id, tenant, name)
    if not tag:
        return {"intent": "drill_tag", "facts": [], "text": f"库里没有找到名称含「{name}」的标签。（数据库直查）"}
    assoc = db.query(content_tags.c.content_type, content_tags.c.content_id).filter(
        content_tags.c.tag_id == tag.id
    ).all()
    ids_by_type: Dict[str, set] = {}
    for ctype, cid in assoc:
        ids_by_type.setdefault(ctype, set()).add(cid)
    alive = _live_tag_assoc_ids(db, ids_by_type, brain_side)
    facts = []
    for ctype, model in (("note", Note), ("clip", BrowserClip), ("knowledge", KnowledgeUnit)):
        live_ids = [cid for t, cid in alive if t == ctype]
        if not live_ids:
            continue
        rows = db.query(model).filter(model.id.in_(live_ids)).order_by(model.updated_at.desc()).limit(10).all()
        for row in rows:
            if ctype == "note":
                title, preview = row.title or "无标题笔记", row.content or ""
            elif ctype == "clip":
                title, preview = row.title or row.url or "未命名剪藏", row.excerpt or ""
            else:
                title = row.source_title or row.content_type or "未命名知识"
                preview = row.content_raw or ""
            facts.append(_entity_fact(row.id, ctype, title, row.updated_at or row.created_at, preview))
    facts.sort(key=lambda f: f["time"], reverse=True)
    facts = facts[:10]
    lines = [f"- [{_TYPE_LABEL[f['source_type']]}] {f['title']}（{f['time']}）" for f in facts]
    text = f"标签「{tag.name}」下共 {len(alive)} 条活内容"
    if lines:
        text += "，最近 10 条：\n" + "\n".join(lines)
    return {"intent": "drill_tag", "facts": facts, "text": text + "。（数据库直查）"}


def _title_lookup_intent(db: Session, user_id: str, tenant, brain_side: str, name: str):
    """标题查找：四表模糊匹配标题，返回命中摘要（标题/类型/时间/前 200 字）。"""
    like = f"%{_like_escape(name)}%"
    facts = []
    q = db.query(Note).filter(
        scope_condition(Note, user_id, tenant), Note.status == "active",
        Note.title.ilike(like, escape="\\"),
    )
    for row in _brain_filter(q, Note, brain_side).order_by(Note.updated_at.desc()).limit(5).all():
        facts.append(_entity_fact(row.id, "note", row.title or "无标题笔记",
                                  row.updated_at or row.created_at, row.content or ""))
    q = db.query(BrowserClip).filter(
        scope_condition(BrowserClip, user_id, tenant), BrowserClip.status == "active",
        BrowserClip.title.ilike(like, escape="\\"),
    )
    for row in _brain_filter(q, BrowserClip, brain_side).order_by(BrowserClip.updated_at.desc()).limit(5).all():
        facts.append(_entity_fact(row.id, "clip", row.title or row.url or "未命名剪藏",
                                  row.updated_at or row.created_at, row.excerpt or ""))
    q = db.query(KnowledgeUnit).filter(
        scope_condition(KnowledgeUnit, user_id, tenant), KnowledgeUnit.status == "active",
        KnowledgeUnit.source_title.ilike(like, escape="\\"),
    )
    for row in _brain_filter(q, KnowledgeUnit, brain_side).order_by(KnowledgeUnit.updated_at.desc()).limit(5).all():
        facts.append(_entity_fact(row.id, "knowledge", row.source_title or row.content_type or "未命名知识",
                                  row.updated_at or row.created_at, row.content_raw or ""))
    # 胶囊无标题列：解密正文做子串匹配（存量明文原样透传，规模小可接受）
    from app.core.crypto import decrypt_capsule_content
    q = db.query(Capsule).filter(scope_condition(Capsule, user_id, tenant), Capsule.status == "active")
    for row in _brain_filter(q, Capsule, brain_side).order_by(Capsule.updated_at.desc()).limit(200).all():
        body = decrypt_capsule_content(row.content_body)
        if name.lower() in (body or "").lower():
            facts.append(_entity_fact(row.id, "capsule", (body or "Capsule")[:50],
                                      row.updated_at or row.created_at, body))
    facts.sort(key=lambda f: f["time"], reverse=True)
    facts = facts[:10]
    if not facts:
        return {"intent": "title_lookup", "facts": [], "text": f"库里没有标题含「{name}」的内容。（数据库直查）"}
    lines = [
        f"- [{_TYPE_LABEL[f['source_type']]}] {f['title']}（{f['time']}）"
        + (f"\n  摘要：{f['preview']}" if f["preview"] else "")
        for f in facts
    ]
    text = f"找到 {len(facts)} 条标题含「{name}」的内容（数据库直查）：\n" + "\n".join(lines)
    return {"intent": "title_lookup", "facts": facts, "text": text}


def answer_site_intent(db: Session, user_id: str, tenant, brain_side: str, message: str) -> Optional[dict]:
    """规则意图路由（纯字符串/正则，零 LLM）。命中返回 {intent, facts, text}，未命中 None。

    匹配顺序：钻取（文件夹/标签）→ 标题查找（「」/《》）→ 图谱状态 → 计数 → 列表。
    """
    msg = (message or "").strip()
    if not msg:
        return None

    # 1) 钻取类：「X」文件夹/目录里有什么、标签 X 下有什么
    m = _DRILL_FOLDER_RE.search(msg)
    if m:
        name = _NAME_PREFIX_RE.sub("", m.group(1))
        if name:
            return _folder_drill_intent(db, user_id, tenant, brain_side, name)
    m = _DRILL_TAG_AFTER_RE.search(msg) or _DRILL_TAG_BEFORE_RE.search(msg)
    if m:
        name = _NAME_PREFIX_RE.sub("", m.group(1))
        if name:
            return _tag_drill_intent(db, user_id, tenant, brain_side, name)

    # 2) 标题查找类：「X」/《X》
    m = _TITLE_RE.search(msg)
    if m:
        name = m.group(1) or m.group(2)
        return _title_lookup_intent(db, user_id, tenant, brain_side, name)

    # 3) 图谱状态类：图谱 + 状态/进度/怎么样
    if _GRAPH_STATUS_RE.search(msg):
        return _graph_intent(db, user_id, tenant, "graph_status")

    # 4) 计数类：多少/几篇/数量/总数 ± 类型词（图谱/边、标签、文件夹走各自口径）
    if _COUNT_RE.search(msg):
        if "图谱" in msg or "边" in msg:
            return _graph_intent(db, user_id, tenant, "count_graph")
        if "标签" in msg:
            cnt = db.query(func.count(Tag.id)).filter(scope_condition(Tag, user_id, tenant)).scalar() or 0
            return {"intent": "count", "facts": [_stat_fact("标签数量", cnt)],
                    "text": f"库中现有标签 {cnt} 个。（数据库直查）"}
        if "文件夹" in msg or "目录" in msg:
            q = db.query(func.count(Folder.id)).filter(scope_condition(Folder, user_id, tenant))
            if brain_side != "both":
                q = q.filter(Folder.brain_side == brain_side)
            cnt = q.scalar() or 0
            return {"intent": "count", "facts": [_stat_fact("文件夹数量", cnt)],
                    "text": f"库中现有文件夹 {cnt} 个。（数据库直查）"}
        return _type_count_intent(db, user_id, tenant, brain_side, _detect_type_word(msg))

    # 5) 列表类：最近/最新/都有什么/有哪些/列出 ± 类型词
    if _LIST_RE.search(msg):
        return _recent_intent(db, user_id, tenant, brain_side, _detect_type_word(msg))

    return None


# ── 内容版本戳（前端 B+A 准实时刷新，09-14）──
# 后台写入（同步拉取/自动打标/图谱自进化）改了数据前端不知道——轮询本戳，
# 戳变才触发失效刷新（active-only），戳不变零成本。全部便宜聚合，目标 <50ms。

def content_version(db: Session, user_id: str, tenant) -> dict:
    """空间口径的内容版本戳：四类内容（计数+最新更新）+ 标签关联行数 +
    标签数+最新更新 + 文件夹数+最新更新。任一变化戳即变。
    返回 stamp（sha1 短哈希，前端只比对不等）+ 明细（调试用）。"""
    import hashlib

    from app.models.base import Document  # 文档是 09-11 才进的内容类型

    parts: List[str] = []
    for model in (Note, BrowserClip, KnowledgeUnit, Document):
        cnt, mx = db.query(func.count(model.id), func.max(model.updated_at)).filter(
            scope_condition(model, user_id, tenant)).one()
        parts.append(f"{cnt}:{mx}")
    assoc_cnt, assoc_max = db.query(
        func.count(), func.max(content_tags.c.created_at)
    ).select_from(content_tags).join(
        Tag, content_tags.c.tag_id == Tag.id
    ).filter(scope_condition(Tag, user_id, tenant)).one()
    parts.append(f"{assoc_cnt}:{assoc_max}")
    tag_cnt, tag_max = db.query(func.count(Tag.id), func.max(Tag.updated_at)).filter(
        scope_condition(Tag, user_id, tenant)).one()
    parts.append(f"{tag_cnt}:{tag_max}")
    folder_cnt, folder_max = db.query(func.count(Folder.id), func.max(Folder.updated_at)).filter(
        scope_condition(Folder, user_id, tenant)).one()
    parts.append(f"{folder_cnt}:{folder_max}")
    raw = "|".join(parts)
    return {"stamp": hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16], "detail": raw}
