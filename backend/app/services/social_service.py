import logging
import os
import shutil
import uuid
import json
from datetime import datetime
from typing import List, Optional, Dict

from sqlalchemy.orm import Session

from app.models.base import SocialAccount, SocialMessage, User, KnowledgeUnit
from app.services import tag_service
from app.core.xss_sanitizer import sanitize_knowledge_input
from app.services.social_parsers import PARSERS

logger = logging.getLogger(__name__)


def get_parser(provider: str):
    parser_cls = PARSERS.get(provider.lower())
    if not parser_cls:
        raise ValueError(f"不支持的社交平台: {provider}")
    return parser_cls()


def create_account(db: Session, user: User, provider: str, account_name: Optional[str] = None) -> SocialAccount:
    account = SocialAccount(
        id=str(uuid.uuid4()),
        user_id=user.id,
        provider=provider.lower(),
        account_name=account_name,
        connection_type="local_import",
        sync_status="pending",
        status="active",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def process_upload(db: Session, user: User, account: SocialAccount, uploaded_file_path: str) -> Dict:
    """Parse uploaded file and insert messages. Returns summary dict."""
    account.sync_status = "syncing"
    account.last_error = None
    db.commit()

    parsed_count = 0
    skipped_count = 0
    error_msg = None
    temp_dir = None

    try:
        parser = get_parser(account.provider)

        # If the file is a zip, parser handles extraction internally.
        messages_data = parser.parse(uploaded_file_path, account.id, user.id)

        existing_uids = {
            row[0] for row in db.query(SocialMessage.message_uid).filter(
                SocialMessage.account_id == account.id
            ).all()
        }

        for msg_data in messages_data:
            uid = msg_data.get("message_uid")
            if not uid or uid in existing_uids:
                skipped_count += 1
                continue

            attachments_json = None
            attachments = msg_data.get("attachments")
            if attachments is not None:
                attachments_json = json.dumps(attachments, ensure_ascii=False) if isinstance(attachments, (list, dict)) else str(attachments)

            social_msg = SocialMessage(
                id=str(uuid.uuid4()),
                user_id=user.id,
                account_id=account.id,
                platform=msg_data.get("platform") or account.provider,
                conversation_id=msg_data.get("conversation_id"),
                conversation_name=msg_data.get("conversation_name"),
                message_uid=uid,
                sender_name=msg_data.get("sender_name"),
                sender_id=msg_data.get("sender_id"),
                content_raw=msg_data.get("content_raw"),
                content_text=msg_data.get("content_text"),
                message_type=msg_data.get("message_type") or "text",
                attachments=attachments_json,
                sent_at=msg_data.get("sent_at"),
                is_me=bool(msg_data.get("is_me", False)),
                status="active",
            )
            db.add(social_msg)
            parsed_count += 1
            existing_uids.add(uid)

            if parsed_count % 50 == 0:
                db.commit()

        db.commit()

    except Exception as e:
        # 异常原文可能含服务器绝对路径等细节，只进日志；用户面存通用文案
        logger.exception("Social import failed account=%s", account.id)
        error_msg = "导入失败，请检查文件格式是否正确或稍后重试"
        account.sync_status = "error"
        account.last_error = error_msg
        db.commit()
        return {"success": False, "parsed_count": parsed_count, "skipped_count": skipped_count, "error": error_msg}

    finally:
        # Clean up uploaded file and any temp extraction dirs created at same level
        try:
            if os.path.exists(uploaded_file_path):
                os.remove(uploaded_file_path)
            base_dir = os.path.dirname(uploaded_file_path)
            for name in os.listdir(base_dir):
                full = os.path.join(base_dir, name)
                if os.path.isdir(full) and name.startswith("_wechat_extract_"):
                    shutil.rmtree(full, ignore_errors=True)
        except Exception:
            pass

    account.sync_status = "success"
    account.last_sync_at = datetime.now()
    account.sync_count = (account.sync_count or 0) + parsed_count
    account.last_error = None
    db.commit()

    return {"success": True, "parsed_count": parsed_count, "skipped_count": skipped_count, "error": None}


def delete_account(db: Session, user: User, account_id: str) -> None:
    account = db.query(SocialAccount).filter(
        SocialAccount.id == account_id,
        SocialAccount.user_id == user.id,
        SocialAccount.status == "active"
    ).first()
    if not account:
        raise ValueError("Social account not found")
    account.status = "deleted"
    db.query(SocialMessage).filter(
        SocialMessage.account_id == account_id,
        SocialMessage.user_id == user.id
    ).update({"status": "deleted"})
    db.commit()


def list_messages(
    db: Session,
    user: User,
    account_id: Optional[str] = None,
    q: Optional[str] = None,
    conversation_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50
) -> List[SocialMessage]:
    query = db.query(SocialMessage).filter(
        SocialMessage.user_id == user.id,
        SocialMessage.status != "deleted"
    )
    if account_id:
        query = query.filter(SocialMessage.account_id == account_id)
    if conversation_id:
        query = query.filter(SocialMessage.conversation_id == conversation_id)
    if q:
        search = f"%{q}%"
        query = query.filter(
            SocialMessage.content_text.ilike(search) |
            SocialMessage.sender_name.ilike(search) |
            SocialMessage.conversation_name.ilike(search)
        )
    return query.order_by(SocialMessage.sent_at.desc().nullslast()).offset(skip).limit(limit).all()


def get_message(db: Session, user: User, message_id: str) -> Optional[SocialMessage]:
    return db.query(SocialMessage).filter(
        SocialMessage.id == message_id,
        SocialMessage.user_id == user.id,
        SocialMessage.status != "deleted"
    ).first()


def delete_message(db: Session, user: User, message_id: str) -> None:
    msg = db.query(SocialMessage).filter(
        SocialMessage.id == message_id,
        SocialMessage.user_id == user.id,
        SocialMessage.status != "deleted"
    ).first()
    if not msg:
        raise ValueError("Social message not found")
    msg.status = "deleted"
    db.commit()


def save_to_knowledge(db: Session, user: User, message: SocialMessage, tag_ids: Optional[List[str]] = None, brain_side: Optional[str] = "network") -> str:
    # 幂等：已保存过则直接返回既有知识单元（同 email 模块口径），
    # 重复调用不产生重复知识单元
    if message.knowledge_id:
        existing_unit = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.id == message.knowledge_id,
            KnowledgeUnit.user_id == user.id,
        ).first()
        if existing_unit:
            return existing_unit.id

    content = message.content_text or message.content_raw or ""
    if not content.strip():
        content = f"来自 {message.sender_name or '未知发送者'} 的社交消息"

    safe_content, _, safe_title = sanitize_knowledge_input(
        content,
        None,
        message.conversation_name or f"{message.platform} 聊天记录"
    )

    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=user.id,
        brain_side=brain_side if brain_side in ("personal", "network", "both") else "network",
        content_raw=safe_content,
        content_type='social_message',
        source_url=None,
        source_title=safe_title,
        source_type='social',
        source_author=message.sender_name or message.sender_id,
        source_publish_date=message.sent_at,
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

    # Auto-link graph
    try:
        from app.api.v1.endpoints.graph import auto_link_knowledge
        auto_link_knowledge(db, unit, user.id)
        db.commit()
    except Exception as e:
        logger.warning(f"Auto-link failed for social knowledge {unit.id}: {e}")

    message.status = "imported_to_knowledge"
    message.knowledge_id = unit.id
    db.commit()

    return unit.id
