"""Generic tag association service for note / clip / knowledge entities."""
import logging
from datetime import datetime
from typing import List, Optional, Dict
import uuid

from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.models.base import Tag, content_tags, Folder
from app.schemas.tag import TagItem

logger = logging.getLogger(__name__)


CONTENT_TYPE_NOTE = "note"
CONTENT_TYPE_CLIP = "clip"
CONTENT_TYPE_KNOWLEDGE = "knowledge"
CONTENT_TYPE_DOCUMENT = "document"


def autofile_by_tag(db: Session, content_type: str, content_id: str, user_id: str) -> bool:
    """标签写入后的归档检查入口（08-22 v2 起委托给规则引擎：
    folder_service.evaluate_archive_rules，按文件夹 auto_rules 归档，不再按同名匹配）。
    函数名保留以免惊动调用方。"""
    from app.services.folder_service import evaluate_archive_rules
    return evaluate_archive_rules(db, content_type, content_id, user_id)


def resolve_tag_inputs(
    db: Session,
    user_id: str,
    tag_inputs: Optional[List[str]],
    default_color: str = "#8b949e",
    tenant=None,
) -> List[str]:
    """
    Convert a list of tag IDs or names into tag IDs.
    Creates new tags automatically for names that don't exist.
    空间口径：tenant 非空时查/建该租户的团队标签（同名按 空间+名称 唯一复用），
    个人上下文限本人且 tenant_id 为空的个人标签。
    """
    from app.core.tenant_scope import scope_condition
    if not tag_inputs:
        return []

    # 逗号/顿号/分号分隔拆分（09-11 实捕：手动/批量/扩展通道把 "a, b" 整串当一个标签建。
    # 拆分收口在解析层，所有调用方（notes/clips/documents/批量导入/剪藏扩展）自动受益）
    import re as _re
    split_inputs: List[str] = []
    for raw in tag_inputs:
        if raw is None:
            continue
        split_inputs.extend(_re.split(r"[,，、;；]", raw))

    tag_ids = []
    for raw in split_inputs:
        if raw is None:
            continue
        raw = raw.strip()
        if not raw:
            continue

        # Try ID first, then name（均限当前空间）
        tag = db.query(Tag).filter(Tag.id == raw, scope_condition(Tag, user_id, tenant)).first()
        if not tag:
            tag = db.query(Tag).filter(scope_condition(Tag, user_id, tenant), Tag.name == raw).first()

        if tag:
            tag_ids.append(tag.id)
            continue

        # Create new tag
        # 自动建标签的名称上限 50 字符：超长截断后再查一次重名，避免重复建
        if len(raw) > 50:
            raw = raw[:50]
            tag = db.query(Tag).filter(scope_condition(Tag, user_id, tenant), Tag.name == raw).first()
            if tag:
                tag_ids.append(tag.id)
                continue
        new_tag = Tag(
            id=str(uuid.uuid4()),
            user_id=user_id,
            tenant_id=tenant.id if tenant else None,
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


def get_tags_for_many(db: Session, content_type: str, content_ids: List[str]) -> Dict[str, List[TagItem]]:
    """批量版 get_tags_for（/notes 列表 N+1 实捕 09-14：每笔记一条 join 查询 → 一条 IN 查询）。"""
    if not content_ids:
        return {}
    rows = db.query(Tag, content_tags.c.content_id).join(
        content_tags,
        and_(
            content_tags.c.tag_id == Tag.id,
            content_tags.c.content_type == content_type,
        )
    ).filter(content_tags.c.content_id.in_(list(content_ids))).all()
    out: Dict[str, List[TagItem]] = {}
    for t, cid in rows:
        out.setdefault(cid, []).append(TagItem(id=t.id, name=t.name, color=t.color or "#8b949e"))
    return out


def set_tags_for(
    db: Session,
    content_type: str,
    content_id: str,
    user_id: str,
    tag_inputs: Optional[List[str]],
    tenant=None,
    source: str = "manual",
) -> None:
    """Replace all tag associations for a content item.
    tenant 非空（团队上下文）时标签写/复用该租户的团队标签。
    source：auto=自动打标 / manual=人工（默认）——「重打自动标签」只清 auto。"""
    # Clear existing associations
    db.execute(
        content_tags.delete().where(
            and_(
                content_tags.c.content_id == content_id,
                content_tags.c.content_type == content_type,
            )
        )
    )

    tag_ids = resolve_tag_inputs(db, user_id, tag_inputs, tenant=tenant)
    for tag_id in tag_ids:
        db.execute(
            content_tags.insert().values(
                content_id=content_id,
                content_type=content_type,
                tag_id=tag_id,
                source=source,
            )
        )
    # 同名即归集：未归档内容自动放进同名文件夹（只触发，不提交，由调用方统一 commit）
    autofile_by_tag(db, content_type, content_id, user_id)


def replace_auto_tags_for(
    db: Session,
    content_type: str,
    content_id: str,
    user_id: str,
    tag_inputs: Optional[List[str]],
    tenant=None,
) -> None:
    """重打自动标签：只清 source='auto' 的关联（人工标签原样保留），再写入新自动标签。
    新标签与保留的人工标签同名（同 tag_id）时跳过，不重复关联。"""
    db.execute(
        content_tags.delete().where(
            and_(
                content_tags.c.content_id == content_id,
                content_tags.c.content_type == content_type,
                content_tags.c.source == "auto",
            )
        )
    )
    remaining = {
        row.tag_id
        for row in db.execute(
            content_tags.select().where(
                and_(
                    content_tags.c.content_id == content_id,
                    content_tags.c.content_type == content_type,
                )
            )
        ).mappings()
    }
    tag_ids = resolve_tag_inputs(db, user_id, tag_inputs, tenant=tenant)
    for tag_id in tag_ids:
        if tag_id in remaining:
            continue
        db.execute(
            content_tags.insert().values(
                content_id=content_id,
                content_type=content_type,
                tag_id=tag_id,
                source="auto",
            )
        )
    # 同名即归集（与 set_tags_for 同口径）
    autofile_by_tag(db, content_type, content_id, user_id)


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
    from app.models.base import Note, BrowserClip, KnowledgeUnit, Document

    rows = db.query(
        content_tags.c.content_type, content_tags.c.content_id
    ).filter(content_tags.c.tag_id == tag_id).all()

    ids_by_type: Dict[str, set] = {}
    for r in rows:
        ids_by_type.setdefault(r[0], set()).add(r[1])

    breakdown: Dict[str, int] = {"note": 0, "clip": 0, "knowledge": 0, "document": 0}
    # Document 的软删列是 doc_status（与 note/clip/knowledge 的 status 不同名），单列
    for ctype, model, status_col in (
        ("note", Note, "status"), ("clip", BrowserClip, "status"),
        ("knowledge", KnowledgeUnit, "status"), ("document", Document, "doc_status"),
    ):
        ids = ids_by_type.get(ctype)
        if not ids:
            continue
        breakdown[ctype] = db.query(model).filter(
            model.id.in_(ids), getattr(model, status_col) != "deleted"
        ).count()
    # 未识别类型（历史残留）不计入——它们对用户不可见
    return breakdown


def get_all_usage_breakdowns(db: Session, tag_ids: List[str]) -> Dict[str, Dict[str, int]]:
    """批量版 _live_usage_breakdown（同一「只统计活体内容」口径）：

    /tags 列表的 N+1 实捕（09-14：1296 标签 × 5 查询/个 ≈ 6500 次 SQL，本机 2.2s）——
    改全程 6 条查询：content_tags 一把捞 + 四类内容各一条活体 IN 查询，Python 侧归并。
    """
    from app.models.base import Note, BrowserClip, KnowledgeUnit, Document

    out: Dict[str, Dict[str, int]] = {
        tid: {"note": 0, "clip": 0, "knowledge": 0, "document": 0} for tid in tag_ids
    }
    if not tag_ids:
        return out
    rows = db.query(
        content_tags.c.tag_id, content_tags.c.content_type, content_tags.c.content_id
    ).filter(content_tags.c.tag_id.in_(list(tag_ids))).all()
    # (tag_id, ctype) -> content ids
    cand: Dict[tuple, set] = {}
    all_ids_by_type: Dict[str, set] = {}
    for tid, ctype, cid in rows:
        cand.setdefault((tid, ctype), set()).add(cid)
        all_ids_by_type.setdefault(ctype, set()).add(cid)
    live: Dict[str, set] = {}
    for ctype, model, status_col in (
        ("note", Note, "status"), ("clip", BrowserClip, "status"),
        ("knowledge", KnowledgeUnit, "status"), ("document", Document, "doc_status"),
    ):
        ids = all_ids_by_type.get(ctype)
        if not ids:
            live[ctype] = set()
            continue
        live[ctype] = {r[0] for r in db.query(model.id).filter(
            model.id.in_(list(ids)), getattr(model, status_col) != "deleted"
        ).all()}
    for (tid, ctype), cids in cand.items():
        if ctype not in out.get(tid, {}):
            continue  # 未识别类型（历史残留）不计入
        out[tid][ctype] = len(cids & live.get(ctype, set()))
    return out


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
    from app.models.base import Note, BrowserClip, KnowledgeUnit, Document

    q = db.query(content_tags.c.content_type, content_tags.c.content_id, content_tags.c.tag_id)
    if tag_id:
        q = q.filter(content_tags.c.tag_id == tag_id)
    ghosts = []
    for ctype, cid, tid in q.all():
        # Document 的软删列是 doc_status（09-11 文档纳入打标：缺了这一行，
        # 文档标签关联会被当成「未识别类型」幽灵行清掉）
        spec = {"note": (Note, "status"), "clip": (BrowserClip, "status"),
                "knowledge": (KnowledgeUnit, "status"), "document": (Document, "doc_status")}.get(ctype)
        if spec is None:
            ghosts.append((ctype, cid, tid))  # 未识别类型一律视为幽灵
            continue
        model, status_col = spec
        row = db.query(getattr(model, status_col)).filter(model.id == cid).first()
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


def cleanup_orphaned_tags(db: Session, user_id: str, tenant=None) -> int:
    """Delete tags with zero LIVE associations for a user（按空间口径限当前空间）.

    先清幽灵关联行再判空：只挂着幽灵行的标签本质是空标签，应一并回收。
    Returns deleted count."""
    from app.core.tenant_scope import scope_condition

    purge_ghost_associations(db)

    subquery = db.query(content_tags.c.tag_id).distinct().subquery()
    orphaned = db.query(Tag).filter(
        scope_condition(Tag, user_id, tenant),
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
    tenant=None,
) -> Dict[str, List[Dict]]:
    """
    Return associated content items grouped by content type for a tag.
    Only returns content in the current space（团队上下文=该租户内容，个人=本人且 tenant_id 为空）.
    """
    from app.models.base import Note, BrowserClip, KnowledgeUnit, Document
    from app.core.tenant_scope import scope_condition
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
    document_ids = [a.content_id for a in associations if a.content_type == CONTENT_TYPE_DOCUMENT]

    result: Dict[str, List[Dict]] = {"note": [], "clip": [], "knowledge": [], "document": []}

    if note_ids:
        notes = db.query(Note).filter(
            Note.id.in_(note_ids),
            scope_condition(Note, user_id, tenant),
            Note.status == "active"
        ).all()
        result["note"] = [{"id": n.id, "title": n.title, "type": "note"} for n in notes]

    if clip_ids:
        clips = db.query(BrowserClip).filter(
            BrowserClip.id.in_(clip_ids),
            scope_condition(BrowserClip, user_id, tenant),
            BrowserClip.status == "active"
        ).all()
        result["clip"] = [{"id": c.id, "title": c.title, "url": c.url, "type": "clip"} for c in clips]

    if knowledge_ids:
        units = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.id.in_(knowledge_ids),
            scope_condition(KnowledgeUnit, user_id, tenant),
            KnowledgeUnit.status == "active"
        ).all()
        result["knowledge"] = [{"id": u.id, "title": u.source_title or u.content_raw[:80], "type": "knowledge"} for u in units]

    if document_ids:
        # Document 软删列是 doc_status；标题兜底 original_name
        docs = db.query(Document).filter(
            Document.id.in_(document_ids),
            scope_condition(Document, user_id, tenant),
            Document.doc_status == "active"
        ).all()
        result["document"] = [{"id": d.id, "title": d.title or d.original_name, "type": "document"} for d in docs]

    return result
