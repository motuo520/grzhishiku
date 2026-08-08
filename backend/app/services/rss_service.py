"""RSS 源刷新服务：端点手动拉取与定时扫班（rss_scheduler）共用。

- fetch/parse 辅助函数原在 endpoints/rss.py，为供调度器复用移至本模块
- refresh_feed：拉取 → 解析 → 按 external_id 去重入库；失败写好
  fetch_status/fetch_error 后重抛（端点转 400，调度器记日志继续）
- 自动刷新配置存 user.settings["rss_auto"][feed_id]，不动表结构
"""
import json
import re
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.base import User, RssFeed, RssEntry

AUTO_FETCH_INTERVALS = {30, 60, 360, 1440}


def _extract_domain(url: str) -> str:
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain or url
    except Exception:
        return url


def fetch_feed_xml(url: str) -> str:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "")
            data = response.read()
    except urllib.error.HTTPError as e:
        status = e.code
        if status == 404:
            raise RuntimeError("地址返回 404，请确认 RSS 链接有效") from e
        raise RuntimeError(f"HTTP 错误 {status}，无法访问该地址") from e
    except urllib.error.URLError as e:
        reason = str(e.reason)
        lowered = reason.lower()
        if "timed out" in lowered or "timeout" in lowered:
            raise RuntimeError("请求超时，请检查网络或稍后重试") from e
        if "no host given" in lowered or "name or service not known" in lowered:
            raise RuntimeError("域名解析失败，请检查 URL") from e
        if "ssl" in lowered:
            raise RuntimeError("SSL 证书错误") from e
        raise RuntimeError(f"无法访问该地址：{reason}") from e
    except Exception as e:
        raise RuntimeError(f"请求失败：{e}") from e

    # Basic sanity check: valid RSS/Atom should start with '<' and ideally be XML
    if not data.strip().startswith(b"<"):
        raise ValueError("该地址返回的内容不是有效的 RSS/XML 格式")
    if "xml" not in content_type.lower() and b"<rss" not in data.lower() and b"<feed" not in data.lower():
        raise ValueError("该地址返回的内容不是有效的 RSS/XML 格式")

    try:
        return data.decode("utf-8", errors="ignore")
    except Exception as e:
        raise RuntimeError(f"无法解析返回内容：{e}") from e


