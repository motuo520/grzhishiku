"""图谱关系谓词收敛（本体 schema 层，唯一事实源）。

为什么存在：graphify 抽取的边关系是 LLM 自由发挥的英文 snake_case，实证漂移
严重——真实库 302 条边 294 条是 conceptually_related_to（97% 万能词零信息量），
_RAG via 三元组/路径探索/图谱报告全被稀释。收敛到一个 12 词谓词集：

- 抽取侧：graphify_prompt_patch 把库 prompt 的 relation 枚举替换为本表，
  并追加「只能从清单选，拿不准用 related_to」规则；
- 存量侧：normalize_graph_relations.py 用 LEGACY_MAP 离线重写旧词（零 LLM 成本）；
- 展示侧：llm.py 的 _RELATION_ZH 从本模块构建（诚信线不变——只翻译不推断，
  未收录旧词保留原文）。

规范形一律英文 snake_case 存库（与存量数据形态一致），中文只活在展示层。
"""

import re
from typing import Optional

# graph_edges.context 内嵌关系词的格式（'graphify 语义关联：X（CONF）·经概念…'），
# 写入方 graphify_service.sync_edges_from_build 与所有解析方共用这一个正则。
GRAPHIFY_RELATION_RE = re.compile(r"graphify 语义关联：([^（·]+)")

# 13 谓词 → 中文（顺序即 prompt 枚举顺序，related_to 兜底永远在最后；
# contains 是 09-10 重抽实证加的第 13 个：模型对包含关系的需求极强，1000/1244 边自发出）
PREDICATES = {
    "is_a": "是一种",
    "part_of": "属于",
    "causes": "导致",
    "supports": "支持",
    "contradicts": "矛盾",
    "depends_on": "依赖于",
    "derives_from": "源自",
    "applies_to": "应用于",
    "extends": "扩展",
    "contains": "包含",
    "compares_with": "对比",
    "references": "引用",
    "related_to": "相关",
}

FALLBACK = "related_to"

# 传递安全谓词（本体推理层）：A is_a B ∧ B is_a C ⇒ A is_a C 成立；
# contains 同理（A 包含 B ∧ B 包含 C ⇒ A 包含 C）——09-10 保守期挂起，09-13 激活：
# 重抽实证里 contains 是模型自发用得最多的谓词（73% 边），不进传递集推理层无边可走。
# causes/supports 等传递不保真，永不进此表。图谱扩展沿这些边走多跳。
TRANSITIVE_PREDICATES = {"is_a", "part_of", "contains"}

# 已见旧词 → 新谓词（仅收方向安全、语义可对应的映射；方向相反或语义对不上的
# 旧词不进此表，走 LEGACY_ZH 只做展示翻译，存量迁移时一并归 FALLBACK）。
LEGACY_MAP = {
    "conceptually_related_to": "related_to",
    "semantically_similar_to": "related_to",
    "related": "related_to",
    "co_occurs_with": "related_to",
    "same_topic_as": "related_to",
    "contrasts_with": "compares_with",
    "mentions": "references",
    "cites": "references",
    "introduces": "references",
    "discusses": "references",
    "exemplifies": "is_a",
    "complements": "supports",
    "uses": "applies_to",
}

# 旧词展示翻译（未迁移数据的中文化兜底；不进 LEGACY_MAP 的词在此保留原译，
# 诚信线：翻译不是推断——词义方向拿不准的绝不硬塞进谓词表）。
LEGACY_ZH = {
    "summarizes": "总结",
    "defines": "定义",
    "prerequisite_of": "前置",
    "evaluates": "评价",
    "influences": "影响",
    "categorizes": "归类",
    "describes": "描述",
    "explains": "解释",
    "reviews": "回顾",
}


def normalize_relation(raw: str) -> str:
    """归一化到谓词表：已是谓词原样返回；旧词按 LEGACY_MAP 映射；其余兜底。"""
    r = (raw or "").strip().lower()
    if r in PREDICATES:
        return r
    return LEGACY_MAP.get(r, FALLBACK)


def relation_zh(raw: str) -> str:
    """展示翻译：谓词查 PREDICATES；旧词优先按映射后谓词译，其次 LEGACY_ZH 原译；
    都不认识保留原文（诚信线：不编造关系）。"""
    r = (raw or "").strip().lower()
    if not r:
        return PREDICATES[FALLBACK]
    if r in PREDICATES:
        return PREDICATES[r]
    if r in LEGACY_MAP:
        return PREDICATES[LEGACY_MAP[r]]
    return LEGACY_ZH.get(r, (raw or "").strip())


def build_zh_table() -> dict:
    """llm.py 的 _RELATION_ZH 等价物：谓词 + 旧词映射 + 旧词原译，一张合并表。"""
    table = dict(PREDICATES)
    for old, new in LEGACY_MAP.items():
        table[old] = PREDICATES[new]
    table.update(LEGACY_ZH)
    return table


def edge_predicate(edge_type: str, context: str) -> Optional[str]:
    """graphify 边解析谓词（归一化到谓词表）；非 graphify 边/无关系词返回 None。"""
    if edge_type != "graphify":
        return None
    m = GRAPHIFY_RELATION_RE.search(context or "")
    return normalize_relation(m.group(1)) if m else None


def rewrite_context(context: str) -> str:
    """重写 graph_edges.context 内嵌的关系词（'graphify 语义关联：X（CONF）·经概念…'
    形态），只换 X，置信度/经概念段原样保留。幂等。"""
    if not context:
        return context
    m = GRAPHIFY_RELATION_RE.search(context)
    if not m:
        return context
    old = m.group(1).strip()
    new = normalize_relation(old)
    if new == old:
        return context
    return context[: m.start(1)] + new + context[m.end(1) :]
