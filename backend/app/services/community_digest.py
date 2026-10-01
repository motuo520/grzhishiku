"""RAG 大改阶段二：社区摘要层（graphrag-hierarchical-chat 思路，Youtu 式无 LLM 实现）。

背景：RAG 捞原文块只见树木不见森林，答不好「我最近都在关注什么」
「我库里主要有哪几块内容」「XX 领域我记了什么」这类全局/主题问题。
本服务对图谱社区做纯聚合摘要（零模型调用，硬约束），供 chat 注入
「社区摘要区」。

两路来源同口径：
- semantic：graphify 构建产物（community 编号 + community_labels 中文名），
  构建收尾整删整插（与 graph_layout_service 同钩子、失败不阻断），
  另有 /graphify/digests/rebuild 手动补算端点；
- physical：连通分量社区（物理图是请求时实时算的），摘要走懒刷新——
  内容指纹（条数+最新更新时间）变了才重算并缓存落库，chat 命中意图且
  无语义摘要时才触发，避免每次对话都算嵌入相似度。

关键词抽取说明：检索主链路的 _extract_search_keywords 住在 endpoints/llm.py，
服务层反向 import 端点会与 llm.py → community_digest 形成循环依赖，这里按
同一套思路（中文 2/3/4-gram + ASCII 词 + 停用词过滤）实现词频版，口径对齐。
"""
import json
import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.base import (
    BrowserClip, CommunityDigest, KnowledgeUnit, Note, Tag, content_tags,
)

logger = logging.getLogger(__name__)

# chat 注入的社区摘要区总长上限（全局概览）
OVERVIEW_MAX_CHARS = 600
# 主题命中时最多注入的社区数
TOPIC_MAX_COMMUNITIES = 3
_TOP_TAGS_N = 6
_KEYWORDS_N = 6
_REPS_N = 3
# 关键词语料正文截取长度（标题 + 正文开头，控制聚合成本）
_BODY_EXCERPT = 300

_STOPWORDS = {
    "怎么", "什么", "为什么", "如何", "多少", "哪里", "哪些", "是不是",
    "有没有", "可以", "应该", "需要", "这样", "那样",
}

# 全局/主题意图判定（纯规则，零 LLM）。全局=问整体结构/近况概览
_GLOBAL_INTENT_RE = re.compile(
    r"最近.{0,12}关注|都在.{0,8}什么|主要.{0,8}内容|有哪些.{0,6}主题|哪几块"
    r"|总结一下我的|概览|全貌|主题结构|知识体系.{0,6}(?:什么|哪些|样)"
)
# 主题词意图：「XX 领域/方面/主题/方向/专题 … 记了/有/写了 什么」
_TOPIC_RE = re.compile(
    r"[「《]?([一-龥A-Za-z0-9]{2,15})[」》]?\s*(?:个\s*)?"
    r"(?:领域|方面|主题|方向|专题|板块)\s*"
    r"(?:上|里|内|中|下)?\s*(?:我|自己)?\s*(?:都)?\s*"
    r"(?:记了|记录了|写了|存了|收藏了|看了|有)"
)
# 主题词常见前缀（「我在机器学习领域…」捕获到「在机器学习」时剥掉）
_TOPIC_PREFIX_RE = re.compile(
    r"^(?:我在|关于|对于|我的|自己|这个|那个|在|对|我|的)"
)

_TYPE_LABEL = {"note": "个人笔记", "clip": "网页剪藏", "knowledge": "知识卡片"}


def _space_cond(user_id: str, tenant_id: Optional[str]):
    """摘要行归属条件（与 tenant_scope.scope_condition 同构）：团队空间按 tenant_id
    全员共享（不限构建者），个人空间限本人且 tenant_id IS NULL。"""
    if tenant_id:
        return CommunityDigest.tenant_id == tenant_id
    return (CommunityDigest.user_id == user_id) & (CommunityDigest.tenant_id.is_(None))


