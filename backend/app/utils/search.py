"""中文长句搜索兜底：整串子串匹配之外按 2-gram 命中比例匹配（BUG-N01）。

中文没有空格分词，用户拿整句（如「劳动合同纠纷的赔偿标准」）搜库时，
整串 ilike 很难命中。这里对「长度 >= 4 且无空格」的查询串额外按 bigram
拆分，某条记录命中的 bigram 比例 >= BIGRAM_MIN_RATIO 也算匹配。
纯 SQLAlchemy 表达式（CASE WHEN 求和），不引入新依赖。
"""

import math
from typing import List

from sqlalchemy import case, or_
from sqlalchemy.sql.elements import ColumnElement

# 触发 bigram 兜底的最小查询长度（短词整串匹配足够，bigram 噪声大）
BIGRAM_MIN_QUERY_LEN = 4
# 命中 bigram 比例阈值：>= 60% 视为相关
BIGRAM_MIN_RATIO = 0.6


def chinese_bigrams(q: str) -> List[str]:
    """把查询串拆成 2-gram 列表；不适用（过短/含空格）时返回空列表。"""
    q = (q or "").strip()
    if len(q) < BIGRAM_MIN_QUERY_LEN or any(ch.isspace() for ch in q):
        return []
    return [q[i:i + 2] for i in range(len(q) - 1)]


def build_search_filter(q: str, *columns: ColumnElement) -> ColumnElement:
    """构造搜索过滤条件：整串 ilike 任一列命中，或 bigram 命中比例达标。

    columns 为参与匹配的列（如 Note.title, Note.content）。
    """
    search = f"%{q}%"
    whole_match = or_(*[col.ilike(search) for col in columns])

    bigrams = chinese_bigrams(q)
    if not bigrams:
        return whole_match

    threshold = math.ceil(len(bigrams) * BIGRAM_MIN_RATIO)
    hit_count = None
    for gram in bigrams:
        gram_hit = or_(*[col.ilike(f"%{gram}%") for col in columns])
        hit = case((gram_hit, 1), else_=0)
        hit_count = hit if hit_count is None else hit_count + hit
    return or_(whole_match, hit_count >= threshold)
