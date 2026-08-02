import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_clip_input, sanitize_knowledge_input
from app.services.quota_service import QuotaService
from app.models.base import User, BrowserClip, KnowledgeUnit, content_tags
from app.schemas.clip import ClipCreate, ClipResponse, ClipUpdate
from app.schemas.knowledge import KnowledgeUnitResponse
from app.services import tag_service
from pydantic import BaseModel as PydanticBaseModel
import urllib.request
import urllib.error
import re
from datetime import datetime, timedelta

class BatchClipCreate(PydanticBaseModel):
    items: List[ClipCreate]

class BatchCreateResult(PydanticBaseModel):
    success_count: int
    failed_count: int
    failures: List[dict] = []
    items: List[ClipResponse] = []

class UrlMetadataRequest(PydanticBaseModel):
    urls: List[str]

class UrlMetadata(PydanticBaseModel):
    url: str
    title: str
    domain: str
    excerpt: Optional[str] = None
    error: Optional[str] = None
from app.api.v1.endpoints.graph import auto_link_clip, auto_link_knowledge

router = APIRouter()

logger = logging.getLogger(__name__)


def _build_clip_response(clip: BrowserClip, db: Session) -> dict:
    return {
        "id": clip.id,
        "user_id": clip.user_id,
        "brain_side": clip.brain_side,
        "title": clip.title,
        "url": clip.url,
        "domain": clip.domain,
        "excerpt": clip.excerpt,
        "full_text": clip.full_text,
        "tags": tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip.id),
        "created_at": clip.created_at,
        "updated_at": clip.updated_at,
    }


@router.get("/", response_model=List[ClipResponse], summary="List clips", description="Get all browser clips for the current user with pagination, search, domain filter, and tag filter.")
async def list_clips(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    domain: Optional[str] = Query(None, description="Filter by domain"),
    q: Optional[str] = Query(None, description="Search in title or excerpt"),
    tag_ids: Optional[str] = Query(None, description="Filter by comma-separated tag IDs"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(BrowserClip).filter(BrowserClip.user_id == current_user.id, BrowserClip.status == "active")
    
    if domain:
        query = query.filter(BrowserClip.domain == domain)
    
    if q:
        search = f"%{q}%"
        query = query.filter(or_(BrowserClip.title.ilike(search), BrowserClip.excerpt.ilike(search)))
    
    if tag_ids:
        tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if tag_id_list:
            from sqlalchemy import and_
            query = query.join(
                content_tags,
                and_(
                    content_tags.c.content_id == BrowserClip.id,
                    content_tags.c.content_type == tag_service.CONTENT_TYPE_CLIP,
                    content_tags.c.tag_id.in_(tag_id_list)
                )
            ).distinct()
    
    clips = query.order_by(BrowserClip.created_at.desc()).offset(skip).limit(limit).all()
    return [_build_clip_response(c, db) for c in clips]

@router.post("/", response_model=ClipResponse, status_code=status.HTTP_201_CREATED, summary="Create clip", description="Create a new browser clip for the current user.")
async def create_clip(
    clip_data: ClipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    quota = QuotaService(db)
    safe_title, safe_excerpt, safe_full_text, safe_url = sanitize_clip_input(
        clip_data.title, clip_data.excerpt, clip_data.full_text, clip_data.url
    )
    additional_bytes = (
        quota.estimate_storage_bytes(safe_title or "")
        + quota.estimate_storage_bytes(safe_excerpt or "")
        + quota.estimate_storage_bytes(safe_full_text or "")
    )

    clip = BrowserClip(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=clip_data.brain_side,
        title=safe_title,
        url=safe_url,
        domain=clip_data.domain or _extract_domain(safe_url),
        excerpt=safe_excerpt,
        full_text=safe_full_text,
        status="active",
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    quota.record_storage_add(current_user.id, additional_bytes)

    # Set tags
    if clip_data.tags is not None:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_CLIP,
            content_id=clip.id,
            user_id=current_user.id,
            tag_inputs=clip_data.tags,
        )
        db.commit()
        db.refresh(clip)
    
    # Auto-link graph edges
    try:
        await auto_link_clip(db, clip, current_user.id)
        db.commit()
    except Exception as e:
        logger.warning(f"Auto-link failed for clip {clip.id}: {e}")
    
    return _build_clip_response(clip, db)

@router.get("/{clip_id}", response_model=ClipResponse, summary="Get clip", description="Get a specific clip by ID.")
async def get_clip(
    clip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.user_id == current_user.id, BrowserClip.status == "active").first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    return _build_clip_response(clip, db)

@router.put("/{clip_id}", response_model=ClipResponse, summary="Update clip", description="Update an existing browser clip.")
async def update_clip(
    clip_id: str,
    data: ClipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.user_id == current_user.id, BrowserClip.status == "active").first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    if data.title is not None:
        safe_title, _, _, _ = sanitize_clip_input(data.title, None, None, None)
        clip.title = safe_title
    if data.url is not None:
        _, _, _, safe_url = sanitize_clip_input(None, None, None, data.url)
        clip.url = safe_url
        if data.domain is None:
            clip.domain = _extract_domain(safe_url)
    if data.domain is not None:
        clip.domain = data.domain
    if data.excerpt is not None:
        _, safe_excerpt, _, _ = sanitize_clip_input(None, data.excerpt, None, None)
        clip.excerpt = safe_excerpt
    if data.full_text is not None:
        _, _, safe_full_text, _ = sanitize_clip_input(None, None, data.full_text, None)
        clip.full_text = safe_full_text
    if data.tags is not None:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_CLIP,
            content_id=clip.id,
            user_id=current_user.id,
            tag_inputs=data.tags,
        )
    clip.updated_at = datetime.now()
    db.commit()
    db.refresh(clip)
    return _build_clip_response(clip, db)


@router.post("/{clip_id}/save-to-knowledge", response_model=KnowledgeUnitResponse, status_code=status.HTTP_201_CREATED, summary="Save clip as knowledge unit", description="Convert a browser clip into a knowledge unit.")
async def save_clip_to_knowledge(
    clip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.user_id == current_user.id, BrowserClip.status == "active").first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    content = clip.full_text or clip.excerpt or clip.title
    safe_content, safe_url, safe_title = sanitize_knowledge_input(content, clip.url, clip.title)
    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side='network',
        content_raw=safe_content,
        content_type='clip',
        source_url=safe_url,
        source_title=safe_title,
        source_type='browser_clip',
        source_author=None,
        verification_status='unverified',
        trust_level='tentative',
        verification_history='[]',
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)

    # Copy clip tags to knowledge unit
    clip_tags = tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip.id)
    if clip_tags:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
            content_id=unit.id,
            user_id=current_user.id,
            tag_inputs=[t.name for t in clip_tags],
        )
        db.commit()
        db.refresh(unit)
    
    try:
        await auto_link_knowledge(db, unit, current_user.id)
        db.commit()
    except Exception as e:
        logger.warning(f"Auto-link failed for knowledge {unit.id}: {e}")
    
    return unit