# ---------------------------------------------------------------------------
# 关键词抽取（词频版 n-gram，口径对齐检索 _extract_search_keywords）
# ---------------------------------------------------------------------------

def _ngrams(text: str) -> List[str]:
    grams: List[str] = []
    for token in re.findall(r"[一-龥]+", text):
        for n in (2, 3, 4):
            for i in range(len(token) - n + 1):
                gram = token[i:i + n]
                if not any(g in _STOPWORDS for g in (gram[:2], gram[1:3]) if len(g) == 2):
                    grams.append(gram)
    for token in re.findall(r"[a-zA-Z0-9]{2,}", text):
        grams.append(token.lower())
    return grams


def top_keywords(texts: List[str], top_n: int = _KEYWORDS_N) -> List[str]:
    """文档频次排序的 top 关键词；已选词包含的短 gram 不再重复入选。"""
    df: Dict[str, int] = defaultdict(int)
    for text in texts:
        for gram in set(_ngrams(text or "")):
            df[gram] += 1
    ranked = sorted(df.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))
    picked: List[str] = []
    for gram, _ in ranked:
        if any(gram in g for g in picked):
            continue
        picked.append(gram)
        if len(picked) >= top_n:
            break
    return picked


# ---------------------------------------------------------------------------
# 聚合
# ---------------------------------------------------------------------------