def parse_feed(xml: str, feed_id: str, user_id: str):
    """Parse RSS/Atom XML and return (feed_info, entries)."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise ValueError("该地址返回的内容不是有效的 RSS/XML 格式") from e
    ns = {"atom": "http://www.w3.org/2005/Atom", "content": "http://purl.org/rss/1.0/modules/content/"}

    feed_info = {"title": None, "description": None, "site_url": None, "language": None}
    entries = []

    tag = root.tag.lower()
    if "feed" in tag:  # Atom
        channel = root
        feed_info["title"] = channel.findtext("atom:title", default=None, namespaces=ns)
        feed_info["description"] = channel.findtext("atom:subtitle", default=None, namespaces=ns)
        link_el = channel.find("atom:link", namespaces=ns)
        if link_el is not None:
            feed_info["site_url"] = link_el.get("href")

        for entry in root.findall("atom:entry", namespaces=ns):
            title = entry.findtext("atom:title", default="无标题", namespaces=ns)
            link = ""
            link_el = entry.find("atom:link", namespaces=ns)
            if link_el is not None:
                link = link_el.get("href", "")
            summary = entry.findtext("atom:summary", default=None, namespaces=ns) or entry.findtext("atom:content", default=None, namespaces=ns)
            author = entry.findtext("atom:author/atom:name", default=None, namespaces=ns)
            published = entry.findtext("atom:published", default=None, namespaces=ns) or entry.findtext("atom:updated", default=None, namespaces=ns)
            external_id = entry.findtext("atom:id", default=None, namespaces=ns) or link
            entries.append({
                "title": re.sub(r"\s+", " ", title).strip() if title else "无标题",
                "link": link,
                "summary": re.sub(r"\s+", " ", summary).strip() if summary else None,
                "author": author,
                "published_at": published,
                "external_id": external_id,
            })
    else:  # RSS 2.0 / RDF
        channel = root.find("channel")
        if channel is not None:
            feed_info["title"] = channel.findtext("title", default=None)
            feed_info["description"] = channel.findtext("description", default=None)
            feed_info["site_url"] = channel.findtext("link", default=None)
            feed_info["language"] = channel.findtext("language", default=None)

            for item in channel.findall("item"):
                title = item.findtext("title", default="无标题")
                link = item.findtext("link", default="")
                summary = item.findtext("description", default=None)
                author = item.findtext("author", default=None) or item.findtext("{http://purl.org/dc/elements/1.1/}creator", default=None)
                published = item.findtext("pubDate", default=None)
                external_id = item.findtext("guid", default=None) or link
                entries.append({
                    "title": re.sub(r"\s+", " ", title).strip() if title else "无标题",
                    "link": link,
                    "summary": re.sub(r"\s+", " ", summary).strip() if summary else None,
                    "author": author,
                    "published_at": published,
                    "external_id": external_id,
                })

    return feed_info, entries


def parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    # Try common formats
    formats = [
        "%a, %d %b %Y %H:%M:%S %Z",
        "%a, %d %b %Y %H:%M:%S %z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def refresh_feed(db: Session, feed: RssFeed, user_id: str) -> Dict[str, int]:
    """拉取并入库新条目，返回 {"added", "total_parsed"}。失败写好 fetch_status/fetch_error 后重抛。"""
    try:
        xml = fetch_feed_xml(feed.url)
        feed_info, entries = parse_feed(xml, feed.id, user_id)

        # Update feed info
        if not feed.title and feed_info.get("title"):
            feed.title = feed_info["title"]
        if not feed.description and feed_info.get("description"):
            feed.description = feed_info["description"]
        if not feed.site_url and feed_info.get("site_url"):
            feed.site_url = feed_info["site_url"]
        if not feed.language and feed_info.get("language"):
            feed.language = feed_info["language"]
        feed.fetch_status = "success"
        feed.fetch_error = None
        feed.last_fetched_at = datetime.now()

        added = 0
        for entry_data in entries:
            external_id = entry_data.get("external_id") or entry_data["link"]
            if not external_id:
                continue
            existing = db.query(RssEntry).filter(
                RssEntry.feed_id == feed.id,
                RssEntry.external_id == external_id,
            ).first()
            if existing:
                continue
            new_entry = RssEntry(
                id=str(uuid.uuid4()),
                feed_id=feed.id,
                user_id=user_id,
                title=entry_data.get("title"),
                link=entry_data.get("link"),
                summary=entry_data.get("summary"),
                author=entry_data.get("author"),
                published_at=parse_datetime(entry_data.get("published_at")),
                external_id=external_id,
            )
            db.add(new_entry)
            added += 1

        db.commit()
        return {"added": added, "total_parsed": len(entries)}
    except Exception as e:
        error_msg = str(e) or "拉取失败，请稍后重试"
        feed.fetch_status = "error"
        feed.fetch_error = error_msg
        feed.last_fetched_at = datetime.now()
        db.commit()
        raise


# ── 自动刷新配置（user.settings["rss_auto"][feed_id]） ──

def _load_settings(user: User) -> Dict[str, Any]:
    try:
        return json.loads(user.settings or "{}")
    except json.JSONDecodeError:
        return {}


def get_auto_fetch_config(user: User, feed_id: str) -> Dict[str, Any]:
    cfg = (_load_settings(user).get("rss_auto") or {}).get(feed_id) or {}
    return {
        "enabled": bool(cfg.get("enabled")),
        "interval_minutes": int(cfg.get("interval_minutes") or 60),
    }


def set_auto_fetch_config(user: User, feed_id: str, enabled: bool, interval_minutes: int, db: Session) -> Dict[str, Any]:
    settings_data = _load_settings(user)
    auto = dict(settings_data.get("rss_auto") or {})
    auto[feed_id] = {"enabled": enabled, "interval_minutes": interval_minutes}
    settings_data["rss_auto"] = auto
    user.settings = json.dumps(settings_data, ensure_ascii=False)
    db.commit()
    db.refresh(user)
    return get_auto_fetch_config(user, feed_id)


def iter_auto_fetch_feeds(db: Session):
    """产出 (feed, user_id, interval_minutes)：所有启用自动刷新的存活源。"""
    feeds = db.query(RssFeed).filter(RssFeed.status == "active").all()
    for feed in feeds:
        user = db.query(User).filter(User.id == feed.user_id).first()
        if not user:
            continue
        cfg = get_auto_fetch_config(user, feed.id)
        if cfg["enabled"]:
            yield feed, feed.user_id, cfg["interval_minutes"]
