from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional as TypingOptional, Dict, Any
from app.core.database import get_db
from app.core.security import verify_password, get_current_user
from app.models.base import (
    User, Note, Capsule, CapsuleDialogue, BrowserClip, KnowledgeUnit,
    Tag, RssFeed, RssEntry, ReadLaterItem, Document,
)
from app.models.sticky_note import StickyNote, Reminder
from app.schemas.user import SettingsUpdate
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os
import json
from datetime import datetime

router = APIRouter()
security = HTTPBearer(auto_error=False)

# Upload directory
UPLOAD_DIR = "uploads/avatars"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB

# settings.ai 中历史遗留的密钥字段：GET 时掩码返回，PUT 时掩码回传不覆盖
API_KEY_FIELDS = ("api_key",)


def _mask_secret(value: Any) -> Any:
    """**** + 后 4 位；太短则全掩码。"""
    if not value or not isinstance(value, str):
        return value
    return f"****{value[-4:]}" if len(value) > 4 else "****"


def _mask_settings_secrets(settings_data: Dict[str, Any]) -> Dict[str, Any]:
    ai = settings_data.get("ai")
    if not isinstance(ai, dict):
        return settings_data
    masked = dict(ai)
    for field in API_KEY_FIELDS:
        if masked.get(field):
            masked[field] = _mask_secret(masked[field])
    return {**settings_data, "ai": masked}


class UserUpdate(BaseModel):
    name: TypingOptional[str] = Field(None, max_length=200, pattern=r'^[a-zA-Z0-9_\u4e00-\u9fff]+$')
    avatar: TypingOptional[str] = Field(None, max_length=2048)
    display_name: TypingOptional[str] = Field(None, max_length=200, pattern=r'^[a-zA-Z0-9_\u4e00-\u9fff]+$')
    username: TypingOptional[str] = Field(None, max_length=200, pattern=r'^[a-zA-Z0-9_\u4e00-\u9fff]+$')


class AccountDeleteRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)
    confirmation: str = Field(..., max_length=100)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128, description="New password (min 8 chars)")


@router.get("/me", summary="Get current user", description="Get the current authenticated user's profile.")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar": current_user.avatar,
        "storage_used": current_user.storage_used,
        "storage_limit": current_user.storage_limit,
        "settings": json.loads(current_user.settings or '{}'),
        "created_at": current_user.created_at,
    }


@router.patch("/me", summary="Update current user", description="Update the current authenticated user's profile.")
async def update_me(
    update_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if update_data.name is not None:
        current_user.name = update_data.name
    if update_data.avatar is not None:
        current_user.avatar = update_data.avatar
    if update_data.display_name is not None:
        current_user.display_name = update_data.display_name
    if update_data.username is not None:
        current_user.username = update_data.username

    db.commit()
    db.refresh(current_user)

    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar": current_user.avatar,
        "updated_at": current_user.updated_at,
    }


