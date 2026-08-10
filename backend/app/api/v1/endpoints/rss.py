from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timedelta
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, RssFeed, RssEntry, BrowserClip
from app.services import rss_service
from app.services.rss_service import AUTO_FETCH_INTERVALS

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


class AutoFetchRequest(BaseModel):
    enabled: bool = False
    interval_minutes: int = 60


def _extract_domain(url: str) -> str:
    return rss_service._extract_domain(url)


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
    # SSRF 防护：仅允许 http/https，且禁止内网/回环地址（域名解析后的 IP 同样校验）
    from app.services.url_guard import validate_fetch_url, UrlNotAllowed
    try:
        validate_fetch_url(feed_data.url)
    except UrlNotAllowed as e:
        raise HTTPException(status_code=400, detail=str(e))

    existing = db.query(RssFeed).filter(
        RssFeed.user_id == current_user.id,
        RssFeed.url == feed_data.url,
        RssFeed.status != "deleted"
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该 RSS 源已存在")

    try:
        xml = rss_service.fetch_feed_xml(feed_data.url)
        feed_info, _ = rss_service.parse_feed(xml, "", current_user.id)
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
        result = rss_service.refresh_feed(db, feed, current_user.id)
        return {"success": True, **result}
    except Exception as e:
        error_msg = str(e) or "拉取失败，请稍后重试"
        raise HTTPException(status_code=400, detail=error_msg)


@router.get("/sources/{feed_id}/auto-fetch", response_model=dict, summary="Get auto-fetch configuration")
async def get_auto_fetch(
    feed_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    cfg = rss_service.get_auto_fetch_config(current_user, feed_id)
    next_due_at = None
    if cfg["enabled"] and feed.last_fetched_at:
        next_due_at = feed.last_fetched_at + timedelta(minutes=cfg["interval_minutes"])
    return {
        "feed_id": feed_id,
        **cfg,
        "last_fetched_at": feed.last_fetched_at,
        "next_due_at": next_due_at,
    }


@router.put("/sources/{feed_id}/auto-fetch", response_model=dict, summary="Update auto-fetch configuration")
async def set_auto_fetch(
    feed_id: str,
    data: AutoFetchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    feed = db.query(RssFeed).filter(RssFeed.id == feed_id, RssFeed.user_id == current_user.id, RssFeed.status != "deleted").first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    if data.interval_minutes not in AUTO_FETCH_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interval. Allowed values: {AUTO_FETCH_INTERVALS}",
        )
    cfg = rss_service.set_auto_fetch_config(current_user, feed_id, data.enabled, data.interval_minutes, db)
    return {"feed_id": feed_id, **cfg}


@router.get("/sources/{feed_id}/entries", response_model=List[EntryResponse], summary="List feed entries")
async def list_entries(
    feed_id: str,
    unread_only: bool = False,
    saved_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
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
