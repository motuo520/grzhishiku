import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Optional
from datetime import datetime, timedelta
import asyncio
import uuid
import json

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_note_input
from app.services.quota_service import QuotaService
from app.models.base import User, Note, Tag, Folder, content_tags
from app.schemas.note import NoteCreate, NoteUpdate, NoteResponse
from pydantic import BaseModel as PydanticBaseModel

class BatchNoteCreate(PydanticBaseModel):
    items: List[NoteCreate]

class BatchNoteDelete(PydanticBaseModel):
    ids: List[str]

class BatchCreateResult(PydanticBaseModel):
    success_count: int
    failed_count: int
    failures: List[dict] = []
    items: List[NoteResponse] = []
    # 防重：同用户 active 且标题+正文完全一致的条目跳过
    skipped_count: int = 0
    skipped: List[dict] = []
from app.schemas.tag import TagItem
from app.api.v1.endpoints.graph import auto_link_note
from app.api.v1.endpoints.folders import validate_folder_assignment
from app.services import tag_service
from app.utils.search import build_search_filter

router = APIRouter()

logger = logging.getLogger(__name__)


async def _auto_link_note_async(db: Session, note: Note, user_id: str) -> None:
    """auto_link_note 是同步的全表扫描（O(N)），用线程池卸载避免阻塞事件循环。"""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, auto_link_note, db, note, user_id)


def _get_note_tags(db: Session, note_id: str) -> List[TagItem]:
    """Get associated tags for a note."""
    return tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_NOTE, note_id)


def _set_note_tags(db: Session, note_id: str, user_id: str, tag_inputs: Optional[List[str]]) -> None:
    """
    Associate tags with a note. tag_inputs can be tag IDs or tag names.
    Creates new tags automatically for names that don't exist.
    """
    tag_service.set_tags_for(
        db,
        content_type=tag_service.CONTENT_TYPE_NOTE,
        content_id=note_id,
        user_id=user_id,
        tag_inputs=tag_inputs,
    )


def _sync_capsule_refs(note: Note, db: Session) -> None:
    """Keep capsule_refs in sync with content_tags for backward compatibility."""
    tags = _get_note_tags(db, note.id)
    tag_names = [t.name for t in tags]
    note.capsule_refs = json.dumps(tag_names, ensure_ascii=False) if tag_names else None


