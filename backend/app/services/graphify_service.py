"""Graphify integration: export user content to a markdown corpus and build/query a knowledge graph via the graphify CLI.

Layout:
  backend/graphify_data/{user_id}/corpus/*.md                 # exported source documents
  backend/graphify_data/{user_id}/corpus/graphify-out/        # graph.json / graph.html / GRAPH_REPORT.md

Node → source mapping: each exported file is named `{type}__{source_id}.md`,
and graphify records the file path on every extracted node, so the frontend can
jump from a graph node back to the originating note/clip/knowledge unit.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.base import User, Note, BrowserClip, KnowledgeUnit, GraphEdge

logger = logging.getLogger(__name__)

DATA_ROOT = Path(os.environ.get("GRAPHIFY_DATA_DIR") or (Path(__file__).resolve().parents[2] / "graphify_data"))
VALID_TYPES = {"note", "clip", "knowledge"}

# user_id -> build status (in-memory; a build is a short-lived CLI run)
_build_status: Dict[str, Dict[str, Any]] = {}
_build_lock = threading.Lock()


def _user_dir(user_id: str) -> Path:
    return DATA_ROOT / user_id


def _corpus_dir(user_id: str) -> Path:
    return _user_dir(user_id) / "corpus"


def _out_dir(user_id: str) -> Path:
    # graphify extract writes graphify-out/ INSIDE the input directory
    return _corpus_dir(user_id) / "graphify-out"


def _graph_json_path(user_id: str) -> Path:
    return _out_dir(user_id) / "graph.json"


def _slug(text: str, max_len: int = 60) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    return text[:max_len] or "untitled"


def _yaml_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace('"', '\\"')


def _write_doc(corpus: Path, doc_type: str, source_id: str, title: str, body: str,
               extra_meta: Optional[Dict[str, str]] = None) -> None:
    if doc_type not in VALID_TYPES:
        return
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", source_id)
    if not safe_id:
        return
    meta = [
        "---",
        f'id: "{_yaml_escape(source_id)}"',
        f'type: "{doc_type}"',
        f'title: "{_yaml_escape(_slug(title))}"',
    ]
    for k, v in (extra_meta or {}).items():
        if v:
            meta.append(f'{k}: "{_yaml_escape(str(v))}"')
    meta.append("---")
    meta.append("")
    meta.append(f"# {_slug(title)}")
    meta.append("")
    meta.append((body or "").strip() or "(无正文)")
    (corpus / f"{doc_type}__{safe_id}.md").write_text("\n".join(meta), encoding="utf-8")


def export_user_corpus(db: Session, user_id: str) -> Dict[str, int]:
    """Rewrite the user's corpus documents from current DB content. Returns counts.

    Only the exported *.md files are replaced; corpus/graphify-out/ (the last
    built graph) is preserved so it stays readable until a new build swaps in.
    """
    corpus = _corpus_dir(user_id)
    corpus.mkdir(parents=True, exist_ok=True)
    for stale_doc in corpus.glob("*.md"):
        stale_doc.unlink()

    counts = {"note": 0, "clip": 0, "knowledge": 0}

    # Only live content belongs in the graph: soft-deleted/rejected items must
    # not keep influencing extraction after the user removed them.
    for note in db.query(Note).filter(Note.user_id == user_id, Note.status == "active").all():
        _write_doc(corpus, "note", note.id, note.title or "无标题笔记", note.content or "",
                   {"created_at": note.created_at.isoformat() if note.created_at else ""})
        counts["note"] += 1

    for clip in db.query(BrowserClip).filter(BrowserClip.user_id == user_id, BrowserClip.status == "active").all():
        body = clip.full_text or clip.excerpt or ""
        _write_doc(corpus, "clip", clip.id, clip.title or clip.url or "未命名剪藏", body,
                   {"url": clip.url or "", "domain": clip.domain or ""})
        counts["clip"] += 1

    for ku in db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id, KnowledgeUnit.status == "active").all():
        _write_doc(corpus, "knowledge", ku.id, ku.source_title or "知识单元", ku.content_raw or "",
                   {"url": ku.source_url or ""})
        counts["knowledge"] += 1

    return counts


def _graphify_env(preferred_model: Optional[str] = None) -> Dict[str, str]:
    from app.core.config import settings
    env = dict(os.environ)
    # Reasoning-model thinking prose breaks JSON extraction; keep it disabled.
    env.setdefault("GRAPHIFY_DISABLE_THINKING", "1")
    # graphify 子进程走 OpenAI 兼容端点（/v1），把后端的 Ollama 配置显式传下去——
    # 不能用 setdefault：compose 里注入的 OLLAMA_BASE_URL 没有 /v1 后缀。
    # 仅消除 graphify 的告警，Ollama 本身不校验 key。
    env.setdefault("OLLAMA_API_KEY", "ollama")
    # 图谱提取可用独立模型：0.5B 聊天模型太弱，提取 JSON 基本全会失败。
    env["OLLAMA_MODEL"] = getattr(settings, "GRAPHIFY_OLLAMA_MODEL", "") or settings.OLLAMA_MODEL
    # 用户在前端选了模型时优先其选择（本构建仅 Ollama，覆盖提取模型即可）
    if preferred_model:
        from app.services.llm_service import ModelConfig
        cfg = ModelConfig.get(preferred_model)
        if cfg:
            env["OLLAMA_MODEL"] = cfg["model_id"]
    return env


def _pick_backend() -> str:
    return "ollama"


def _run_cli(args: List[str], cwd: Optional[Path] = None, timeout: int = 1800,
             env: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "graphify", *args],
        cwd=str(cwd) if cwd else None,
        env=env or _graphify_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def get_build_status(user_id: str) -> Dict[str, Any]:
    with _build_lock:
        st = _build_status.get(user_id)
    if st:
        # has_graph lives only in terminal states; merge it from disk so a
        # rebuild in progress doesn't hide the still-readable previous graph.
        return {**st, "has_graph": st.get("has_graph") or _graph_json_path(user_id).exists()}
    has_graph = _graph_json_path(user_id).exists()
    return {"state": "idle", "has_graph": has_graph, "progress": None, "error": None}


def _set_build_status(user_id: str, **kwargs: Any) -> None:
    with _build_lock:
        _build_status.setdefault(user_id, {}).update(kwargs)


def build_graph(db: Session, user_id: str, preferred_model: Optional[str] = None) -> Dict[str, Any]:
    """Synchronous build: export corpus then run graphify extract. Caller should run in a thread."""
    _set_build_status(user_id, state="exporting", error=None, progress="正在导出语料…")
    try:
        counts = export_user_corpus(db, user_id)
    except Exception as e:
        _set_build_status(user_id, state="failed", error=f"语料导出失败: {e}")
        return get_build_status(user_id)

    total_docs = sum(counts.values())
    if total_docs == 0:
        _set_build_status(user_id, state="failed", error="没有可用于构建图谱的内容（笔记/剪藏/知识单元为空）")
        return get_build_status(user_id)

    user_dir = _user_dir(user_id)
    backend = _pick_backend()
    # 用户选了模型时带入其选择（覆盖提取用 OLLAMA_MODEL）
    cli_env = _graphify_env(preferred_model) if preferred_model else None
    # Build in a throwaway copy of the corpus, then swap graphify-out on success.
    # Three reasons:
    # 1. graphify caches per-chunk extraction results under graphify-out/cache —
    #    including FAILED chunks (a doc that failed extraction is cached as an
    #    edge-less fallback node). Building in a fresh dir guarantees no poisoned
    #    cache is reused.
    # 2. The previous graph stays readable while the new one builds, and a failed
    #    build leaves it untouched.
    # 3. graphify honours ancestor .gitignore files, and this repo gitignores
    #    backend/graphify_data/ — building inside the repo made the scanner see
    #    0 documents ("graph is empty"). The throwaway copy therefore lives in
    #    the system temp dir, outside any repo.
    tmp_root = Path(tempfile.mkdtemp(prefix="psb-graphify-"))
    build_dir = tmp_root / "corpus_building"
    out_dir = _out_dir(user_id)
    new_graph_json = build_dir / "graphify-out" / "graph.json"
    shutil.copytree(_corpus_dir(user_id), build_dir,
                    ignore=shutil.ignore_patterns("graphify-out"))

    _set_build_status(user_id, state="building", progress=f"正在用 {backend} 提取 {total_docs} 篇文档…")
    try:
        proc = _run_cli(["extract", "corpus_building", "--backend", backend], cwd=tmp_root, env=cli_env)
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp_root, ignore_errors=True)
        _set_build_status(user_id, state="failed", error="构建超时（30 分钟）")
        return get_build_status(user_id)

    if proc.returncode != 0 or not new_graph_json.exists():
        tail = (proc.stderr or proc.stdout or "")[-500:]
        logger.error("graphify extract failed for user %s: %s", user_id, tail)
        shutil.rmtree(tmp_root, ignore_errors=True)
        _set_build_status(user_id, state="failed", error="graphify 提取失败，请查看服务端日志")
        return get_build_status(user_id)

    # Step 2: clustering + community naming + GRAPH_REPORT.md + graph.html
    warning = None
    _set_build_status(user_id, state="building", progress="正在检测社区并生成报告…")
    try:
        proc2 = _run_cli(["cluster-only", "corpus_building", "--backend", backend], cwd=tmp_root, env=cli_env)
        if proc2.returncode != 0:
            # graph is already usable; report failure is non-fatal
            tail = (proc2.stderr or proc2.stdout or "")[-300:]
            logger.warning("graphify cluster-only failed for user %s: %s", user_id, tail)
            warning = "社区/报告生成失败（图谱可用），请查看服务端日志"
    except subprocess.TimeoutExpired:
        warning = "社区/报告生成超时（图谱可用）"

    # Swap the fresh output into place atomically-ish, then drop the build copy.
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.move(str(build_dir / "graphify-out"), str(out_dir))
    shutil.rmtree(tmp_root, ignore_errors=True)

    # Deep fusion: write semantic relations back into graph_edges so collision
    # pairing and the legacy graph APIs consume them. Sync failure must not
    # fail the build — the graph itself is already usable.
    sync_stats: Optional[Dict[str, int]] = None
    try:
        sync_stats = sync_edges_from_build(db, user_id)
    except Exception:
        logger.exception("graphify edge sync failed for user %s", user_id)
        warning = (warning + "；" if warning else "") + "语义边同步失败（图谱可用），请查看服务端日志"

    st: Dict[str, Any] = dict(state="done", has_graph=True, progress=None,
                              finished_at=datetime.utcnow().isoformat() + "Z", doc_count=total_docs)
    if sync_stats is not None:
        st["synced_edges"] = sync_stats["created"]
    if warning:
        st["warning"] = warning
    _set_build_status(user_id, **st)
    return get_build_status(user_id)


def start_build_background(db: Session, user_id: str, preferred_model: Optional[str] = None) -> Dict[str, Any]:
    st = get_build_status(user_id)
    if st.get("state") in ("exporting", "building"):
        return st
    _set_build_status(user_id, state="exporting", progress="正在导出语料…", error=None)
    thread = threading.Thread(target=build_graph, args=(db, user_id, preferred_model), daemon=True)
    thread.start()
    return get_build_status(user_id)


def load_graph(user_id: str) -> Optional[Dict[str, Any]]:
    path = _graph_json_path(user_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def load_community_labels(user_id: str) -> Dict[str, str]:
    """Community id -> human-readable name, written by `graphify cluster-only`."""
    path = _out_dir(user_id) / ".graphify_labels.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def parse_source_from_node(node: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Recover {type, id} from a node's source file path (file name `{type}__{id}.md`)."""
    for key in ("source", "file", "path", "source_file", "origin"):
        val = node.get(key)
        if not isinstance(val, str):
            continue
        m = re.search(r"(note|clip|knowledge)__([A-Za-z0-9_-]+)\.md", val)
        if m:
            return {"type": m.group(1), "id": m.group(2)}
    return None


