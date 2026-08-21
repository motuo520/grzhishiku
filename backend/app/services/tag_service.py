"""Generic tag association service for note / clip / knowledge entities."""
import logging
from datetime import datetime
from typing import List, Optional, Dict
import uuid

from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.models.base import Tag, content_tags
from app.schemas.tag import TagItem

logger = logging.getLogger(__name__)


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


def _live_usage_breakdown(db: Session, tag_id: str) -> Dict[str, int]:
    """只统计「内容真实存在且未删除」的关联。

    content_tags 是弱引用（无外键级联），历史路径（批量删除 404 时期等）会留下
    内容已删但关联行还在的幽灵行——按原始行数统计会让「空标签」永远删不掉
    （08-20 用户实锤：4 个幽灵标签死锁）。此函数是全站标签用量的唯一口径。
    """
    from app.models.base import Note, BrowserClip, KnowledgeUnit

    rows = db.query(
        content_tags.c.content_type, content_tags.c.content_id
    ).filter(content_tags.c.tag_id == tag_id).all()

    ids_by_type: Dict[str, set] = {}
    for r in rows:
        ids_by_type.setdefault(r[0], set()).add(r[1])

    breakdown: Dict[str, int] = {"note": 0, "clip": 0, "knowledge": 0}
    for ctype, model in (("note", Note), ("clip", BrowserClip), ("knowledge", KnowledgeUnit)):
        ids = ids_by_type.get(ctype)
        if not ids:
            continue
        breakdown[ctype] = db.query(model).filter(
            model.id.in_(ids), model.status != "deleted"
        ).count()
    # 未识别类型（历史残留）不计入——它们对用户不可见
    return breakdown


def get_tag_usage_count(db: Session, tag_id: str) -> int:
    """Total number of LIVE content items associated with a tag（幽灵行不计）。"""
    return sum(_live_usage_breakdown(db, tag_id).values())


def get_tag_usage_breakdown(db: Session, tag_id: str, user_id: str) -> Dict[str, int]:
    """
    Return LIVE usage count per content type for a tag.

    口径说明：user_id 是签名留位，实际不过滤计数——content_tags 表无 user_id
    列，标签归属由调用端点前置校验（tag_id 属于该用户），标签下的关联均为该
    用户所挂，直接按 tag_id 统计即为该用户的用量。
    """
    return _live_usage_breakdown(db, tag_id)


def purge_ghost_associations(db: Session, tag_id: Optional[str] = None) -> int:
    """清除幽灵关联行（内容行不存在或已删除）。返回清理条数。"""
    from app.models.base import Note, BrowserClip, KnowledgeUnit

    q = db.query(content_tags.c.content_type, content_tags.c.content_id, content_tags.c.tag_id)
    if tag_id:
        q = q.filter(content_tags.c.tag_id == tag_id)
    ghosts = []
    for ctype, cid, tid in q.all():
        model = {"note": Note, "clip": BrowserClip, "knowledge": KnowledgeUnit}.get(ctype)
        if model is None:
            ghosts.append((ctype, cid, tid))  # 未识别类型一律视为幽灵
            continue
        row = db.query(model.status).filter(model.id == cid).first()
        if row is None or row[0] == "deleted":
            ghosts.append((ctype, cid, tid))
    for ctype, cid, tid in ghosts:
        db.execute(
            content_tags.delete().where(
                and_(
                    content_tags.c.content_type == ctype,
                    content_tags.c.content_id == cid,
                    content_tags.c.tag_id == tid,
                )
            )
        )
    return len(ghosts)


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
    """Delete tags with zero LIVE associations for a user.

    先清幽灵关联行再判空：只挂着幽灵行的标签本质是空标签，应一并回收。
    Returns deleted count."""
    purge_ghost_associations(db)

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


def sweep_stale_empty_tags(db: Session, max_age_days: int = 30) -> int:
    """每日回收：清幽灵行 + 删除「零活关联且创建超过 max_age_days」的标签（全用户）。

    自动打标会产生大量一次性空标签（08-20 实测某库 736 标签 592 空），
    30 天宽限期保证新建未用的手动标签不被误伤。返回删除条数。
    """
    from datetime import timedelta

    purge_ghost_associations(db)
    cutoff = datetime.now() - timedelta(days=max_age_days)
    used = db.query(content_tags.c.tag_id).distinct().subquery()
    stale = db.query(Tag).filter(~Tag.id.in_(used), Tag.created_at < cutoff).all()
    for tag in stale:
        db.delete(tag)
    if stale:
        logger.info("swept %d stale empty tags", len(stale))
    return len(stale)


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
