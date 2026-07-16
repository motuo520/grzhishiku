import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.base import ReadLaterItem, User, KnowledgeUnit
from app.services import tag_service
from app.services.url_metadata import fetch_url_metadata
from app.core.xss_sanitizer import sanitize_knowledge_input


def create_item(
    db: Session,
    user: User,
    url: str,
    title: Optional[str] = None,
    excerpt: Optional[str] = None,
    source: str = "manual",
    fetch_metadata: bool = True,
) -> ReadLaterItem:
    domain = None
    cover_image = None

    if fetch_metadata and (not title or not excerpt):
        metadata = fetch_url_metadata(url)
        if not title:
            title = metadata.title if not metadata.error else url
        if not excerpt:
            excerpt = metadata.excerpt
        domain = metadata.domain
        cover_image = metadata.cover_image
    else:
        from app.services.url_metadata import extract_domain
        domain = extract_domain(url)

    item = ReadLaterItem(
        id=str(uuid.uuid4()),
        user_id=user.id,
        title=title or url,
        url=url,
        domain=domain,
        excerpt=excerpt,
        cover_image=cover_image,
        status="unread",
        is_favorite=False,
        read_progress=0,
        source=source,
        item_status="active",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def list_items(
    db: Session,
    user: User,
    status: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[ReadLaterItem]:
    query = db.query(ReadLaterItem).filter(
        ReadLaterItem.user_id == user.id,
        ReadLaterItem.item_status == "active"
    )
    if status:
        query = query.filter(ReadLaterItem.status == status)
    if is_favorite is not None:
        query = query.filter(ReadLaterItem.is_favorite == is_favorite)
    if q:
        search = f"%{q}%"
        query = query.filter(
            ReadLaterItem.title.ilike(search)
            | ReadLaterItem.excerpt.ilike(search)
            | ReadLaterItem.url.ilike(search)
        )
    return query.order_by(ReadLaterItem.created_at.desc()).offset(skip).limit(limit).all()


def get_item(db: Session, user: User, item_id: str) -> Optional[ReadLaterItem]:
    return db.query(ReadLaterItem).filter(
        ReadLaterItem.id == item_id,
        ReadLaterItem.user_id == user.id,
        ReadLaterItem.item_status == "active"
    ).first()


def update_item(db: Session, user: User, item_id: str, data: dict) -> Optional[ReadLaterItem]:
    item = get_item(db, user, item_id)
    if not item:
        return None
    if "title" in data and data["title"] is not None:
        item.title = data["title"]
    if "excerpt" in data and data["excerpt"] is not None:
        item.excerpt = data["excerpt"]
    if "status" in data and data["status"] is not None:
        item.status = data["status"]
        if data["status"] == "read":
            item.read_progress = 100
        elif data["status"] == "unread":
            item.read_progress = 0
    if "is_favorite" in data and data["is_favorite"] is not None:
        item.is_favorite = data["is_favorite"]
    if "read_progress" in data and data["read_progress"] is not None:
        item.read_progress = data["read_progress"]
        if item.read_progress >= 100:
            item.status = "read"
    item.updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, user: User, item_id: str) -> bool:
    item = get_item(db, user, item_id)
    if not item:
        return False
    item.item_status = "deleted"
    db.commit()
    return True


def fetch_full_content(db: Session, user: User, item_id: str) -> Optional[ReadLaterItem]:
    item = get_item(db, user, item_id)
    if not item:
        return None
    try:
        metadata = fetch_url_metadata(item.url, timeout=15)
        if not metadata.error:
            item.title = metadata.title or item.title
            item.excerpt = metadata.excerpt or item.excerpt
            item.cover_image = metadata.cover_image or item.cover_image
            # Try simple article extraction
            item.full_text = _extract_article_text(item.url) or item.excerpt
            item.updated_at = datetime.now()
            db.commit()
            db.refresh(item)
    except Exception as e:
        print(f"Fetch full content failed for {item.id}: {e}")
    return item


def _extract_article_text(url: str) -> Optional[str]:
    """Basic article text extraction using readability-lxml if available, otherwise fallback."""
    try:
        from readability import Document
        import requests
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=10)
        doc = Document(resp.text)
        html = doc.summary()
        import re
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text
    except Exception:
        return None


def save_to_knowledge(db: Session, user: User, item: ReadLaterItem, tag_ids: Optional[List[str]] = None) -> str:
    content = item.full_text or item.excerpt or item.title or ""
    safe_content, safe_url, safe_title = sanitize_knowledge_input(
        content,
        item.url,
        item.title or "(无标题)"
    )

    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=user.id,
        brain_side='network',
        content_raw=safe_content,
        content_type='read_later',
        source_url=safe_url,
        source_title=safe_title,
        source_type='read_later',
        source_author=None,
        source_publish_date=None,
        verification_status='unverified',
        trust_level='tentative',
        verification_history='[]',
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)

    if tag_ids:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
            content_id=unit.id,
            user_id=user.id,
            tag_inputs=tag_ids,
        )
        db.commit()
        db.refresh(unit)

    try:
        from app.api.v1.endpoints.graph import auto_link_knowledge
        auto_link_knowledge(db, unit, user.id)
        db.commit()
    except Exception as e:
        print(f"Auto-link failed for read-later knowledge {unit.id}: {e}")

    item.item_status = "imported_to_knowledge"
    item.knowledge_id = unit.id
    db.commit()

    return unit.id