# graphify edge confidence -> graph_edges.weight, same 0-1 scale the other
# auto-link rules use (tag=0.5, similar=0.6, support=0.9, ...)
CONFIDENCE_WEIGHT = {"EXTRACTED": 0.9, "INFERRED": 0.6, "AMBIGUOUS": 0.35}

# Hub concepts synthesized across documents have no single source_file; they are
# grounded back to content by text matching. Grounding is approximate, so edges
# touching a hub get this weight multiplier, and at most this many docs per hub.
HUB_GROUNDING_DISCOUNT = 0.8
HUB_MAX_DOCS = 3


def _ground_hub_concepts(user_id: str, nodes: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """Map hub-concept node ids (source_file=None) to up to HUB_MAX_DOCS content
    ids whose exported document text mentions the concept label."""
    hubs = [n for n in nodes if n.get("source_file") is None and (n.get("label") or "").strip()]
    if not hubs:
        return {}
    docs: Dict[str, str] = {}
    for md in _corpus_dir(user_id).glob("*.md"):
        m = re.match(r"(?:note|clip|knowledge)__([A-Za-z0-9_-]+)\.md", md.name)
        if m:
            try:
                docs[m.group(1)] = md.read_text(encoding="utf-8").lower()
            except OSError:
                continue
    grounded: Dict[str, List[str]] = {}
    for hub in hubs:
        label = (hub.get("norm_label") or hub.get("label") or "").strip().lower()
        if len(label) < 2:
            continue
        matches = [cid for cid, text in docs.items() if label in text]
        if matches:
            grounded[hub["id"]] = matches[:HUB_MAX_DOCS]
    return grounded


def sync_edges_from_build(db: Session, user_id: str) -> Dict[str, int]:
    """Write the built graphify graph back into graph_edges so the rest of the
    product (collision pairing, brain stats, graph APIs) can use graphify's
    semantic relations instead of only keyword/embedding heuristics.

    graphify links connect concept nodes; both endpoints are resolved back to
    content ids via their source file. Old synced edges are replaced wholesale
    (a rebuild reflects current content); duplicates of edges created by other
    rules are skipped via _create_edge's bidirectional check.
    """
    # Deferred import: endpoints.graph is the canonical home of _create_edge and
    # nine modules already import its helpers; importing at module level would
    # risk a cycle through the router.
    from app.api.v1.endpoints.graph import _create_edge, _resolve_node_brain_side

    graph = load_graph(user_id)
    if not graph:
        return {"created": 0, "skipped": 0}

    db.query(GraphEdge).filter(
        GraphEdge.user_id == user_id,
        GraphEdge.edge_type == "graphify",
        GraphEdge.auto_created.is_(True),
    ).delete(synchronize_session=False)

    nodes = graph.get("nodes", [])
    # node id -> [(content_id, hub_label_or_None)]: anchored nodes map 1:1, hub
    # concepts (no source_file) map to up to HUB_MAX_DOCS docs by text grounding.
    node_docs: Dict[str, List[tuple]] = {}
    for node in nodes:
        src = parse_source_from_node(node)
        if src:
            node_docs[node.get("id")] = [(src["id"], None)]
    for hub_id, content_ids in _ground_hub_concepts(user_id, nodes).items():
        hub_label = next((n.get("label") for n in nodes if n.get("id") == hub_id), None)
        node_docs[hub_id] = [(cid, hub_label) for cid in content_ids]

    created = skipped = 0
    seen: set = set()
    for link in graph.get("links", []):
        endpoints_a = node_docs.get(link.get("source"), [])
        endpoints_b = node_docs.get(link.get("target"), [])
        if not endpoints_a or not endpoints_b:
            skipped += 1
            continue
        relation = link.get("relation") or "related"
        confidence = link.get("confidence") or ""
        base_weight = CONFIDENCE_WEIGHT.get(confidence, 0.35)
        for a, hub_a in endpoints_a:
            for b, hub_b in endpoints_b:
                if a == b:
                    skipped += 1
                    continue
                key = (a, b) if a < b else (b, a)
                if key in seen:
                    skipped += 1
                    continue
                seen.add(key)
                hubs = [h for h in (hub_a, hub_b) if h]
                weight = base_weight * (HUB_GROUNDING_DISCOUNT if hubs else 1.0)
                context = f"graphify 语义关联：{relation}"
                if confidence:
                    context += f"（{confidence}）"
                if hubs:
                    context += f"·经概念「{'、'.join(hubs)}」"
                edge = _create_edge(
                    db, user_id, a, b,
                    _resolve_node_brain_side(db, a),
                    _resolve_node_brain_side(db, b),
                    "graphify",
                    round(weight, 3),
                    context=context,
                    auto_created=True,
                )
                if edge:
                    created += 1
                else:
                    skipped += 1
    db.commit()
    return {"created": created, "skipped": skipped}


def _run_query(user_id: str, args: List[str]) -> Dict[str, Any]:
    graph = _graph_json_path(user_id)
    if not graph.exists():
        return {"ok": False, "error": "图谱尚未构建，请先点击「重建图谱」"}
    try:
        proc = _run_cli([*args, "--graph", str(graph)], cwd=_user_dir(user_id), timeout=120)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "查询超时"}
    out = (proc.stdout or "").strip()
    if proc.returncode != 0:
        err = (proc.stderr or out or "查询失败")[-500:]
        logger.warning("graphify query failed for user %s: %s", user_id, err)
        return {"ok": False, "error": "图谱查询失败，请查看服务端日志"}
    return {"ok": True, "result": out}


