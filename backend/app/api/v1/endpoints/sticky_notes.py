from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime, timedelta
from typing import Optional, List
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
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
    query = db.query(StickyNote).filter(StickyNote.user_id == current_user.id)
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
    note = StickyNote(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
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
    note = db.query(StickyNote).filter(StickyNote.id == note_id, StickyNote.user_id == current_user.id).first()
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
    note = db.query(StickyNote).filter(StickyNote.id == note_id, StickyNote.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="便签不存在")
    db.delete(note)
    db.commit()
    return None


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
    query = db.query(Reminder).filter(Reminder.user_id == current_user.id)
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
    reminder = Reminder(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
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
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id, Reminder.user_id == current_user.id).first()
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