def _build_note_response(note: Note, db: Session) -> dict:
    tags = _get_note_tags(db, note.id)
    try:
        attached_practice_ids = json.loads(note.attached_practice_ids or '[]') if note.attached_practice_ids else []
    except json.JSONDecodeError:
        attached_practice_ids = []
    return {
        "id": note.id,
        "user_id": note.user_id,
        "brain_side": note.brain_side,
        "title": note.title,
        "content": note.content,
        "content_format": note.content_format or "markdown",
        "tags": tags,
        "origin_type": note.origin_type or "self_practice",
        "invoke_count": note.invoke_count or 0,
        "last_invoked_at": note.last_invoked_at,
        "practice_depth": note.practice_depth or 0,
        "personal_relevance_score": note.personal_relevance_score if note.personal_relevance_score is not None else 0.5,
        "evolution_stage": note.evolution_stage or "collected",
        "attached_practice_ids": attached_practice_ids,
        "pipeline_stage": note.pipeline_stage or "raw",
        "folder_id": note.folder_id,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


@router.get("/", response_model=List[NoteResponse], summary="List notes", description="Get all notes for the current user with pagination, search, sorting, and tag filtering.")
async def list_notes(
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(20, ge=1, le=1000),
    sort_by: str = Query("created_at", pattern="^(created_at|updated_at|title)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    q: Optional[str] = Query(None, description="Search in title or content"),
    tag_ids: Optional[str] = Query(None, description="Filter by comma-separated tag IDs"),
    brain_side: Optional[str] = Query(None, description="Filter by brain side: personal / network / both"),
    folder_id: Optional[str] = Query(None, description="Filter by folder id; 'none' = 未归档"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Note).filter(Note.user_id == current_user.id, Note.status == "active")
    # 带 folder_id 过滤时脑侧由文件夹归属规则约束（夹内笔记天然脑侧兼容），不再做严格等值过滤
    if brain_side and brain_side != "both" and not folder_id:
        query = query.filter(Note.brain_side == brain_side)

    if folder_id == "none":
        # 未归档（按查看脑 P）：note.brain_side ∈ {P,'both'} 且（folder_id 为空 或 文件夹不属 P 脑）
        p = brain_side if brain_side in ("personal", "network") else "personal"
        own_folder_ids = db.query(Folder.id).filter(
            Folder.user_id == current_user.id, Folder.brain_side == p
        )
        query = query.filter(Note.brain_side.in_([p, "both"]))
        query = query.filter(or_(Note.folder_id.is_(None), ~Note.folder_id.in_(own_folder_ids)))
    elif folder_id:
        query = query.filter(Note.folder_id == folder_id)
    
    if q:
        # 中文长句无空格分词，整串 ilike 之外加 bigram 命中比例兜底（BUG-N01）
        query = query.filter(build_search_filter(q, Note.title, Note.content))
    
    if tag_ids:
        tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if tag_id_list:
            query = query.join(
                content_tags,
                and_(
                    content_tags.c.content_id == Note.id,
                    content_tags.c.content_type == "note",
                    content_tags.c.tag_id.in_(tag_id_list)
                )
            ).distinct()
    
    sort_column = getattr(Note, sort_by, Note.created_at)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())
    
    notes = query.offset(skip).limit(limit).all()
    return [_build_note_response(n, db) for n in notes]


@router.post("/", response_model=NoteResponse, status_code=status.HTTP_201_CREATED, summary="Create note", description="Create a new note for the current user.")
async def create_note(
    note_data: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    quota = QuotaService(db)
    safe_title, safe_content = sanitize_note_input(note_data.title, note_data.content)
    additional_bytes = quota.estimate_storage_bytes(safe_title or "") + quota.estimate_storage_bytes(safe_content or "")

    note = Note(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=note_data.brain_side,
        title=safe_title,
        content=safe_content,
        content_format="markdown",
        status="active",
        origin_type=note_data.origin_type.value if note_data.origin_type else "self_practice",
        practice_depth=note_data.practice_depth if note_data.practice_depth is not None else 0,
        personal_relevance_score=note_data.personal_relevance_score if note_data.personal_relevance_score is not None else 0.5,
        evolution_stage=note_data.evolution_stage.value if note_data.evolution_stage else "collected",
        pipeline_stage=note_data.pipeline_stage.value if note_data.pipeline_stage else "raw",
        attached_practice_ids='[]',
    )
    if note_data.folder_id:
        validate_folder_assignment(db, current_user.id, note_data.brain_side, note_data.folder_id)
        note.folder_id = note_data.folder_id
    db.add(note)
    db.flush()

    quota.record_storage_add(current_user.id, additional_bytes)

    _set_note_tags(db, note.id, current_user.id, note_data.tags)
    _sync_capsule_refs(note, db)

    # Auto-link graph edges
    try:
        await _auto_link_note_async(db, note, current_user.id)
    except Exception as e:
        # Non-blocking: don't fail note creation if auto-link fails
        logger.warning(f"Auto-link failed for note {note.id}: {e}")

    # 统一事务提交，避免部分成功留脏数据
    db.commit()
    db.refresh(note)

    return _build_note_response(note, db)


@router.get("/{note_id}", response_model=NoteResponse, summary="Get note", description="Get a specific note by ID.")
async def get_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id, Note.status == "active").first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    # Opening a note counts as an invocation ("调用") signal.
    # Debounced: re-opens within 30 minutes don't re-count (avoids refocus/refetch inflation).
    now = datetime.now()
    if not note.last_invoked_at or (now - note.last_invoked_at) > timedelta(minutes=30):
        note.invoke_count = (note.invoke_count or 0) + 1
        note.last_invoked_at = now
        db.commit()
    return _build_note_response(note, db)


@router.put("/{note_id}", response_model=NoteResponse, summary="Update note", description="Update a note by ID.")
async def update_note(
    note_id: str,
    note_data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id, Note.status == "active").first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    if note_data.title is not None:
        note.title = sanitize_note_input(note_data.title, None)[0]
    if note_data.content is not None:
        note.content = sanitize_note_input(None, note_data.content)[1]
    if note_data.brain_side is not None:
        note.brain_side = note_data.brain_side
    if note_data.origin_type is not None:
        note.origin_type = note_data.origin_type.value
    if note_data.practice_depth is not None:
        note.practice_depth = note_data.practice_depth
    if note_data.personal_relevance_score is not None:
        note.personal_relevance_score = note_data.personal_relevance_score
    if note_data.evolution_stage is not None:
        note.evolution_stage = note_data.evolution_stage.value
    if note_data.pipeline_stage is not None:
        note.pipeline_stage = note_data.pipeline_stage.value
    if note_data.tags is not None:
        _set_note_tags(db, note_id, current_user.id, note_data.tags)
        _sync_capsule_refs(note, db)
    # folder_id 显式传了才处理（含显式 null = 移出文件夹，未归档）
    if "folder_id" in note_data.model_fields_set:
        if note_data.folder_id is not None:
            target_brain = note_data.brain_side if note_data.brain_side is not None else note.brain_side
            validate_folder_assignment(db, current_user.id, target_brain, note_data.folder_id)
        note.folder_id = note_data.folder_id
    elif note_data.brain_side is not None and note.folder_id:
        # 单改脑侧的兜底：既有文件夹与新脑侧不兼容时自动移出（未归档），不留跨脑脏数据
        folder = db.query(Folder).filter(Folder.id == note.folder_id).first()
        if folder and note.brain_side != "both" and folder.brain_side != note.brain_side:
            note.folder_id = None

    note.updated_at = datetime.now()
    db.commit()
    db.refresh(note)
    
    # Re-compute auto links after update
    try:
        await _auto_link_note_async(db, note, current_user.id)
        db.commit()
    except Exception as e:
        logger.warning(f"Auto-link failed for note {note.id}: {e}")
    
    return _build_note_response(note, db)


@router.patch("/{note_id}", response_model=NoteResponse, summary="Partial update note", description="Partially update a note by ID.")
async def patch_note(
    note_id: str,
    note_data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return await update_note(note_id, note_data, db, current_user)


@router.delete("/batch", response_model=dict, summary="Batch delete notes", description="Soft-delete multiple notes by IDs.")
async def batch_delete_notes(
    request: BatchNoteDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    deleted = 0
    for note_id in request.ids:
        note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id, Note.status == "active").first()
        if note:
            note.status = "deleted"
            db.execute(
                content_tags.delete().where(
                    and_(
                        content_tags.c.content_id == note_id,
                        content_tags.c.content_type == "note"
                    )
                )
            )
            deleted += 1
    db.commit()
    return {"success": True, "deleted_count": deleted}


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete note", description="Soft-delete a note by setting status to deleted.")
async def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id, Note.status == "active").first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    note.status = "deleted"
    
    # Remove tag associations
    db.execute(
        content_tags.delete().where(
            and_(
                content_tags.c.content_id == note_id,
                content_tags.c.content_type == "note"
            )
        )
    )

    # Remove graph edges referencing this note (avoid phantom nodes)
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, note_id)

    db.commit()
    return None


@router.post("/batch", response_model=BatchCreateResult, summary="Batch create notes", description="Create multiple notes in a single request.")
async def batch_create_notes(
    batch: BatchNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    created = []
    failures = []
    skipped = []
    # 防重：同用户 active 笔记按（标题+正文）完全一致判重，批量导入同一份文件两次不产生重复
    existing_pairs = {
        (t, c) for t, c in db.query(Note.title, Note.content).filter(
            Note.user_id == current_user.id, Note.status == "active"
        ).all()
    }
    for index, note_data in enumerate(batch.items):
        try:
            safe_title, safe_content = sanitize_note_input(note_data.title, note_data.content)
            if (safe_title, safe_content) in existing_pairs:
                skipped.append({"index": index, "title": note_data.title, "reason": "已存在相同内容，跳过"})
                continue
            note = Note(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                brain_side=note_data.brain_side,
                title=safe_title,
                content=safe_content,
                content_format="markdown",
                status="active",
                origin_type=note_data.origin_type.value if note_data.origin_type else "self_practice",
                practice_depth=note_data.practice_depth if note_data.practice_depth is not None else 0,
                personal_relevance_score=note_data.personal_relevance_score if note_data.personal_relevance_score is not None else 0.5,
                evolution_stage=note_data.evolution_stage.value if note_data.evolution_stage else "collected",
                pipeline_stage=note_data.pipeline_stage.value if note_data.pipeline_stage else "raw",
                attached_practice_ids='[]',
            )
            db.add(note)
            db.flush()
            _set_note_tags(db, note.id, current_user.id, note_data.tags)
            _sync_capsule_refs(note, db)
            db.flush()
            try:
                await _auto_link_note_async(db, note, current_user.id)
            except Exception as e:
                logger.warning(f"Auto-link failed for note {note.id}: {e}")
            db.refresh(note)
            created.append(_build_note_response(note, db))
            existing_pairs.add((safe_title, safe_content))  # 批内防重
        except Exception as e:
            failures.append({"index": index, "title": note_data.title, "reason": str(e)})
    
    db.commit()
    return {
        "success_count": len(created),
        "failed_count": len(failures),
        "failures": failures,
        "items": created,
        "skipped_count": len(skipped),
        "skipped": skipped,
    }

