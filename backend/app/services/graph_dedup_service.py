# -*- coding: utf-8 -*-
"""图谱实体消歧执行链（09-19 GraphRAG P1① 下半场）：候选预筛 → LLM 判定 →
写前程序校验 → 合并动作（借鉴 WeKnora wiki_ingest_dedup 的链式模式，代码全新写）。

与 graph_audit_service（只读诊断）互补：本模块是唯一会【写】graph.json 的消歧入口。

链路口径：
- 候选预筛：复用 entity_dedup_audit（同 norm 组 + difflib 高相似对），不另长一套；
- LLM 判定：主仓走计费平台默认通道。血泪#29：小模型不做判断题——本地 0.8b
  禁入本链。开源版 Ollama-only 没有平台模型，本链整体不可用（入口直接报错，
  不落假合并结果，血泪#34 口径保留）；
- 写前程序校验（核心闸）：LLM 输出的 winner/loser 必须都在审计候选集、互不相同，
  幻觉 id 一律拒绝并 warning 留痕——程序不信模型的嘴；
- 合并动作：snapshot_graph 自动留底 → loser 节点删除（label/aliases/source_file/
  community 并入 winner 择优）→ 边 remap + 同 (source,target,relation) 去重
  （confidence 择优，EXTRACTED>INFERRED>AMBIGUOUS 同 graphify_service.CONFIDENCE_WEIGHT
  口径）→ 写回 graph.json → 复用回滚链（sync_edges_from_build +
  _post_build_enrichments）重建派生表并更新 build 状态。
"""
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.services import graphify_service as gfs
from app.services.graph_audit_service import entity_dedup_audit
from app.services.llm_service import chat_completion

logger = logging.getLogger(__name__)

# 判定模型：平台默认通道唯一事实源（血泪#29：本地 0.8b 不做判断题，绝不降级本地）
# 开源版无平台按量模型目录：消歧判定直走本地默认模型
DEDUP_JUDGE_MODEL = "ollama-qwen3.5-0.8b"

_BATCH_SIZE = 20   # 每批喂给判定的候选对数（JSON 输出稳定性优先）
_PAIR_CAP = 60     # 单次执行最多判定的候选对数（审计候选对本身 cap 50，组内对另算）


# ---------------------------------------------------------------- 候选预筛

def _candidate_pairs(graph: Dict[str, Any], audit: Dict[str, Any]) -> List[Dict[str, str]]:
    """审计结果 → 节点 id 候选对（去重、cap）。组内两两 + 高相似 label 对映射回节点。"""
    by_label: Dict[str, List[Dict[str, Any]]] = {}
    for n in graph.get("nodes", []):
        label = (n.get("label") or "").strip()
        if label and n.get("id"):
            by_label.setdefault(label, []).append(n)

    pairs: List[Dict[str, str]] = []
    seen = set()

    def _add(ida: str, label_a: str, idb: str, label_b: str) -> None:
        if not ida or not idb or ida == idb:
            return
        key = (ida, idb) if ida < idb else (idb, ida)
        if key in seen:
            return
        seen.add(key)
        pairs.append({"a_id": ida, "a_label": label_a, "b_id": idb, "b_label": label_b})

    # ① 同 norm_label 组内两两（审计组里的节点带 id）
    for g in audit.get("groups", []):
        ns = [n for n in g.get("nodes", []) if n.get("id")]
        for i in range(len(ns)):
            for j in range(i + 1, len(ns)):
                _add(ns[i]["id"], ns[i].get("label") or "",
                     ns[j]["id"], ns[j].get("label") or "")
    # ② 高相似 label 对 → 节点 id 对（同名多节点全展开，组间交叉也算）
    for c in audit.get("candidates", []):
        for na in by_label.get((c.get("a") or "").strip(), []):
            for nb in by_label.get((c.get("b") or "").strip(), []):
                _add(na["id"], na.get("label") or "", nb["id"], nb.get("label") or "")

    if len(pairs) > _PAIR_CAP:
        logger.warning("entity dedup: 候选对 %d 超 cap %d，截断（剩余下轮再判）", len(pairs), _PAIR_CAP)
        pairs = pairs[:_PAIR_CAP]
    return pairs


# ---------------------------------------------------------------- LLM 判定

