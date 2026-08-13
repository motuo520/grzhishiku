"""XSS sanitization utilities for user-generated content."""

import bleach
import re
from typing import Optional

# Allowed tags for rich content (if any markdown/HTML is rendered)
ALLOWED_TAGS = set()
ALLOWED_ATTRIBUTES = {}

# Basic HTML escape for plain text storage
import html


def sanitize_html(text: Optional[str], allow_tags: Optional[list] = None) -> Optional[str]:
    """Sanitize HTML content using bleach, removing all non-allowed tags."""
    if text is None:
        return None
    tags = set(allow_tags) if allow_tags else ALLOWED_TAGS
    return bleach.clean(text, tags=tags, attributes=ALLOWED_ATTRIBUTES, strip=True)


def sanitize_markdown(text: Optional[str]) -> Optional[str]:
    """Sanitize markdown content: escape HTML tags but preserve markdown syntax."""
    if text is None:
        return None
    # 全量 HTML 转义，不做任何还原：曾把 &lt;!-- 还原回 <!--，但 markdown
    # 渲染会透传裸 HTML 注释，攻击者可注入未闭合注释吞掉页面后续内容
    return html.escape(text)


def sanitize_url(url: Optional[str]) -> Optional[str]:
    """Sanitize URL to prevent javascript: and data: protocol XSS."""
    if url is None:
        return None
    url = url.strip()
    dangerous_protocols = re.compile(r'^(javascript|data|vbscript|file):', re.IGNORECASE)
    if dangerous_protocols.match(url):
        return "about:blank"
    return url


def sanitize_note_input(title: Optional[str], content: Optional[str]) -> tuple:
    """Sanitize note input fields."""
    return sanitize_markdown(title), sanitize_markdown(content)


def sanitize_clip_input(title: Optional[str], excerpt: Optional[str], full_text: Optional[str], url: Optional[str]) -> tuple:
    """Sanitize clip input fields."""
    return (
        sanitize_markdown(title),
        sanitize_markdown(excerpt),
        sanitize_markdown(full_text),
        sanitize_url(url)
    )


def sanitize_knowledge_input(content: Optional[str], source_url: Optional[str], source_title: Optional[str]) -> tuple:
    """Sanitize knowledge unit input fields."""
    return (
        sanitize_markdown(content),
        sanitize_url(source_url),
        sanitize_html(source_title)
    )


def sanitize_capsule_input(content_body: Optional[str], mood_tags: Optional[list] = None) -> tuple:
    """Sanitize capsule input fields."""
    safe_tags = [sanitize_markdown(tag) for tag in (mood_tags or [])]
    return sanitize_markdown(content_body), safe_tags


def sanitize_support_input(subject: Optional[str], description: Optional[str]) -> tuple:
    """Sanitize support ticket input fields."""
    return sanitize_html(subject), sanitize_markdown(description)