@router.post("/me/seed-samples", summary="Seed sample content", description="Insert 1-2 sample items per feature (notes, sticky notes, clips, read-later, knowledge, capsule) for the current user. Entity types that already have content are skipped.")
async def seed_samples(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.sample_data_service import seed_sample_data
    return {"seeded": seed_sample_data(db, current_user.id)}


@router.get("/me/settings", summary="Get user settings", description="Get the current user's settings JSON. Secret fields (API keys) are masked.")
async def get_user_settings(current_user: User = Depends(get_current_user)):
    try:
        settings_data = json.loads(current_user.settings or '{}')
    except json.JSONDecodeError:
        settings_data = {}
    return _mask_settings_secrets(settings_data)


@router.put("/me/settings", summary="Update user settings", description="Partially update user settings. Merges with existing settings. Masked secrets (****...) keep their stored value; empty string clears them.")
async def update_user_settings(
    settings_data: SettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        existing = json.loads(current_user.settings or '{}')
    except json.JSONDecodeError:
        existing = {}

    update_dict = settings_data.model_dump(exclude_unset=True)

    # 密钥字段掩码回传（用户未改动）时保留服务端原值，避免掩码覆盖明文
    incoming_ai = update_dict.get("ai")
    if isinstance(incoming_ai, dict):
        existing_ai = existing.get("ai") or {}
        for field in API_KEY_FIELDS:
            val = incoming_ai.get(field)
            if isinstance(val, str) and val.startswith("****"):
                if existing_ai.get(field):
                    incoming_ai[field] = existing_ai[field]
                else:
                    incoming_ai.pop(field, None)

    for key, value in update_dict.items():
        if value is not None:
            if isinstance(value, dict):
                existing[key] = {**(existing.get(key) or {}), **value}
            else:
                existing[key] = value

    current_user.settings = json.dumps(existing, ensure_ascii=False)
    db.commit()
    db.refresh(current_user)

    return _mask_settings_secrets(existing)


@router.post("/me/avatar", summary="Upload avatar", description="Upload a user avatar image.")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Validate content type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: png, jpg, jpeg, webp")

    # Validate file size (read first chunk to check)
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Max size: 2MB")

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    ext = content_type.split("/")[-1]
    if ext == "jpeg":
        ext = "jpg"
    filename = f"{current_user.id}_{timestamp}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    # Save file
    with open(filepath, "wb") as f:
        f.write(contents)

    # Update user avatar URL
    avatar_url = f"/uploads/avatars/{filename}"
    current_user.avatar = avatar_url
    db.commit()
    db.refresh(current_user)

    return {"avatar_url": avatar_url, "filename": filename}


@router.delete("/me/account", summary="Delete account", description="Soft delete the current user account. Requires password verification and confirmation text.")
async def delete_account(
    request: AccountDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Verify confirmation text（容忍首尾空白、「」引号与「帐/账」异体混用）
    normalized = request.confirmation.strip().strip("「」『』\"'").replace("帐", "账")
    if normalized != "删除我的账户":
        raise HTTPException(status_code=400, detail="确认文字不匹配。请输入「删除我的账户」（不带引号）")

    # Verify password
    if not verify_password(request.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="密码不正确")

    # Soft delete: mark status as deleted
    current_user.status = "deleted"
    current_user.email = f"deleted_{current_user.id}@deleted.local"
    db.commit()

    return {"success": True, "message": "账户已删除"}


def _row_to_dict(row: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    for col in row.__table__.columns:
        val = getattr(row, col.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        data[col.name] = val
    return data


@router.post("/me/export", summary="Export user data", description="Synchronously export the user's content data as a downloadable JSON file.")
async def export_user_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.services.data_transfer_service import export_user_data_dict
    data = export_user_data_dict(db, current_user.id)
    total = sum(len(v) for v in data.values())

    payload = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user": {"id": current_user.id, "email": current_user.email},
        "total_records": total,
        "data": data,
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    filename = f"second-brain-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/me/import", summary="Import user data", description="Merge-import content data produced by /me/export (or an encrypted-sync snapshot). Rows are merged by id; newer updated_at wins; nothing is deleted.")
async def import_user_data_endpoint(
    payload: Dict[str, Any],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.services.data_transfer_service import import_user_data
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="格式不正确：缺少 data 字段")
    stats = import_user_data(db, current_user.id, data)
    return {"success": True, **stats}


@router.delete("/me/data", summary="Clear user data", description="Delete all user-generated content (notes, capsules, clips, knowledge units, sticky notes, reminders, tags, read-later, RSS, documents) while keeping the account intact.")
async def clear_user_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id

    # Delete capsule dialogues for user's capsules first (foreign key on capsule_id)
    capsule_ids = [row[0] for row in db.query(Capsule.id).filter(Capsule.user_id == user_id).all()]
    if capsule_ids:
        db.query(CapsuleDialogue).filter(CapsuleDialogue.capsule_id.in_(capsule_ids)).delete(synchronize_session=False)

    # Delete user content
    db.query(Note).filter(Note.user_id == user_id).delete(synchronize_session=False)
    db.query(Capsule).filter(Capsule.user_id == user_id).delete(synchronize_session=False)
    db.query(BrowserClip).filter(BrowserClip.user_id == user_id).delete(synchronize_session=False)
    db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id).delete(synchronize_session=False)
    db.query(Tag).filter(Tag.user_id == user_id).delete(synchronize_session=False)
    db.query(StickyNote).filter(StickyNote.user_id == user_id).delete(synchronize_session=False)
    db.query(Reminder).filter(Reminder.user_id == user_id).delete(synchronize_session=False)
    db.query(ReadLaterItem).filter(ReadLaterItem.user_id == user_id).delete(synchronize_session=False)
    db.query(Document).filter(Document.user_id == user_id).delete(synchronize_session=False)
    db.query(RssEntry).filter(RssEntry.user_id == user_id).delete(synchronize_session=False)
    db.query(RssFeed).filter(RssFeed.user_id == user_id).delete(synchronize_session=False)

    # Reset storage usage
    current_user.storage_used = 0

    db.commit()

    return {
        "success": True,
        "message": "所有数据已清除",
        "cleared": {
            "notes": True,
            "capsules": True,
            "clips": True,
            "knowledge": True,
            "tags": True,
            "sticky_notes": True,
            "reminders": True,
            "read_later": True,
            "documents": True,
            "rss": True,
        },
    }
