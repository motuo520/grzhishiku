"""Simple heuristic spam filter for community posts."""

import re

# Keywords and phrases commonly associated with spam in Chinese communities.
_SPAM_KEYWORDS = [
    "刷单", "兼职刷单", "加微信", "加群", "加qq", "加Q", "微信", "微信号",
    "免费领", "免费送", "免费领取", "优惠券", "折扣群", "薅羊毛", "羊毛群",
    "博彩", "赌球", "赌博", "彩票", "六合彩", "外围", "色情", "约炮", "裸聊",
    "赚钱加", "日赚", "月入过万", "轻松赚钱", "在家兼职", "点击链接", "网址",
    "贷款", "代办", "黑户", "套现", "征信修复", "学历提升", "论文代写",
]

_SPAM_PATTERNS = [
    re.compile(r"(微信|QQ|qq|V|v)[\s:：]*[\da-zA-Z]{5,}"),
    re.compile(r"[\da-zA-Z]{6,}[@.]\w+\.\w+"),  # simple email-ish / url-ish tokens
    re.compile(r"https?://\S+"),
    re.compile(r"\b(www\.|\.com|\.cn|\.net|\.org)\b", re.IGNORECASE),
]


def is_spam(text: str) -> bool:
    """Return True if the text looks like spam."""
    if not text:
        return False

    lower = text.lower()

    for keyword in _SPAM_KEYWORDS:
        if keyword in lower:
            return True

    for pattern in _SPAM_PATTERNS:
        if pattern.search(text):
            return True

    # Heuristic: too many non-Chinese links/contact markers
    if len(re.findall(r"[\da-zA-Z]{6,}", text)) >= 5:
        return True

    return False