async def query_graph(user_id: str, question: str, preferred_model: Optional[str] = None) -> Dict[str, Any]:
    retrieval = _run_query(user_id, ["query", question])
    if not retrieval.get("ok"):
        return retrieval
    trace = (retrieval.get("result") or "").strip()
    if not trace:
        return {"ok": True, "result": "图谱中没有检索到与问题相关的内容。", "evidence": ""}

    # graphify CLI 的 query 只做检索（节点/边列表），自然语言答案由这里
    # 用 LLM 基于检索结果组织——要求引用具体条目，不允许编造
    from app.services.llm_service import chat_completion

    prompt = (
        f"用户问题：{question}\n\n"
        f"以下是从用户的个人知识图谱中检索到的相关条目（NODE）和关系（EDGE）：\n"
        f"{trace[:4000]}\n\n"
        "请基于以上检索结果回答用户的问题。要求：\n"
        "- 只使用检索结果里的信息，不要编造或补充外部知识\n"
        "- 引用具体条目名称（用书名号《》标出）\n"
        "- 若检索结果与问题无关，如实说明知识库中暂未找到相关内容\n"
        "- 回答控制在 300 字以内，条理清晰\n"
    )
    answer = await chat_completion(
        prompt=prompt,
        task_type="graph_query",
        system_prompt="你是个人知识库问答助手，只根据给定的检索结果回答，答案必须带条目引用。",
        preferred_model=preferred_model,
    )
    answer = answer.strip() or "暂时无法生成回答，请重试。"
    return {"ok": True, "result": answer, "evidence": trace}


def path_graph(user_id: str, a: str, b: str) -> Dict[str, Any]:
    return _run_query(user_id, ["path", a, b])


def explain_graph(user_id: str, node: str) -> Dict[str, Any]:
    return _run_query(user_id, ["explain", node])


def graph_report_path(user_id: str) -> Optional[Path]:
    p = _out_dir(user_id) / "GRAPH_REPORT.md"
    return p if p.exists() else None
