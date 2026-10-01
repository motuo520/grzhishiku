from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime, timedelta
from typing import Optional, List
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.tenant_scope import get_active_tenant, content_filter
from app.models.base import User
from app.models.sticky_note import StickyNote, Reminder
from app.schemas.sticky_note import (
    StickyNoteCreate, StickyNoteUpdate, StickyNoteOut, StickyNoteList,
    ReminderCreate, ReminderUpdate, ReminderOut, ReminderList, UpcomingReminder,
)

router = APIRouter()


# ---------- Sticky Notes ----------

def _sticky_response(note: StickyNote) -> dict:
    return {
        "id": note.id,
        "user_id": note.user_id,
        "content": note.content,
        "color": note.color,
        "position_x": note.position_x,
        "position_y": note.position_y,
        "width": note.width,
        "height": note.height,
        "is_pinned": note.is_pinned,
        "is_archived": note.is_archived,
        "remind_at": note.remind_at,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


@router.get("/sticky-notes/", response_model=StickyNoteList, summary="List sticky notes")
async def list_sticky_notes(
    include_archived: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = content_filter(db.query(StickyNote), StickyNote, current_user, get_active_tenant(db, current_user))
    if not include_archived:
        query = query.filter(StickyNote.is_archived == False)
    total = query.count()
    notes = query.order_by(desc(StickyNote.is_pinned), desc(StickyNote.updated_at)).all()
    return {"total": total, "notes": [_sticky_response(n) for n in notes]}


@router.post("/sticky-notes/", response_model=StickyNoteOut, status_code=status.HTTP_201_CREATED, summary="Create sticky note")
async def create_sticky_note(
    data: StickyNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    note = StickyNote(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
        tenant_id=tenant.id if tenant else None,
        content=data.content.strip(),
        color=data.color or "#f59e0b",
        position_x=data.position_x or 0,
        position_y=data.position_y or 0,
        width=data.width or 240,
        height=data.height or 180,
        is_pinned=data.is_pinned or False,
        remind_at=data.remind_at,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _sticky_response(note)


@router.patch("/sticky-notes/{note_id}", response_model=StickyNoteOut, summary="Update sticky note")
async def update_sticky_note(
    note_id: str,
    data: StickyNoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = content_filter(db.query(StickyNote).filter(StickyNote.id == note_id), StickyNote, current_user, get_active_tenant(db, current_user)).first()
    if not note:
        raise HTTPException(status_code=404, detail="便签不存在")

    updates = data.model_dump(exclude_unset=True)
    if "content" in updates:
        updates["content"] = updates["content"].strip()
    for key, value in updates.items():
        setattr(note, key, value)

    db.commit()
    db.refresh(note)
    return _sticky_response(note)


@router.delete("/sticky-notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete sticky note")
async def delete_sticky_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = content_filter(db.query(StickyNote).filter(StickyNote.id == note_id), StickyNote, current_user, get_active_tenant(db, current_user)).first()
    if not note:
        raise HTTPException(status_code=404, detail="便签不存在")
    db.delete(note)
    db.commit()
    return None


@router.post("/sticky-notes/{note_id}/convert-to-note", summary="Convert sticky note to note",
             description="把便签转正为笔记（个人脑、raw 管线），原便签归档保留（可恢复）。配额/记账与 create_note 同口径。")
async def convert_sticky_to_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.base import Note
    from app.core.xss_sanitizer import sanitize_note_input
    from app.core.feature_guard import FeatureGuard
    from app.core.tenant_scope import audit as _audit
    from app.services.quota_service import QuotaService
    from app.api.v1.endpoints.graph import queue_auto_link
    from sqlalchemy import func as _func

    tenant = get_active_tenant(db, current_user)
    sticky = content_filter(
        db.query(StickyNote).filter(StickyNote.id == note_id),
        StickyNote, current_user, tenant,
    ).first()
    if not sticky:
        raise HTTPException(status_code=404, detail="便签不存在")

    # 与 create_note 同口径：条数护栏 + 存储配额先查后写（用户行锁防竞态）
    guard = FeatureGuard(db, current_user)
    db.query(User).filter(User.id == current_user.id).with_for_update().one()
    note_count = db.query(_func.count(Note.id)).filter(
        Note.user_id == current_user.id, Note.status == "active"
    ).scalar() or 0
    guard.check_limit("notes", note_count)

    raw_content = (sticky.content or "").strip()
    if not raw_content:
        raise HTTPException(status_code=400, detail="便签内容为空，无法转为笔记")
    # 标题取首行前 30 字（便签无标题字段）
    raw_title = raw_content.splitlines()[0][:30].strip() or "便签转笔记"
    safe_title, safe_content = sanitize_note_input(raw_title, raw_content)
    quota = QuotaService(db)
    additional_bytes = quota.estimate_storage_bytes(safe_title) + quota.estimate_storage_bytes(safe_content)
    quota.check_storage_before_create(current_user.id, additional_bytes)

    note = Note(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        tenant_id=sticky.tenant_id,
        brain_side="personal",
        title=safe_title,
        content=safe_content,
        content_format="markdown",
        status="active",
        origin_type="self_practice",
        pipeline_stage="raw",
        attached_practice_ids='[]',
    )
    db.add(note)
    # 转正后原便签归档（不删，留恢复路径；默认列表不再显示）
    sticky.is_archived = True
    if tenant:
        _audit(db, tenant.id, current_user, "content_create", "note", note.id, safe_title)
    db.commit()
    db.refresh(note)

    quota.record_storage_add(current_user.id, additional_bytes)
    # Auto-link graph edges（后台队列+防抖，与 create_note 同链路）
    queue_auto_link("note", note.id, current_user.id, db)
    return {"note_id": note.id}


# ---------- Reminders ----------

def _reminder_response(r: Reminder) -> dict:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "title": r.title,
        "content": r.content,
        "remind_at": r.remind_at,
        "is_completed": r.is_completed,
        "source": r.source,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


@router.get("/reminders/", response_model=ReminderList, summary="List reminders")
async def list_reminders(
    include_completed: bool = Query(False),
    upcoming_hours: Optional[int] = Query(None, ge=1, le=168),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = content_filter(db.query(Reminder), Reminder, current_user, get_active_tenant(db, current_user))
    if not include_completed:
        query = query.filter(Reminder.is_completed == False)
    if upcoming_hours:
        deadline = datetime.utcnow() + timedelta(hours=upcoming_hours)
        query = query.filter(Reminder.remind_at <= deadline)
    total = query.count()
    reminders = query.order_by(Reminder.remind_at).all()
    return {"total": total, "reminders": [_reminder_response(r) for r in reminders]}


@router.post("/reminders/", response_model=ReminderOut, status_code=status.HTTP_201_CREATED, summary="Create reminder")
async def create_reminder(
    data: ReminderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    reminder = Reminder(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
        tenant_id=tenant.id if tenant else None,
        title=data.title.strip(),
        content=data.content.strip() if data.content else None,
        remind_at=data.remind_at,
        source=data.source or "mascot",
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return _reminder_response(reminder)


@router.patch("/reminders/{reminder_id}", response_model=ReminderOut, summary="Update reminder")
async def update_reminder(
    reminder_id: str,
    data: ReminderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    reminder = content_filter(db.query(Reminder).filter(Reminder.id == reminder_id), Reminder, current_user, get_active_tenant(db, current_user)).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="提醒不存在")

    updates = data.model_dump(exclude_unset=True)
    if "title" in updates:
        updates["title"] = updates["title"].strip()
    if "content" in updates and updates["content"]:
        updates["content"] = updates["content"].strip()
    for key, value in updates.items():
        setattr(reminder, key, value)

    db.commit()
    db.refresh(reminder)
    return _reminder_response(reminder)


@router.delete("/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete reminder")
async def delete_reminder(
    reminder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == current_user.id).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="提醒不存在")
    db.delete(reminder)
    db.commit()
    return None


@router.get("/reminders/upcoming", response_model=List[UpcomingReminder], summary="Get upcoming reminders")
async def get_upcoming_reminders(
    minutes: int = Query(15, ge=1, le=1440),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    deadline = now + timedelta(minutes=minutes)
    reminders = (
        db.query(Reminder)
        .filter(
            Reminder.user_id == current_user.id,
            Reminder.is_completed == False,
            Reminder.remind_at <= deadline,
            Reminder.remind_at >= now - timedelta(minutes=5),
        )
        .order_by(Reminder.remind_at)
        .all()
    )
    return [
        {
            "id": r.id,
            "title": r.title,
            "content": r.content,
            "remind_at": r.remind_at,
            "source": r.source,
        }
        for r in reminders
    ]