def _content_meta(db: Session, content_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """内容 id → {type, title, created_at, updated_at, stage, excerpt}（active 口径）。"""
    meta: Dict[str, Dict[str, Any]] = {}
    if not content_ids:
        return meta
    for row in db.query(Note).filter(Note.id.in_(content_ids), Note.status == "active").all():
        # 仓库模式（09-19）：老图（标记前构建）可能还引用 index_only 内容，摘要层兜一道
        if getattr(row, "index_only", False):
            continue
        meta[row.id] = {
            "type": "note", "title": row.title or "无标题笔记",
            "created_at": row.created_at, "updated_at": row.updated_at,
            "stage": row.evolution_stage or "collected",
            "excerpt": (row.content or "")[:_BODY_EXCERPT],
        }
    for row in db.query(BrowserClip).filter(
            BrowserClip.id.in_(content_ids), BrowserClip.status == "active").all():
        if getattr(row, "index_only", False):  # 同上：仓库模式兜一道
            continue
        meta[row.id] = {
            "type": "clip", "title": row.title or row.url or "未命名剪藏",
            "created_at": row.created_at, "updated_at": row.updated_at,
            # clip 无进化阶段字段 → 落默认层（与端点/物理图口径一致）
            "stage": "collected",
            "excerpt": (row.excerpt or row.full_text or "")[:_BODY_EXCERPT],
        }
    for row in db.query(KnowledgeUnit).filter(
            KnowledgeUnit.id.in_(content_ids), KnowledgeUnit.status == "active").all():
        meta[row.id] = {
            "type": "knowledge", "title": row.source_title or row.content_type or "未命名知识",
            "created_at": row.created_at, "updated_at": row.updated_at,
            "stage": row.evolution_stage or "collected",
            "excerpt": (row.content_raw or "")[:_BODY_EXCERPT],
        }
    return meta


def _tag_freq(db: Session, content_ids: List[str]) -> List[Dict[str, Any]]:
    """成员内容的标签频次 top N（content_tags 直查）。"""
    if not content_ids:
        return []
    rows = (db.query(Tag.name, func.count(content_tags.c.content_id))
            .join(Tag, content_tags.c.tag_id == Tag.id)
            .filter(content_tags.c.content_id.in_(content_ids))
            .group_by(Tag.name).all())
    freq = sorted(rows, key=lambda r: (-r[1], r[0]))
    return [{"name": name, "count": cnt} for name, cnt in freq[:_TOP_TAGS_N]]


def aggregate_community(
    db: Session,
    community_id: int,
    label: Optional[str],
    members: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """单社区纯聚合摘要。members: [{node_id, label, degree, content_id?}]。

    产出 {community_id, label, size, top_tags, keywords, representatives,
    stages, time_range, text}。content_id 为空的成员是语义图 hub 概念节点：
    计入 size 与关键词语料，不进阶段/时间/标签统计。
    """
    content_ids = [m["content_id"] for m in members if m.get("content_id")]
    meta = _content_meta(db, content_ids)
    tags = _tag_freq(db, list(meta.keys()))

    texts = [str(m.get("label") or "") for m in members]
    for m in members:
        info = meta.get(m.get("content_id") or "")
        if info:
            texts.append(info["title"])
            texts.append(info["excerpt"])
    keywords = top_keywords(texts)

    # 代表条目 top3：度数最高优先，同度最新更新优先（hub 概念无时间排最后）
    def _rep_key(m):
        info = meta.get(m.get("content_id") or "") or {}
        ts = info.get("updated_at") or info.get("created_at")
        return (-(m.get("degree") or 0),
                -(ts.timestamp() if isinstance(ts, datetime) else 0))

    reps: List[Dict[str, Any]] = []
    for m in sorted(members, key=_rep_key)[:_REPS_N]:
        info = meta.get(m.get("content_id") or "")
        title = info["title"] if info else str(m.get("label") or "")
        reps.append({"title": title, "degree": m.get("degree") or 0})

    stages: Dict[str, int] = defaultdict(int)
    starts, ends = [], []
    for m in members:
        info = meta.get(m.get("content_id") or "")
        if not info:
            continue
        stages[info["stage"]] += 1
        if isinstance(info["created_at"], datetime):
            starts.append(info["created_at"])
        if isinstance(info["updated_at"], datetime):
            ends.append(info["updated_at"])
    time_range = None
    if starts or ends:
        time_range = {
            "start": min(starts).date().isoformat() if starts else None,
            "end": max(ends).date().isoformat() if ends else None,
        }

    payload = {
        "community_id": community_id,
        "label": label or f"社区 {community_id}",
        "size": len(members),
        "top_tags": tags,
        "keywords": keywords,
        "representatives": reps,
        "stages": dict(sorted(stages.items())),
        "time_range": time_range,
    }
    payload["text"] = render_digest(payload)
    return payload


def render_digest(d: Dict[str, Any]) -> str:
    """单社区摘要渲染成一行紧凑文本（chat 注入直接用）。"""
    parts = [f"社区「{d['label']}」· {d['size']} 成员"]
    if d.get("top_tags"):
        parts.append("标签: " + "、".join(f"{t['name']}({t['count']})" for t in d["top_tags"]))
    if d.get("keywords"):
        parts.append("关键词: " + "、".join(d["keywords"]))
    if d.get("representatives"):
        parts.append("代表条目: " + "、".join(f"《{r['title']}》" for r in d["representatives"]))
    if d.get("stages"):
        parts.append("阶段: " + "、".join(f"{k} {v}" for k, v in d["stages"].items()))
    tr = d.get("time_range")
    if tr and (tr.get("start") or tr.get("end")):
        parts.append(f"时间: {tr.get('start') or '?'} ~ {tr.get('end') or '?'}")
    return "；".join(parts)


# ---------------------------------------------------------------------------
# 语义社区摘要（graphify 构建收尾整删整插）
# ---------------------------------------------------------------------------

def _node_degrees(links: List[Dict[str, Any]]) -> Dict[str, int]:
    degree: Dict[str, int] = defaultdict(int)
    for l in links:
        s, t = str(l.get("source")), str(l.get("target"))
        if s != t:
            degree[s] += 1
            degree[t] += 1
    return degree


def build_semantic_digests(db: Session, user_id: str, tenant_id: Optional[str] = None) -> Optional[Dict[str, int]]:
    """从当前构建产物聚合语义社区摘要并整删整插入库（幂等）。

    返回 {"communities": n}；无构建产物返回 None（调用方 404）。
    失败必须抛出（同 rebuild_semantic_layout：DELETE 挂在事务里，失败回滚）。
    空间口径：tenant_id 非空=团队空间（整删整插只动本空间的行，打 tenant_id 戳）。
    """
    from app.services import graphify_service as gfs

    graph = gfs.load_graph(user_id, tenant_id=tenant_id)
    if not graph:
        return None
    labels = gfs.load_community_labels(user_id, tenant_id=tenant_id)
    nodes = graph.get("nodes", [])
    degree = _node_degrees(graph.get("links", []))

    by_comm: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for node in nodes:
        cid = node.get("community")
        if cid is None or node.get("id") is None:
            continue
        src = gfs.parse_source_from_node(node)
        by_comm[int(cid)].append({
            "node_id": str(node.get("id")),
            "label": node.get("label"),
            "degree": degree.get(str(node.get("id")), 0),
            "content_id": src["id"] if src else None,
        })

    digests = [
        aggregate_community(db, cid, labels.get(str(cid)), members)
        for cid, members in sorted(by_comm.items())
    ]
    try:
        db.query(CommunityDigest).filter(
            _space_cond(user_id, tenant_id),
            CommunityDigest.graph_source == "semantic",
        ).delete(synchronize_session=False)
        for d in digests:
            db.add(CommunityDigest(
                id=str(uuid.uuid4()), user_id=user_id, tenant_id=tenant_id,
                graph_source="semantic",
                community_id=d["community_id"], label=d["label"], size=d["size"],
                text=d["text"], payload=json.dumps(d, ensure_ascii=False),
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("community digest rebuild failed user=%s", user_id, exc_info=True)
        raise
    return {"communities": len(digests)}


# ---------------------------------------------------------------------------
# 物理社区摘要（连通分量，懒刷新 + 内容指纹判陈旧）
# ---------------------------------------------------------------------------

def _physical_fingerprint(db: Session, user_id: str, tenant_id: Optional[str] = None) -> str:
    """内容指纹：三表 active 条数 + 最新更新时间；变了说明摘要该重算。
    空间口径：团队空间数全团内容（tenant_id=T），个人空间只数本人个人行。"""
    parts = []
    for model in (Note, BrowserClip, KnowledgeUnit):
        cond = (model.tenant_id == tenant_id) if tenant_id else (
            (model.user_id == user_id) & (model.tenant_id.is_(None)))
        cnt, mx = db.query(func.count(model.id), func.max(model.updated_at)).filter(
            cond, model.status == "active",
        ).one()
        # sqlite 的 MAX() 可能直接回字符串，两种形态都原样进指纹（变了即重算）
        parts.append(f"{cnt or 0}:{mx.isoformat() if isinstance(mx, datetime) else str(mx or '')}")
    return "|".join(parts)


def build_physical_digests(db: Session, user_id: str, tenant_id: Optional[str] = None) -> Dict[str, int]:
    """开源版无 physical_graph_service（剥离面）：物理图摘要不可用，空结果。"""
    return {}


def ensure_physical_digests(db: Session, user_id: str, tenant_id: Optional[str] = None) -> None:
    """开源版无 physical_graph_service（剥离面）：空操作。"""
    return


# ---------------------------------------------------------------------------
# 读取 + 意图路由（chat 集成）
# ---------------------------------------------------------------------------

def load_digests(db: Session, user_id: str, graph_source: str,
                 tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """读库还原结构化摘要（按成员数降序）。按空间读取，对面空间摘要不混入。"""
    rows = db.query(CommunityDigest).filter(
        _space_cond(user_id, tenant_id),
        CommunityDigest.graph_source == graph_source,
    ).all()
    out = []
    for row in rows:
        try:
            d = json.loads(row.payload) if row.payload else {}
        except (json.JSONDecodeError, TypeError):
            d = {}
        d.setdefault("community_id", row.community_id)
        d.setdefault("label", row.label or f"社区 {row.community_id}")
        d.setdefault("size", row.size or 0)
        d.setdefault("text", row.text or "")
        out.append(d)
    out.sort(key=lambda d: (-d["size"], d["community_id"]))
    return out


def is_global_intent(message: str) -> bool:
    """全局/概览意图：「最近都在关注什么」「库里主要有哪几块内容」「概览/全貌」等。"""
    return bool(_GLOBAL_INTENT_RE.search(message or ""))


def extract_topic_term(message: str) -> Optional[str]:
    """主题词意图：「XX 领域/方面/主题…我记了什么」→ 剥前缀后的主题词。"""
    m = _TOPIC_RE.search(message or "")
    if not m:
        return None
    term = m.group(1)
    for _ in range(3):
        stripped = _TOPIC_PREFIX_RE.sub("", term)
        if stripped == term or len(stripped) < 2:
            break
        term = stripped
    return term if len(term) >= 2 else None


def match_topic_digests(term: str, digests: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """主题词命中社区 label / top 标签 / 关键词（双向子串，词长≥2）。"""
    def hit(d: Dict[str, Any]) -> bool:
        haystacks = [str(d.get("label") or "")]
        haystacks += [str(t.get("name") or "") for t in d.get("top_tags") or []]
        haystacks += [str(k) for k in d.get("keywords") or []]
        for h in haystacks:
            if not h:
                continue
            if term in h or (len(h) >= 2 and h in term):
                return True
        return False

    return [d for d in digests if hit(d)][:TOPIC_MAX_COMMUNITIES]


def overview_text(digests: List[Dict[str, Any]], max_chars: int = OVERVIEW_MAX_CHARS) -> str:
    """全局概览：按成员数降序逐社区一行，总长压进 max_chars（至少保留 1 个）。"""
    lines: List[str] = []
    total = 0
    for d in digests:
        line = d.get("text") or render_digest(d)
        if lines and total + len(line) + 1 > max_chars:
            break
        lines.append(line)
        total += len(line) + 1
    return "\n".join(lines)


def digest_context_for_chat(db: Session, user_id: str, message: str,
                            tenant=None) -> Optional[str]:
    """chat 注入主入口：按意图返回完整「社区摘要区」文本块，不命中返回 None。

    全局意图 → top 社区概览；主题词意图 → 只给命中社区。语义摘要优先，
    未构建语义图时回退物理摘要（懒刷新）。无单一来源 id，不进 sources。
    空间口径：tenant 非空只读团队空间摘要，空只读个人空间——双空间各存各的，
    提示词不吃对面空间的摘要（跨空间泄漏曾是提示词级的，检索层挡不住）。
    """
    tenant_id = tenant.id if tenant else None
    msg = (message or "").strip()
    if not msg:
        return None
    global_hit = is_global_intent(msg)
    term = None if global_hit else extract_topic_term(msg)
    if not global_hit and not term:
        return None

    digests = load_digests(db, user_id, "semantic", tenant_id)
    if not digests:
        try:
            ensure_physical_digests(db, user_id, tenant_id)
        except Exception as e:
            logger.warning("物理社区摘要懒刷新失败（降级无摘要）user=%s: %s", user_id, e)
        digests = load_digests(db, user_id, "physical", tenant_id)
    if not digests:
        return None

    if global_hit:
        body = overview_text(digests)
        if not body:
            return None
        return (
            "【社区摘要：以下是你知识库的主题结构概览（来自数据库聚合，非模型记忆），"
            "回答「关注什么/主要内容/全貌」这类全局问题以此为准；具体条目引用仍以"
            "「参考资料」区为准，本区内容不得用 [n] 脚注引用】\n" + body
        )
    matched = match_topic_digests(term, digests)
    if not matched:
        return None
    return (
        "【社区摘要：以下是与提问主题相关的社区结构摘要（来自数据库聚合），"
        "供把握该主题全貌；具体条目引用仍以「参考资料」区为准，"
        "本区内容不得用 [n] 脚注引用】\n"
        + "\n".join(d.get("text") or render_digest(d) for d in matched)
    )
