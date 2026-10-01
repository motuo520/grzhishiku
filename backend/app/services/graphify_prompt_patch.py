"""graphify 抽取 prompt 语言补丁（唯一事实源）。

为什么存在：graphifyy 0.9.16 的 _EXTRACTION_SYSTEM 是全英文、面向代码库的抽取
提示，label 无「保持源语言」指令——中文语料必出英文标签（08-20 双跑实证：同 4
篇中文笔记，未补丁 28 节点 0 中文 label，补丁后 27/27 中文，边数 17→21 还更多）。

两个补丁点：
1. 节点/边抽取：给 _EXTRACTION_SYSTEM 追加 LANG_SUFFIX。
2. 社区命名：_label_batch_with_retry 的 prompt 是同函数内联串（全英文、无语言
   规则，且每次构建全量重命名），无法追加常量——包一层模块级 _call_llm，命中
   命名 prompt 特征串时插入 LABEL_LANG_SUFFIX。命名函数及其递归都走模块全局
   解析 _call_llm，包模块属性即全覆盖。
3. 谓词收敛：_EXTRACTION_SYSTEM 的 relation 枚举替换为 12 谓词（事实源
   graph_predicates.PREDICATES），并追加「只能从清单选」规则。实证痛点：真实库
   302 边 294 条 conceptually_related_to（97% 万能词零信息量）。

使用方式：graphify CLI 在**子进程**里跑（源码模式 python 调 wrapper 脚本
graphify_cli.py；frozen 模式 desktop_entry 的 -m graphify 转发分支），两个入口
都在委托官方 CLI 前调用 apply()。

升级 graphifyy 时必须复查本补丁点：若上游提供了官方语言参数，退役本模块。
（补丁 2 依赖命名 prompt 的特征串，上游改文案会静默失配——复查时核对
_LABEL_PROMPT_MARK/_LABEL_PROMPT_ANCHOR 仍在 _label_batch_with_retry 里；
补丁 3 依赖 :437 枚举串精确文本，失配即抛错不静默。）
"""

LANG_SUFFIX = (
    "\nLANGUAGE RULE: Write all human-readable text (node labels, hyperedge labels) "
    "in the dominant language of the source content. Chinese source content MUST produce "
    "Chinese labels with verbatim Chinese concepts (e.g. 道德义务论, 绝对命令) — do NOT "
    "translate them to English. Node IDs stay ASCII per the format rules above.\n"
)

# 社区命名 prompt 的语言规则（graphifyy 0.9.16 该 prompt 全英文且无语言指令，
# 中文语料的社区名会随模型口味漂成英文）。
LABEL_LANG_SUFFIX = (
    "\nLANGUAGE RULE: Write each community name in the dominant language of its "
    "member labels below. Chinese members MUST get a Chinese name "
    '(e.g. "道德哲学", "支付流程") — do NOT translate to English. '
    "Names stay concise (2-5 words).\n"
)

# 0.9.16 _label_batch_with_retry 内联 prompt 的特征串/插入锚点
_LABEL_PROMPT_MARK = "You are naming clusters in a knowledge graph."
_LABEL_PROMPT_ANCHOR = "no prose, no markdown fences."

# 0.9.16 _EXTRACTION_SYSTEM（graphify/llm.py:437）JSON 模板里的谓词枚举精确文本
_EDGE_ENUM_OLD = (
    "calls|implements|references|cites|conceptually_related_to|"
    "shares_data_with|semantically_similar_to"
)
_PREDICATE_RULE_MARK = "PREDICATE RULE"

PREDICATE_RULE_SUFFIX = (
    "\nPREDICATE RULE: The edge relation MUST be exactly one of the predicates listed "
    "in the schema above. Choose the MOST SPECIFIC predicate that applies; use "
    "related_to only when no other predicate fits. Never invent new relation words, "
    "and never use conceptually_related_to or semantically_similar_to — use "
    "related_to instead.\n"
)


def _patch_predicates(_llm) -> None:
    """替换抽取 prompt 的 relation 枚举为 12 谓词 + 追加选择规则（幂等，失配抛错）。"""
    if _PREDICATE_RULE_MARK in _llm._EXTRACTION_SYSTEM:
        return
    if _EDGE_ENUM_OLD not in _llm._EXTRACTION_SYSTEM:
        raise RuntimeError(
            "graphify 抽取 prompt 的 relation 枚举失配（库升级？）——谓词 patch 未应用，"
            "请复查 graphify_prompt_patch._EDGE_ENUM_OLD 与上游 _EXTRACTION_SYSTEM"
        )
    from app.services.graph_predicates import PREDICATES

    _llm._EXTRACTION_SYSTEM = _llm._EXTRACTION_SYSTEM.replace(
        _EDGE_ENUM_OLD, "|".join(PREDICATES.keys()), 1
    )
    _llm._EXTRACTION_SYSTEM += PREDICATE_RULE_SUFFIX


def _patch_community_labeling(_llm) -> None:
    """包 _llm._call_llm：命中社区命名 prompt 时在指令尾部插入语言规则（幂等）。"""
    current = _llm._call_llm
    if getattr(current, "_qianji_label_lang", False):
        return

    def _call_llm_with_label_lang(prompt, *args, **kwargs):
        if (
            isinstance(prompt, str)
            and prompt.startswith(_LABEL_PROMPT_MARK)
            and _LABEL_PROMPT_ANCHOR in prompt
            and "LANGUAGE RULE" not in prompt
        ):
            prompt = prompt.replace(
                _LABEL_PROMPT_ANCHOR, _LABEL_PROMPT_ANCHOR + LABEL_LANG_SUFFIX, 1
            )
        return current(prompt, *args, **kwargs)

    _call_llm_with_label_lang._qianji_label_lang = True
    _call_llm_with_label_lang._orig = current  # 测试可顺此脱壳
    _llm._call_llm = _call_llm_with_label_lang


def apply() -> None:
    """给 graphify 的抽取/社区命名提示追加源语言规则（幂等）。"""
    try:
        import graphify.llm as _llm
    except ImportError:  # graphify 不在环境里（纯 API 部署形态）时静默跳过
        return
    if "LANGUAGE RULE" not in _llm._EXTRACTION_SYSTEM:
        _llm._EXTRACTION_SYSTEM += LANG_SUFFIX
    _patch_predicates(_llm)
    _patch_community_labeling(_llm)
