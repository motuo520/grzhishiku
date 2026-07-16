from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import re

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, RssFeed, RssEntry, BrowserClip

router = APIRouter()


class FeedCreate(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    title: Optional[str] = Field(None, max_length=200)


class FeedUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    status: Optional[str] = Field(None, pattern="^(active|paused|deleted)$")


class FeedResponse(BaseModel):
    id: str
    user_id: str
    title: Optional[str]
    url: str
    description: Optional[str]
    site_url: Optional[str]
    fetch_status: str
    fetch_error: Optional[str]
    last_fetched_at: Optional[datetime]
    status: str
    created_at: datetime
    updated_at: datetime
    unread_count: int = 0

    class Config:
        from_attributes = True


class EntryResponse(BaseModel):
    id: str
    feed_id: str
    title: Optional[str]
    link: str
    summary: Optional[str]
    author: Optional[str]
    published_at: Optional[datetime]
    is_read: bool
    is_saved: bool
    external_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class SaveEntryRequest(BaseModel):
    as_clip: bool = True


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


def _fetch_feed_xml(url: str) -> str:
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


def _parse_feed(xml: str, feed_id: str, user_id: str):
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


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
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


@router.get("/sources", response_model=List[FeedResponse], summary="List RSS feeds", description="Get all RSS feeds for the current user.")
async def list_feeds(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feeds = db.query(RssFeed).filter(
        RssFeed.user_id == current_user.id,
        RssFeed.status != "deleted"
    ).order_by(RssFeed.created_at.desc()).all()
    
    result = []
    for feed in feeds:
        unread = db.query(RssEntry).filter(
            RssEntry.feed_id == feed.id,
            RssEntry.user_id == current_user.id,
            RssEntry.is_read == False,
            RssEntry.status == "active",
        ).count()
        data = FeedResponse.model_validate(feed).model_dump()
        data["unread_count"] = unread
        result.append(FeedResponse(**data))
    return result


@router.post("/sources", response_model=FeedResponse, status_code=status.HTTP_201_CREATED, summary="Create RSS feed", description="Add a new RSS feed and validate by fetching it once.")
async def create_feed(
    feed_data: FeedCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing = db.query(RssFeed).filter(
        RssFeed.user_id == current_user.id,
        RssFeed.url == feed_data.url,
        RssFeed.status != "deleted"
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该 RSS 源已存在")

    try:
        xml = _fetch_feed_xml(feed_data.url)
        feed_info, _ = _parse_feed(xml, "", current_user.id)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"验证 RSS 源失败：{e}")

    feed = RssFeed(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        url=feed_data.url,
        title=feed_data.title or feed_info.get("title"),
        description=feed_info.get("description"),
        site_url=feed_info.get("site_url"),
        language=feed_info.get("language"),
        fetch_status="success",
        status="active",
    )
    db.add(feed)
    db.commit()
    db.refresh(feed)
    return feed


@router.get("/sources/{feed_id}", response_model=FeedResponse, summary="Get RSS feed")
async def get_feed(
    feed_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    return feed


@router.put("/sources/{feed_id}", response_model=FeedResponse, summary="Update RSS feed")
async def update_feed(
    feed_id: str,
    data: FeedUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    if data.title is not None:
        feed.title = data.title
    if data.status is not None:
        feed.status = data.status
    feed.updated_at = datetime.now()
    db.commit()
    db.refresh(feed)
    return feed


@router.delete("/sources/{feed_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete RSS feed")
async def delete_feed(
    feed_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    feed.status = "deleted"
    db.commit()
    return None


@router.post("/sources/{feed_id}/fetch", response_model=dict, summary="Fetch feed entries", description="Manually fetch the latest entries from an RSS feed.")
async def fetch_feed(
    feed_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    
    try:
        xml = _fetch_feed_xml(feed.url)
        feed_info, entries = _parse_feed(xml, feed.id, current_user.id)
        
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
                user_id=current_user.id,
                title=entry_data.get("title"),
                link=entry_data.get("link"),
                summary=entry_data.get("summary"),
                author=entry_data.get("author"),
                published_at=_parse_datetime(entry_data.get("published_at")),
                external_id=external_id,
            )
            db.add(new_entry)
            added += 1
        
        db.commit()
        return {"success": True, "added": added, "total_parsed": len(entries)}
    except Exception as e:
        error_msg = str(e)
        if not error_msg:
            error_msg = "拉取失败，请稍后重试"
        feed.fetch_status = "error"
        feed.fetch_error = error_msg
        feed.last_fetched_at = datetime.now()
        db.commit()
        raise HTTPException(status_code=400, detail=error_msg)


@router.get("/sources/{feed_id}/entries", response_model=List[EntryResponse], summary="List feed entries")
async def list_entries(
    feed_id: str,
    unread_only: bool = False,
    saved_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    
    query = db.query(RssEntry).filter(
        RssEntry.feed_id == feed_id,
        RssEntry.user_id == current_user.id,
        RssEntry.status == "active",
    )
    if unread_only:
        query = query.filter(RssEntry.is_read == False)
    if saved_only:
        query = query.filter(RssEntry.is_saved == True)
    
    entries = query.order_by(RssEntry.published_at.desc().nullslast()).limit(limit).all()
    return entries


@router.post("/entries/{entry_id}/read", response_model=EntryResponse, summary="Mark entry as read")
async def mark_entry_read(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entry = db.query(RssEntry).filter(RssEntry.id == entry_id, RssEntry.user_id == current_user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.is_read = True
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/entries/{entry_id}/save", response_model=dict, summary="Save entry as clip")
async def save_entry(
    entry_id: str,
    request: SaveEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entry = db.query(RssEntry).filter(RssEntry.id == entry_id, RssEntry.user_id == current_user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    if request.as_clip:
        clip = BrowserClip(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            brain_side="network",
            title=entry.title or "RSS 剪藏",
            url=entry.link,
            domain=_extract_domain(entry.link),
            excerpt=entry.summary,
            status="active",
        )
        db.add(clip)
    
    entry.is_saved = True
    db.commit()
    return {"success": True, "message": "已保存为剪藏"}


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete RSS entry")
async def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entry = db.query(RssEntry).filter(RssEntry.id == entry_id, RssEntry.user_id == current_user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.status = "deleted"
    db.commit()
    return None