_SYSTEM_PROMPT = "你是个人知识库的图谱管理员，负责判断图谱节点是否指向同一现实实体。只输出 JSON。"


def _build_judge_prompt(batch: List[Dict[str, str]]) -> str:
    lines = [f'- a_id={p["a_id"]} label=《{p["a_label"]}》  |  b_id={p["b_id"]} label=《{p["b_label"]}》'
             for p in batch]
    return (
        "下面是知识图谱里疑似重复的节点对。请逐对判断两个节点是否指向同一个现实实体"
        "（同一概念的不同写法/别名算同一实体；仅相关但不同的概念不算）。\n"
        "对判定为同一实体的对，选出应保留的节点作为 winner（信息量大、命名更规范者优先），"
        "另一个为 loser。\n"
        "只输出 JSON：{\"merges\": [{\"winner_id\": \"...\", \"loser_id\": \"...\", \"reason\": \"...\"}]}\n"
        "winner_id/loser_id 必须原样取自下面给出的 id，禁止编造；没有可合并的就输出 {\"merges\": []}。\n\n"
        "候选对：\n" + "\n".join(lines)
    )


def _parse_judge_json(raw: str) -> List[Dict[str, Any]]:
    """解析判定输出（容忍 ```json 围栏；根可为 {"merges": [...]} 或直接列表）。"""
    json_str = raw
    if "```json" in raw:
        json_str = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        json_str = raw.split("```")[1].split("```")[0].strip()
    result = json.loads(json_str)
    if isinstance(result, dict):
        result = result.get("merges", [])
    if not isinstance(result, list):
        raise ValueError("AI 返回格式错误：期望 merges 列表")
    return [m for m in result if isinstance(m, dict)]


# ---------------------------------------------------------------- 写前程序校验（核心闸）

def _validate_merges(raw_merges: List[Dict[str, Any]],
                     candidate_ids: set,
                     node_ids: set) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """写前程序校验：winner/loser 必须都在候选集、互不相同、必须是审计出的节点 id。
    幻觉输出拒绝并 warning 留痕——这是程序不信模型的核心闸。"""
    ok: List[Dict[str, str]] = []
    rejected: List[Dict[str, str]] = []
    seen = set()
    for m in raw_merges:
        w, l = m.get("winner_id"), m.get("loser_id")
        entry = {"winner_id": str(w), "loser_id": str(l)}
        if not isinstance(w, str) or not isinstance(l, str):
            entry["reason"] = "输出缺 winner_id/loser_id 或类型不对"
        elif w == l:
            entry["reason"] = "winner 与 loser 相同"
        elif w not in candidate_ids or l not in candidate_ids:
            entry["reason"] = "幻觉 id：不在审计候选集内"
        elif w not in node_ids or l not in node_ids:
            entry["reason"] = "幻觉 id：不是图谱已有节点"
        else:
            key = (w, l) if w < l else (l, w)
            if key in seen:
                entry["reason"] = "重复合并对（已采信前者）"
            else:
                seen.add(key)
                ok.append({"winner_id": w, "loser_id": l,
                           "reason": str(m.get("reason") or "")[:200]})
                continue
        rejected.append(entry)
        logger.warning("entity dedup: 拒绝 LLM 合并输出 winner=%s loser=%s：%s",
                       w, l, entry["reason"])
    return ok, rejected


