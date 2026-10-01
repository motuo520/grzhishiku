from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
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
MAX_EXPORT_RECORDS = 200_000
MAX_IMPORT_RECORDS = 50_000

# settings.ai 中的密钥字段：GET 时掩码返回，PUT 时掩码回传不覆盖
# 09-05 补齐：原表只有 4 个字段，glm/dashscope/openai/anthropic/google 五家
# 的 key 在 /users/me 明文返回（裸奔实捕）；byok_keys 整个字典逐值掩码
API_KEY_FIELDS = (
    "kimi_api_key", "deepseek_api_key", "opencode_api_key", "api_key",
    "glm_api_key", "dashscope_api_key", "openai_api_key", "anthropic_api_key", "google_api_key",
)


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
    # BYOK 预设目录新供应商的 key 字典：逐值掩码
    byok_keys = masked.get("byok_keys")
    if isinstance(byok_keys, dict):
        masked["byok_keys"] = {k: _mask_secret(v) for k, v in byok_keys.items()}
    return {**settings_data, "ai": masked}


def _detect_image_ext(data: bytes) -> TypingOptional[str]:
    """按文件头魔数识别真实图片类型，不信任客户端 Content-Type。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


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
async def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # is_admin：邮箱在 admin_users 且为 active。用于前端按身份隐藏管理向配置
    #（如云端的 API Key 配置），与 /admin 体系共用一份管理员名单。
    from app.models.admin import AdminUser
    is_admin = db.query(AdminUser).filter(
        AdminUser.email == current_user.email,
        AdminUser.status == "active",
    ).first() is not None
    try:
        settings_data = json.loads(current_user.settings or '{}')
        if not isinstance(settings_data, dict):
            settings_data = {}
    except json.JSONDecodeError:
        settings_data = {}
    # 开源本地版：无套餐概念，储存限额直接用 user.storage_limit
    storage_limit = current_user.storage_limit
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar": current_user.avatar,
        "subscription_tier": current_user.subscription_tier,
        "subscription_status": current_user.subscription_status,
        "storage_used": current_user.storage_used,
        "storage_limit": storage_limit,
        "settings": _mask_settings_secrets(settings_data),
        "is_admin": is_admin,
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
        if update_data.username != current_user.username:
            exists = db.query(User.id).filter(
                User.username == update_data.username,
                User.id != current_user.id,
            ).first()
            if exists:
                raise HTTPException(status_code=409, detail="用户名已被占用")
        current_user.username = update_data.username

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="用户名已被占用")
    db.refresh(current_user)

    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar": current_user.avatar,
        "subscription_tier": current_user.subscription_tier,
        "updated_at": current_user.updated_at,
    }


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
        # byok_keys 字典逐值同样处理（掩码=未改动，保留原值）
        inc_keys = incoming_ai.get("byok_keys")
        if isinstance(inc_keys, dict):
            old_keys = existing_ai.get("byok_keys") or {}
            for k, v in list(inc_keys.items()):
                if isinstance(v, str) and v.startswith("****"):
                    if old_keys.get(k):
                        inc_keys[k] = old_keys[k]
                    else:
                        inc_keys.pop(k, None)

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
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: png, jpg, jpeg, webp")

    # 分块读取并提前中止超大请求，避免整包进内存
    chunks = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        if len(chunks) + len(chunk) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large. Max size: 2MB")
        chunks.extend(chunk)
    contents = bytes(chunks)

    # 按魔数校验真实类型，防伪造图片伪装
    detected_ext = _detect_image_ext(contents)
    declared_ext = content_type.split("/")[-1]
    if declared_ext == "jpeg":
        declared_ext = "jpg"
    if not detected_ext or detected_ext != declared_ext:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: png, jpg, jpeg, webp")

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    ext = detected_ext
    filename = f"{current_user.id}_{timestamp}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    # Save file
    with open(filepath, "wb") as f:
        f.write(contents)

    # Update user avatar URL
    avatar_url = f"/uploads/avatars/{filename}"
    old_avatar = current_user.avatar
    current_user.avatar = avatar_url
    db.commit()
    db.refresh(current_user)

    # 删除旧头像，避免磁盘泄漏
    if old_avatar and old_avatar.startswith("/uploads/avatars/"):
        old_filename = os.path.basename(old_avatar.split("?")[0])
        if old_filename and old_filename != filename:
            old_path = os.path.join(UPLOAD_DIR, old_filename)
            if os.path.isfile(old_path):
                try:
                    os.remove(old_path)
                except OSError:
                    pass

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

    # BUG-Y06：注销不能只软删用户行——其 notes/clips/knowledge 等内容全留库。
    # 先硬删该用户全部内容（与 /me/data 同一口径），再软删账号主体。
    user_id = current_user.id
    _delete_user_content(db, user_id)

    # 账号级关联（云端绑定/同步设备/租户成员）只随注销清，/me/data 保留
    from app.models.base import CloudBinding, TenantMember
    from app.models.sync import SyncDevice
    for model in (CloudBinding, SyncDevice, TenantMember):
        db.query(model).filter(model.user_id == user_id).delete(synchronize_session=False)

    # Soft delete: mark status as deleted
    current_user.status = "deleted"
    current_user.email = f"deleted_{current_user.id}@deleted.local"
    # settings JSON 里有 BYOK API key 明文，注销必须抹掉
    current_user.settings = "{}"
    db.commit()

    return {"success": True, "message": "账户已删除"}


def _delete_user_content(db: Session, user_id: str) -> None:
    """硬删一个用户的全部内容数据（不提交事务，由调用方统一 commit）。

    覆盖：内容表（notes/capsules/clips/knowledge/sticky_notes/reminders/
    read_later/documents/rss）、标签及其关联（content_tags）、向量
    （embeddings）、聊天会话与消息（chat_conversations/chat_messages）、
    注意力/认知/涌现/图谱/知识流水线等功能数据、邮件与社媒账号消息、
    社区帖子、支持工单及回复、云备份数据（data_packages/user_cloud_drives/
    sync_operations/sync_snapshots）。
    不碰：账务类（payments/subscriptions/balances/usage_records/invoices，
    保账）与账号级关联（cloud_bindings/sync_devices/tenant_members，仅注销时清）。
    企业版口径：团队内容（tenant_id 非空）归属团队，一律不随个人注销/清数据删除
    （带 tenant_id 列的表统一追加 tenant_id IS NULL 条件）。
    删除顺序考虑外键：先删依赖子表（dialogues/email 消息/content_tags/
    chat_messages/工单回复），再删主表。
    """
    def _personal(model):
        # 团队内容留团队；无 tenant_id 列的表无此概念，恒 True
        return model.tenant_id.is_(None) if hasattr(model, "tenant_id") else True

    # --- 先收集内容 id（主表删除后就查不到了），用于清 content_tags 关联（仅个人内容） ---
    note_ids = db.query(Note.id).filter(Note.user_id == user_id, _personal(Note)).all()
    clip_ids = db.query(BrowserClip.id).filter(BrowserClip.user_id == user_id, _personal(BrowserClip)).all()
    knowledge_ids = db.query(KnowledgeUnit.id).filter(KnowledgeUnit.user_id == user_id, _personal(KnowledgeUnit)).all()
    tag_ids = db.query(Tag.id).filter(Tag.user_id == user_id, _personal(Tag)).all()

    # Delete capsule dialogues for user's capsules first (foreign key on capsule_id)
    capsule_id_subq = db.query(Capsule.id).filter(Capsule.user_id == user_id, _personal(Capsule)).subquery()
    db.query(CapsuleDialogue).filter(
        CapsuleDialogue.capsule_id.in_(capsule_id_subq.select())
    ).delete(synchronize_session=False)

    # 邮件账号与消息全量清（含邮箱凭据；原实现只删关联了知识单元的消息，残留严重）
    from app.models.messaging import EmailAccount, EmailMessage, SocialAccount, SocialMessage
    db.query(EmailMessage).filter(EmailMessage.user_id == user_id).delete(synchronize_session=False)
    db.query(EmailAccount).filter(EmailAccount.user_id == user_id).delete(synchronize_session=False)
    db.query(SocialMessage).filter(SocialMessage.user_id == user_id).delete(synchronize_session=False)
    db.query(SocialAccount).filter(SocialAccount.user_id == user_id).delete(synchronize_session=False)

    # 聊天消息 -> 会话（外键：chat_messages.conversation_id）
    # 双空间口径下对话不分空间全删：会话始终是创建者私有（team 空间建的会话
    # 其他成员从来不可见），人走了留在团队里没有意义，也不会造成团队侧可见性残留
    from app.models.chat import ChatConversation, ChatMessage
    conv_id_subq = db.query(ChatConversation.id).filter(ChatConversation.user_id == user_id).subquery()
    db.query(ChatMessage).filter(
        ChatMessage.conversation_id.in_(conv_id_subq.select())
    ).delete(synchronize_session=False)
    db.query(ChatConversation).filter(ChatConversation.user_id == user_id).delete(synchronize_session=False)

    # 标签关联（content_tags.tag_id 外键指向 tags，必须先于 tags 删除；
    # 同时按内容 id 清掉指向该用户笔记/剪藏/知识单元的关联行）
    from app.models.base import content_tags, Embedding
    from sqlalchemy import or_ as _or
    ct_conditions = []
    for ids, ctype in ((note_ids, "note"), (clip_ids, "clip"), (knowledge_ids, "knowledge")):
        id_list = [row[0] for row in ids]
        if id_list:
            ct_conditions.append(
                (content_tags.c.content_type == ctype) & content_tags.c.content_id.in_(id_list)
            )
    tag_id_list = [row[0] for row in tag_ids]
    if tag_id_list:
        ct_conditions.append(content_tags.c.tag_id.in_(tag_id_list))
    if ct_conditions:
        db.execute(content_tags.delete().where(_or(*ct_conditions)))

    # 向量（按 user_id 归属，含块向量）；开源版无 vec_index 影子索引（剥离面）
    db.query(Embedding).filter(Embedding.user_id == user_id).delete(synchronize_session=False)

    # Delete user content（团队内容留团队，不随个人删）
    db.query(Note).filter(Note.user_id == user_id, _personal(Note)).delete(synchronize_session=False)
    db.query(Capsule).filter(Capsule.user_id == user_id, _personal(Capsule)).delete(synchronize_session=False)
    db.query(BrowserClip).filter(BrowserClip.user_id == user_id, _personal(BrowserClip)).delete(synchronize_session=False)
    db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id, _personal(KnowledgeUnit)).delete(synchronize_session=False)
    db.query(Tag).filter(Tag.user_id == user_id, _personal(Tag)).delete(synchronize_session=False)
    db.query(StickyNote).filter(StickyNote.user_id == user_id).delete(synchronize_session=False)
    db.query(Reminder).filter(Reminder.user_id == user_id).delete(synchronize_session=False)
    db.query(ReadLaterItem).filter(ReadLaterItem.user_id == user_id).delete(synchronize_session=False)
    db.query(Document).filter(Document.user_id == user_id).delete(synchronize_session=False)
    db.query(RssEntry).filter(RssEntry.user_id == user_id).delete(synchronize_session=False)
    db.query(RssFeed).filter(RssFeed.user_id == user_id).delete(synchronize_session=False)

    # --- 功能数据与各模块残留（08-16 补：原实现只删核心内容表，以下全漏）---
    from app.models import base as _m
    from app.models.community import CommunityPost
    from app.models.storage import DataPackage, UserCloudDrive
    from app.models.sync import SyncOperation, SyncSnapshot

    # 支持工单：先删回复（含管理员回复，ticket_id 外键），再删工单
    ticket_id_subq = db.query(_m.SupportTicket.id).filter(_m.SupportTicket.user_id == user_id).subquery()
    db.query(_m.SupportTicketReply).filter(
        _m.SupportTicketReply.ticket_id.in_(ticket_id_subq.select())
    ).delete(synchronize_session=False)

    feature_models = [
        # 注意力/深工
        _m.AttentionActivity, _m.AttentionCategory, _m.AttentionGuardianRule,
        _m.AttentionRation, _m.DeepWorkSession,
        # 认知
        _m.BiasDetectionRecord, _m.DecisionAudit, _m.FutureSimulation,
        _m.CognitiveChallenge, _m.CognitiveWeeklyReport,
        # 涌现/图谱
        _m.EmergenceResult, _m.EmergenceIdea, _m.EmergenceCanvas,
        _m.GraphEdge, _m.GraphBuildState,
        # 知识流水线与回顾
        _m.PracticeRecord, _m.PipelineTransition, _m.DailyReview, _m.ContextGuide,
        _m.ExperimentLog, _m.DepthCheckLog, _m.EvolutionReflection,
        # 社区/支持/云备份数据
        CommunityPost, _m.SupportTicket, _m.Folder,
        DataPackage, UserCloudDrive, SyncOperation, SyncSnapshot,
    ]
    for model in feature_models:
        # 带 tenant_id 列的表：团队内容留团队，不随个人注销删
        # graph_build_state 特例：个人空间行 tenant_id 用 '' 占位（复合主键不允许
        # NULL 判重，见 models/graph_build.py），IS NULL 匹配不到会让个人构建状态漏删
        personal_cond = (model.tenant_id == "") if model is _m.GraphBuildState else _personal(model)
        db.query(model).filter(model.user_id == user_id, personal_cond).delete(synchronize_session=False)


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
    from app.core.tenant_scope import get_active_tenant, scope_condition
    user_id = current_user.id
    # 导出限当前空间：团队空间导团队内容，个人空间只导本人 tenant_id 为空的行
    tenant = get_active_tenant(db, current_user)
    # 导出前条数预检，避免大数据量同步导出 OOM/长阻塞
    precheck_total = 0
    for model in (
        Note, Capsule, BrowserClip, KnowledgeUnit, Tag, StickyNote,
        Reminder, ReadLaterItem, Document, RssEntry, RssFeed,
    ):
        precheck_total += db.query(model.id).filter(scope_condition(model, user_id, tenant)).count()
    precheck_total += (
        db.query(CapsuleDialogue)
        .join(Capsule, CapsuleDialogue.capsule_id == Capsule.id)
        .filter(scope_condition(Capsule, user_id, tenant))
        .count()
    )
    if precheck_total > MAX_EXPORT_RECORDS:
        raise HTTPException(status_code=400, detail="导出数据量过大，请清理后重试")

    data = export_user_data_dict(db, current_user.id, tenant)
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
    # 导入结构与规模预检，防数据污染/DoS
    total_rows = 0
    for key, rows in data.items():
        if not isinstance(rows, list):
            raise HTTPException(status_code=400, detail=f"格式不正确：data.{key} 应为数组")
        total_rows += len(rows)
        if total_rows > MAX_IMPORT_RECORDS:
            raise HTTPException(status_code=400, detail="导入数据量过大，请分批导入")
        for row in rows:
            if not isinstance(row, dict):
                raise HTTPException(status_code=400, detail=f"格式不正确：data.{key} 条目必须为对象")
    # 存储型 XSS 防护：导入通道与 notes.py 创建/更新同口径，笔记标题/正文写入前转义
    from app.core.xss_sanitizer import sanitize_note_input
    for row in data.get("notes") or []:
        if isinstance(row.get("title"), str) or isinstance(row.get("content"), str):
            safe_title, safe_content = sanitize_note_input(row.get("title"), row.get("content"))
            if isinstance(row.get("title"), str):
                row["title"] = safe_title
            if isinstance(row.get("content"), str):
                row["content"] = safe_content
    from app.core.tenant_scope import get_active_tenant
    stats = import_user_data(db, current_user.id, data, get_active_tenant(db, current_user))
    return {"success": True, **stats}

@router.delete("/me/data", summary="Clear user data", description="Delete all user-generated content (notes, capsules, clips, knowledge units, sticky notes, reminders, tags, read-later, RSS, documents) while keeping the account and subscription intact.")
async def clear_user_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id

    # 与注销同口径的内容硬删（BUG-Y06 抽出共用，含 content_tags/embeddings/chat 清理）
    _delete_user_content(db, user_id)

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
