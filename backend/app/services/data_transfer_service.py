"""用户数据导出/导入服务（云同步快照与数据页导出共用）。

导出为 JSON dict；导入按 id 合并：`updated_at`（无则 `created_at`）较新者胜，
只增/改不删。导入时所有行的 user_id 强制改写为当前用户，防止越权写入。
撞到他用户已有的 id 时生成新 id 插入，绝不覆盖他人数据。
"""
from datetime import datetime
from typing import Any, Dict, Tuple
import uuid

from sqlalchemy import DateTime, select
from sqlalchemy.orm import Session

from app.models.base import (
    Note, Capsule, BrowserClip, KnowledgeUnit,
    Tag, ReadLaterItem, RssFeed, Document, content_tags,
)
from app.models.sticky_note import StickyNote

# 导出范围：用户核心内容数据（不含 settings，避免泄露密钥）
EXPORT_TABLES: Tuple[Tuple[str, Any], ...] = (
    ("notes", Note),
    ("capsules", Capsule),
    ("clips", BrowserClip),
    ("knowledge_units", KnowledgeUnit),
    ("sticky_notes", StickyNote),
    ("tags", Tag),
    ("read_later", ReadLaterItem),
    ("rss_feeds", RssFeed),
    ("documents", Document),
)

# 导入顺序：标签先于内容表，关联表最后恢复
_IMPORT_ORDER = (
    "tags", "notes", "capsules", "clips", "knowledge_units",
    "sticky_notes", "read_later", "rss_feeds", "documents",
)


def _row_to_dict(row: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    for col in row.__table__.columns:
        val = getattr(row, col.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        data[col.name] = val
    return data


def export_user_data_dict(db: Session, user_id: str) -> Dict[str, Any]:
    """导出用户全部内容数据（含 content_tags 关联）。"""
    data: Dict[str, Any] = {}
    for name, model in EXPORT_TABLES:
        rows = db.query(model).filter(model.user_id == user_id).all()
        data[name] = [_row_to_dict(r) for r in rows]

    # content_tags 无 user_id，按用户自己的 tag 关联行导出
    tag_ids = [t.id for t in db.query(Tag.id).filter(Tag.user_id == user_id).all()]
    links = []
    if tag_ids:
        for row in db.execute(
            select(content_tags).where(content_tags.c.tag_id.in_(tag_ids))
        ).mappings():
            links.append({
                "content_id": row["content_id"],
                "content_type": row["content_type"],
                "tag_id": row["tag_id"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            })
    data["content_tags"] = links
    return data


def _coerce_columns(model: Any, row: Dict[str, Any]) -> Dict[str, Any]:
    """只保留模型存在的列，并把 ISO 字符串转回 datetime。"""
    out: Dict[str, Any] = {}
    for col in model.__table__.columns:
        if col.name not in row:
            continue
        val = row[col.name]
        if val is not None and isinstance(col.type, DateTime) and isinstance(val, str):
            try:
                val = datetime.fromisoformat(val.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                continue  # 无法解析的时间字段宁可不写，也不让整行失败
        out[col.name] = val
    return out


def _row_timestamp(row: Dict[str, Any]) -> str:
    """取 updated_at/created_at 并统一为 ISO 字符串（可直接字典序比较）。"""
    val = row.get("updated_at") or row.get("created_at")
    if isinstance(val, datetime):
        return val.isoformat()
    return val or ""


def import_user_data(db: Session, user_id: str, data: Dict[str, Any]) -> Dict[str, int]:
    """按 id 合并导入：新者胜，只增/改不删。返回统计。"""
    stats = {"inserted": 0, "updated": 0, "skipped": 0}
    models = dict(EXPORT_TABLES)

    for name in _IMPORT_ORDER:
        model = models[name]
        rows = data.get(name) or []
        if not isinstance(rows, list):
            continue
        # 已有行查询限定当前用户：撞到他用户的同 id 行时换新 id 插入，
        # 不允许收养/覆盖他人数据
        existing_ids = {r[0] for r in db.query(model.id).filter(model.user_id == user_id).all()}
        for raw in rows:
            if not isinstance(raw, dict) or not raw.get("id"):
                stats["skipped"] += 1
                continue
            row = _coerce_columns(model, raw)
            row["user_id"] = user_id  # 强制归属当前用户
            if row["id"] in existing_ids:
                current = db.query(model).filter(
                    model.id == row["id"],
                    model.user_id == user_id,
                ).first()
                current_ts = _row_to_dict(current) if current else {}
                # 字符串形式的时间戳（ISO）可直接字典序比较
                if _row_timestamp(row) > _row_timestamp(current_ts):
                    for k, v in row.items():
                        setattr(current, k, v)
                    stats["updated"] += 1
                else:
                    stats["skipped"] += 1
            else:
                # id 是主键：与他用户的行冲突时换新 id 插入
                if db.query(model.id).filter(model.id == row["id"]).first():
                    row["id"] = str(uuid.uuid4())
                db.add(model(**row))
                stats["inserted"] += 1
        db.flush()

    # 恢复 content_tags 关联（只补不存在的）
    links = data.get("content_tags") or []
    if isinstance(links, list):
        user_tag_ids = {t[0] for t in db.query(Tag.id).filter(Tag.user_id == user_id).all()}
        for link in links:
            if not isinstance(link, dict):
                continue
            cid, ctype, tid = link.get("content_id"), link.get("content_type"), link.get("tag_id")
            if not (cid and ctype and tid) or tid not in user_tag_ids:
                continue
            exists = db.execute(
                select(content_tags).where(
                    content_tags.c.content_id == cid,
                    content_tags.c.content_type == ctype,
                    content_tags.c.tag_id == tid,
                )
            ).first()
            if not exists:
                db.execute(content_tags.insert().values(
                    content_id=cid, content_type=ctype, tag_id=tid,
                ))
                stats["inserted"] += 1

    db.commit()
    return stats