@router.delete("/{clip_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete clip", description="Soft-delete a clip by setting status to deleted.")
async def delete_clip(
    clip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.user_id == current_user.id, BrowserClip.status == "active").first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    clip.status = "deleted"
    tag_service.delete_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip_id)
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, clip_id)
    db.commit()
    return None


def _extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain or url
    except Exception:
        return url


def _fetch_url_metadata(url: str) -> UrlMetadata:
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=8,
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            html = response.read().decode("utf-8", errors="ignore")
        
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else url
        # Collapse whitespace
        title = re.sub(r"\s+", " ", title)
        
        desc_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            re.IGNORECASE,
        ) or re.search(
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
            html,
            re.IGNORECASE,
        )
        excerpt = desc_match.group(1).strip() if desc_match else None
        if excerpt:
            excerpt = re.sub(r"\s+", " ", excerpt)
        
        return UrlMetadata(url=url, title=title, domain=_extract_domain(url), excerpt=excerpt)
    except Exception as e:
        return UrlMetadata(url=url, title=url, domain=_extract_domain(url), error=str(e))


@router.post("/batch", response_model=BatchCreateResult, summary="Batch create clips", description="Create multiple browser clips in a single request.")
async def batch_create_clips(
    batch: BatchClipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    created = []
    failures = []
    for index, clip_data in enumerate(batch.items):
        try:
            safe_title, safe_excerpt, safe_full_text, safe_url = sanitize_clip_input(
                clip_data.title, clip_data.excerpt, clip_data.full_text, clip_data.url
            )
            clip = BrowserClip(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                brain_side=clip_data.brain_side,
                title=safe_title,
                url=safe_url,
                domain=clip_data.domain,
                excerpt=safe_excerpt,
                full_text=safe_full_text,
                status="active",
            )
            db.add(clip)
            db.flush()
            if clip_data.tags is not None:
                tag_service.set_tags_for(
                    db,
                    content_type=tag_service.CONTENT_TYPE_CLIP,
                    content_id=clip.id,
                    user_id=current_user.id,
                    tag_inputs=clip_data.tags,
                )
            try:
                await auto_link_clip(db, clip, current_user.id)
            except Exception as e:
                logger.warning(f"Auto-link failed for clip {clip.id}: {e}")
            db.refresh(clip)
            created.append(_build_clip_response(clip, db))
        except Exception as e:
            failures.append({"index": index, "title": clip_data.title, "reason": str(e)})
    
    db.commit()
    return {
        "success_count": len(created),
        "failed_count": len(failures),
        "failures": failures,
        "items": created,
    }


@router.post("/fetch-metadata", response_model=List[UrlMetadata], summary="Fetch URL metadata", description="Fetch titles and descriptions for a list of URLs.")
async def fetch_url_metadata(
    request: UrlMetadataRequest,
    current_user: User = Depends(get_current_user)
):
    return [_fetch_url_metadata(url) for url in request.urls]