async def propose_entity_merges(db: Session, user_id: str, tenant=None) -> Dict[str, Any]:
    """消歧提案（dry_run 的数据源）：审计候选 → 分批 LLM 判定 → 写前校验。零写入。

    LLM 通道不可用/输出全批解析失败 → 抛 ValueError，不落假结果（血泪#34）。"""
    # 开源版 Ollama-only：无平台判定模型，本链不可用（血泪#29 口径）
    raise ValueError("实体消歧需要平台级判定模型，开源本地版（Ollama-only 0.8b）不提供该能力")
    tid = tenant.id if tenant else None
    graph = gfs.load_graph(user_id, tenant_id=tid)
    if not graph:
        raise ValueError("图谱尚未构建，请先构建图谱")
    audit = entity_dedup_audit(db, user_id, tenant=tenant)
    pairs = _candidate_pairs(graph, audit)
    node_ids = {n.get("id") for n in graph.get("nodes", []) if n.get("id")}
    if not pairs:
        return {"ok": True, "model": DEDUP_JUDGE_MODEL, "candidate_pairs": 0,
                "merges": [], "rejected": [], "batch_errors": []}

    candidate_ids = {p["a_id"] for p in pairs} | {p["b_id"] for p in pairs}
    raw_merges: List[Dict[str, Any]] = []
    batch_errors: List[str] = []
    for i in range(0, len(pairs), _BATCH_SIZE):
        batch = pairs[i:i + _BATCH_SIZE]
        raw = await chat_completion(
            prompt=_build_judge_prompt(batch),
            task_type="graph_entity_dedup",
            system_prompt=_SYSTEM_PROMPT,
        )
        text = (raw or "").strip()
        if not text or text.lstrip().startswith("[Error"):
            # 通道不可用：整链报错，不落假结果（血泪#34）
            raise ValueError(f"消歧判定模型调用失败：{text[:200] or '空响应'}")
        try:
            raw_merges.extend(_parse_judge_json(text))
        except Exception as e:
            # 单批坏 JSON 不拖死整链：warning 留痕，该批按无判定处理
            logger.warning("entity dedup: 第 %d 批判定输出解析失败 user=%s: %s",
                           i // _BATCH_SIZE + 1, user_id, e)
            batch_errors.append(f"第 {i // _BATCH_SIZE + 1} 批输出解析失败")
    if not raw_merges and batch_errors:
        raise ValueError("消歧判定输出全部解析失败，未落任何合并结果")

    ok, rejected = _validate_merges(raw_merges, candidate_ids, node_ids)
    # 展示用 label 回填（前端预览清单要人话）
    labels = {n.get("id"): (n.get("label") or "") for n in graph.get("nodes", [])}
    for m in ok:
        m["winner_label"] = labels.get(m["winner_id"], "")
        m["loser_label"] = labels.get(m["loser_id"], "")
    return {"ok": True, "model": DEDUP_JUDGE_MODEL, "candidate_pairs": len(pairs),
            "merges": ok, "rejected": rejected, "batch_errors": batch_errors}


# ---------------------------------------------------------------- 合并动作

def _resolve_remap(merges: List[Dict[str, str]]) -> Dict[str, str]:
    """loser → 终态 winner 的 remap 表（链式归并：A→B、B→C 则 A→C；环防御跳过留痕）。"""
    nxt = {m["loser_id"]: m["winner_id"] for m in merges}

    def _terminal(x: str) -> Optional[str]:
        seen = set()
        while x in nxt:
            if x in seen:
                return None
            seen.add(x)
            x = nxt[x]
        return x

    remap: Dict[str, str] = {}
    for loser in nxt:
        t = _terminal(loser)
        if t is None or t == loser:
            logger.warning("entity dedup: remap 成环，跳过 loser=%s", loser)
            continue
        remap[loser] = t
    return remap


def _merge_nodes(graph: Dict[str, Any], remap: Dict[str, str]) -> int:
    """loser 节点并入 winner：label 信息量大者优先，loser label 进 aliases，
    source_file/community 并集择优；loser 节点删除。返回合并节点数。"""
    nodes = {n.get("id"): n for n in graph.get("nodes", []) if n.get("id")}
    by_winner: Dict[str, List[str]] = {}
    for loser, winner in remap.items():
        if loser in nodes and winner in nodes:
            by_winner.setdefault(winner, []).append(loser)
    merged = 0
    for winner_id, losers in by_winner.items():
        w = nodes[winner_id]
        aliases: List[str] = list(w.get("aliases") or [])
        for loser_id in losers:
            l = nodes[loser_id]
            w_label = str(w.get("label") or "")
            l_label = str(l.get("label") or "")
            # label 择优：信息量大者（字符更长）优先，loser label 留进 aliases
            if len(l_label) > len(w_label):
                if w_label and w_label not in aliases:
                    aliases.append(w_label)
                w["label"] = l_label
                if "norm_label" in w:
                    w["norm_label"] = l_label.strip().lower()
            elif l_label and l_label != w_label and l_label not in aliases:
                aliases.append(l_label)
            for a in (l.get("aliases") or []):
                if a and a != w["label"] and a not in aliases:
                    aliases.append(a)
            # source_file/community 并集择优：winner 缺则取 loser 的
            if not w.get("source_file") and l.get("source_file"):
                w["source_file"] = l["source_file"]
            if w.get("community") is None and l.get("community") is not None:
                w["community"] = l["community"]
            merged += 1
        if aliases:
            w["aliases"] = aliases
    loser_ids = {l for ls in by_winner.values() for l in ls}
    graph["nodes"] = [n for n in graph.get("nodes", []) if n.get("id") not in loser_ids]
    return merged


def _remap_links(graph: Dict[str, Any], remap: Dict[str, str]) -> Dict[str, int]:
    """边 remap：loser 端点改指终态 winner；自环/孤儿删除；同 (source,target,relation)
    去重保留 confidence 更高者（EXTRACTED>INFERRED>AMBIGUOUS 序同 CONFIDENCE_WEIGHT）。"""
    node_ids = {n.get("id") for n in graph.get("nodes", [])}
    stats = {"edges_remapped": 0, "edges_dropped": 0, "edges_deduped": 0}
    kept: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for link in graph.get("links", []):
        s, t = link.get("source"), link.get("target")
        ns, nt = remap.get(s, s), remap.get(t, t)
        if (ns, nt) != (s, t):
            stats["edges_remapped"] += 1
        if ns == nt or ns not in node_ids or nt not in node_ids:
            stats["edges_dropped"] += 1  # 合并后自环 / 端点已删的孤儿边
            continue
        new_link = dict(link, source=ns, target=nt)
        key = (ns, nt, link.get("relation") or "")
        old = kept.get(key)
        if old is None:
            kept[key] = new_link
            continue
        stats["edges_deduped"] += 1
        new_w = gfs.CONFIDENCE_WEIGHT.get(new_link.get("confidence") or "", 0.35)
        old_w = gfs.CONFIDENCE_WEIGHT.get(old.get("confidence") or "", 0.35)
        if new_w > old_w:
            kept[key] = new_link
    graph["links"] = list(kept.values())
    return stats


def apply_entity_merges(db: Session, user_id: str, merges: List[Dict[str, Any]],
                        tenant=None) -> Dict[str, Any]:
    """执行合并：快照留底 → 改 graph.json（节点合并+边 remap）→ 重建派生表。

    merges 先过写前校验二次闸（直接调用方也必须过，幻觉 id 拒落）。"""
    tid = tenant.id if tenant else None
    graph = gfs.load_graph(user_id, tenant_id=tid)
    if not graph:
        raise ValueError("图谱尚未构建，无可合并产物")
    node_ids = {n.get("id") for n in graph.get("nodes", []) if n.get("id")}
    ok, rejected = _validate_merges(merges, node_ids, node_ids)
    if not ok:
        return {"ok": True, "merged": 0, "rejected": rejected,
                "snapshot_id": None, "edges_remapped": 0, "edges_dropped": 0,
                "edges_deduped": 0, "warning": None}

    # 自动留底（swap 前快照，与重建同口径；回滚走 snapshots 链）
    snapshot_id = gfs.snapshot_graph(user_id, tenant_id=tid, trigger="dedup")

    remap = _resolve_remap(ok)
    merged = _merge_nodes(graph, remap)
    edge_stats = _remap_links(graph, remap)
    gfs._graph_json_path(user_id, tid).write_text(
        json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")

    # 复用回滚链重建派生表（graph_edges 整删整插 + 布局/社区摘要），更新 build 状态
    warning: Optional[str] = None
    sync_stats: Optional[Dict[str, int]] = None
    try:
        sync_stats = gfs.sync_edges_from_build(db, user_id, tenant_id=tid)
    except Exception as e:
        warning = f"语义边同步失败（图谱文件已合并）: {e}"
    warning = gfs._post_build_enrichments(db, user_id, warning, tenant_id=tid)
    st: Dict[str, Any] = dict(state="done", has_graph=True, progress=None, error=None,
                              finished_at=datetime.utcnow().isoformat() + "Z")
    if sync_stats is not None:
        st["synced_edges"] = sync_stats["created"]
    if warning:
        st["warning"] = warning
    gfs._set_build_status(user_id, tenant_id=tid, **st)

    return {"ok": True, "merged": merged, "rejected": rejected,
            "snapshot_id": snapshot_id, **edge_stats, "warning": warning}
