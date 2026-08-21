"""graphify 抽取 prompt 语言补丁（唯一事实源）。

为什么存在：graphifyy 0.9.16 的 _EXTRACTION_SYSTEM 是全英文、面向代码库的抽取
提示，label 无「保持源语言」指令——中文语料必出英文标签（08-20 双跑实证：同 4
篇中文笔记，未补丁 28 节点 0 中文 label，补丁后 27/27 中文，边数 17→21 还更多）。

使用方式：graphify CLI 在**子进程**里跑（源码模式 python 调 wrapper 脚本
graphify_cli.py；frozen 模式 desktop_entry 的 -m graphify 转发分支），两个入口
都在委托官方 CLI 前调用 apply()。

升级 graphifyy 时必须复查本补丁点：若上游提供了官方语言参数，退役本模块。
"""

LANG_SUFFIX = (
    "\nLANGUAGE RULE: Write all human-readable text (node labels, hyperedge labels) "
    "in the dominant language of the source content. Chinese source content MUST produce "
    "Chinese labels with verbatim Chinese concepts (e.g. 道德义务论, 绝对命令) — do NOT "
    "translate them to English. Node IDs stay ASCII per the format rules above.\n"
)


def apply() -> None:
    """给 graphify 的抽取系统提示追加源语言规则（幂等）。"""
    try:
        import graphify.llm as _llm
    except ImportError:  # graphify 不在环境里（纯 API 部署形态）时静默跳过
        return
    if "LANGUAGE RULE" not in _llm._EXTRACTION_SYSTEM:
        _llm._EXTRACTION_SYSTEM += LANG_SUFFIX
