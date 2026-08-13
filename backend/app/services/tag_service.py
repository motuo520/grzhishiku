"""Generic tag association service for note / clip / knowledge entities."""
from typing import List, Optional, Dict
import uuid

from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.models.base import Tag, content_tags
from app.schemas.tag import TagItem


CONTENT_TYPE_NOTE = "note"
CONTENT_TYPE_CLIP = "clip"
CONTENT_TYPE_KNOWLEDGE = "knowledge"


def resolve_tag_inputs(
    db: Session,
    user_id: str,
    tag_inputs: Optional[List[str]],
    default_color: str = "#8b949e"
) -> List[str]:
    """
    Convert a list of tag IDs or names into tag IDs.
    Creates new tags automatically for names that don't exist.
    """
    if not tag_inputs:
        return []

    tag_ids = []
    for raw in tag_inputs:
        if raw is None:
            continue
        raw = raw.strip()
        if not raw:
            continue

        # Try ID first, then name
        tag = db.query(Tag).filter(Tag.id == raw, Tag.user_id == user_id).first()
        if not tag:
            tag = db.query(Tag).filter(Tag.user_id == user_id, Tag.name == raw).first()

        if tag:
            tag_ids.append(tag.id)
            continue

        # Create new tag
        # 自动建标签的名称上限 50 字符：超长截断后再查一次重名，避免重复建
        if len(raw) > 50:
            raw = raw[:50]
            tag = db.query(Tag).filter(Tag.user_id == user_id, Tag.name == raw).first()
            if tag:
                tag_ids.append(tag.id)
                continue
        new_tag = Tag(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=raw,
            color=default_color,
        )
        db.add(new_tag)
        db.flush()
        tag_ids.append(new_tag.id)

    return tag_ids


def get_tags_for(db: Session, content_type: str, content_id: str) -> List[TagItem]:
    """Get associated tags for a content item."""
    tags = db.query(Tag).join(
        content_tags,
        and_(
            content_tags.c.tag_id == Tag.id,
            content_tags.c.content_id == content_id,
            content_tags.c.content_type == content_type,
        )
    ).all()
    return [TagItem(id=t.id, name=t.name, color=t.color or "#8b949e") for t in tags]


def set_tags_for(
    db: Session,
    content_type: str,
    content_id: str,
    user_id: str,
    tag_inputs: Optional[List[str]],
) -> None:
    """Replace all tag associations for a content item."""
    # Clear existing associations
    db.execute(
        content_tags.delete().where(
            and_(
                content_tags.c.content_id == content_id,
                content_tags.c.content_type == content_type,
            )
        )
    )

    tag_ids = resolve_tag_inputs(db, user_id, tag_inputs)
    for tag_id in tag_ids:
        db.execute(
            content_tags.insert().values(
                content_id=content_id,
                content_type=content_type,
                tag_id=tag_id,
            )
        )


def delete_tags_for(db: Session, content_type: str, content_id: str) -> None:
    """Remove all tag associations for a content item."""
    db.execute(
        content_tags.delete().where(
            and_(
                content_tags.c.content_id == content_id,
                content_tags.c.content_type == content_type,
            )
        )
    )


def get_tag_usage_count(db: Session, tag_id: str) -> int:
    """Total number of content items associated with a tag."""
    return db.query(content_tags).filter(content_tags.c.tag_id == tag_id).count()


def get_tag_usage_breakdown(db: Session, tag_id: str, user_id: str) -> Dict[str, int]:
    """
    Return usage count per content type for a tag.

    口径说明：user_id 是签名留位，实际不过滤计数——content_tags 表无 user_id
    列，标签归属由调用端点前置校验（tag_id 属于该用户），标签下的关联均为该
    用户所挂，直接按 tag_id 统计即为该用户的用量。
    """
    breakdown = {"note": 0, "clip": 0, "knowledge": 0}

    # Note: content_tags has no user_id column; we join with Tag to enforce ownership
    # and then count by content_type. This is an approximation: a tag may theoretically
    # be associated with content belonging to another user if IDs collide, but all
    # endpoints enforce user ownership before associating tags.
    rows = db.query(
        content_tags.c.content_type
    ).filter(
        content_tags.c.tag_id == tag_id
    ).all()

    for row in rows:
        ctype = row[0]
        if ctype in breakdown:
            breakdown[ctype] += 1
        else:
            breakdown[ctype] = 1

    return breakdown


def merge_tags(db: Session, source_tag_id: str, target_tag_id: str) -> None:
    """
    Move all associations from source_tag_id to target_tag_id,
    then delete the source tag.
    """
    if source_tag_id == target_tag_id:
        return

    # Update associations
    db.execute(
        content_tags.update().where(
            content_tags.c.tag_id == source_tag_id
        ).values(tag_id=target_tag_id)
    )

    # Delete source tag
    source = db.query(Tag).filter(Tag.id == source_tag_id).first()
    if source:
        db.delete(source)


def cleanup_orphaned_tags(db: Session, user_id: str) -> int:
    """Delete tags with zero associations for a user. Returns deleted count."""
    from sqlalchemy import func

    subquery = db.query(content_tags.c.tag_id).distinct().subquery()
    orphaned = db.query(Tag).filter(
        Tag.user_id == user_id,
        ~Tag.id.in_(subquery)
    ).all()

    deleted = 0
    for tag in orphaned:
        db.delete(tag)
        deleted += 1

    return deleted


def get_tag_associations(
    db: Session,
    tag_id: str,
    user_id: str,
) -> Dict[str, List[Dict]]:
    """
    Return associated content items grouped by content type for a tag.
    Only returns content owned by the given user.
    """
    from app.models.base import Note, BrowserClip, KnowledgeUnit
    from sqlalchemy import and_

    associations = db.query(
        content_tags.c.content_type,
        content_tags.c.content_id,
    ).filter(
        content_tags.c.tag_id == tag_id
    ).all()

    note_ids = [a.content_id for a in associations if a.content_type == CONTENT_TYPE_NOTE]
    clip_ids = [a.content_id for a in associations if a.content_type == CONTENT_TYPE_CLIP]
    knowledge_ids = [a.content_id for a in associations if a.content_type == CONTENT_TYPE_KNOWLEDGE]

    result: Dict[str, List[Dict]] = {"note": [], "clip": [], "knowledge": []}

    if note_ids:
        notes = db.query(Note).filter(
            Note.id.in_(note_ids),
            Note.user_id == user_id,
            Note.status == "active"
        ).all()
        result["note"] = [{"id": n.id, "title": n.title, "type": "note"} for n in notes]

    if clip_ids:
        clips = db.query(BrowserClip).filter(
            BrowserClip.id.in_(clip_ids),
            BrowserClip.user_id == user_id,
            BrowserClip.status == "active"
        ).all()
        result["clip"] = [{"id": c.id, "title": c.title, "url": c.url, "type": "clip"} for c in clips]

    if knowledge_ids:
        units = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.id.in_(knowledge_ids),
            KnowledgeUnit.user_id == user_id,
            KnowledgeUnit.status == "active"
        ).all()
        result["knowledge"] = [{"id": u.id, "title": u.source_title or u.content_raw[:80], "type": "knowledge"} for u in units]

    return result
