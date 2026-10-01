from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import uuid
import json
import asyncio

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_knowledge_input
from app.models.base import User, EmailAccount, EmailMessage, KnowledgeUnit
from app.schemas.email import (
    EmailAccountCreate, EmailAccountUpdate, EmailAccountResponse,
    EmailMessageResponse, EmailSyncResult, EmailSaveToKnowledgeRequest
)
from app.services import email_service, tag_service
from app.api.v1.endpoints.graph import queue_auto_link

router = APIRouter()


def _escape_like(value: str) -> str:
    """转义 LIKE 通配符，防 %/_ 滥用造成慢查询。"""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _build_account_response(account: EmailAccount) -> dict:
    return {
        "id": account.id,
        "user_id": account.user_id,
        "provider": account.provider,
        "email_address": account.email_address,
        "imap_host": account.imap_host,
        "imap_port": account.imap_port,
        "imap_use_ssl": account.imap_use_ssl,
        "sync_status": account.sync_status,
        "last_sync_at": account.last_sync_at,
        "last_error": account.last_error,
        "sync_count": account.sync_count or 0,
        "status": account.status,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


@router.get("/accounts", response_model=List[EmailAccountResponse], summary="List email accounts")
async def list_email_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(EmailAccount).filter(
        EmailAccount.user_id == current_user.id,
        EmailAccount.status == "active"
    ).order_by(EmailAccount.created_at.desc()).all()
    return [_build_account_response(a) for a in accounts]


@router.post("/accounts", response_model=EmailAccountResponse, status_code=status.HTTP_201_CREATED, summary="Add email account")
async def create_email_account(
    data: EmailAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Apply preset if provider matches
    preset = email_service.get_imap_preset(data.provider)
    imap_host = data.imap_host
    imap_port = data.imap_port
    imap_use_ssl = data.imap_use_ssl

    if preset:
        if not imap_host:
            imap_host = preset["host"]
        if imap_port is None:
            imap_port = preset["port"]
        if imap_use_ssl is None:
            imap_use_ssl = preset["use_ssl"]

    if not imap_host:
        raise HTTPException(status_code=400, detail="IMAP host is required")

    account = EmailAccount(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        provider=data.provider,
        email_address=data.email_address,
        imap_host=imap_host,
        imap_port=imap_port or 993,
        imap_use_ssl=imap_use_ssl if imap_use_ssl is not None else True,
        access_token=data.access_token,
        refresh_token=data.refresh_token,
        sync_status="pending",
        status="active",
    )

    # Test connection（线程池 + 超时，避免阻塞事件循环）
    try:
        connected = await asyncio.wait_for(
            run_in_threadpool(email_service.test_imap_connection, account),
            timeout=30,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=400, detail="邮箱连接超时，请稍后重试")
    except Exception:
        connected = False

    if not connected:
        raise HTTPException(status_code=400, detail="无法连接到邮箱，请检查 IMAP 地址、端口或授权码")

    db.add(account)
    db.commit()
    db.refresh(account)
    return _build_account_response(account)


@router.get("/accounts/{account_id}", response_model=EmailAccountResponse, summary="Get email account")
async def get_email_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(EmailAccount).filter(
        EmailAccount.id == account_id,
        EmailAccount.user_id == current_user.id,
        EmailAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Email account not found")
    return _build_account_response(account)


@router.put("/accounts/{account_id}", response_model=EmailAccountResponse, summary="Update email account")
async def update_email_account(
    account_id: str,
    data: EmailAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(EmailAccount).filter(
        EmailAccount.id == account_id,
        EmailAccount.user_id == current_user.id,
        EmailAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Email account not found")

    if data.provider is not None:
        account.provider = data.provider
    if data.email_address is not None:
        account.email_address = data.email_address
    if data.imap_host is not None:
        account.imap_host = data.imap_host
    if data.imap_port is not None:
        account.imap_port = data.imap_port
    if data.imap_use_ssl is not None:
        account.imap_use_ssl = data.imap_use_ssl
    if data.access_token is not None:
        account.access_token = data.access_token
    if data.refresh_token is not None:
        account.refresh_token = data.refresh_token
    if data.status is not None:
        account.status = data.status

    account.updated_at = datetime.now()
    db.commit()
    db.refresh(account)
    return _build_account_response(account)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete email account")
async def delete_email_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(EmailAccount).filter(
        EmailAccount.id == account_id,
        EmailAccount.user_id == current_user.id,
        EmailAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Email account not found")

    account.status = "deleted"
    # Optionally soft-delete associated messages
    db.query(EmailMessage).filter(
        EmailMessage.account_id == account_id,
        EmailMessage.user_id == current_user.id
    ).update({"status": "deleted"})

    db.commit()
    return None


@router.post("/accounts/{account_id}/sync", response_model=EmailSyncResult, summary="Sync emails from account")
async def sync_email_account(
    account_id: str,
    max_messages: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(EmailAccount).filter(
        EmailAccount.id == account_id,
        EmailAccount.user_id == current_user.id,
        EmailAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Email account not found")

    # 同步 IMAP 放入线程池，避免长时间阻塞事件循环
    try:
        result = await asyncio.wait_for(
            run_in_threadpool(
                email_service.sync_account,
                db,
                account,
                current_user,
                max_messages=max_messages,
            ),
            timeout=300,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="邮件同步超时，请稍后重试")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="邮件同步失败")

    return result


@router.get("/messages", response_model=List[EmailMessageResponse], summary="List email messages")
async def list_email_messages(
    account_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=200, description="Search subject or body text"),
    status: Optional[str] = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(20, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(EmailMessage).filter(
        EmailMessage.user_id == current_user.id,
        EmailMessage.status != "deleted"
    )
    if account_id:
        query = query.filter(EmailMessage.account_id == account_id)
    if status:
        query = query.filter(EmailMessage.status == status)
    if q:
        search = f"%{_escape_like(q)}%"
        query = query.filter(
            EmailMessage.subject.ilike(search, escape="\\") | EmailMessage.body_text.ilike(search, escape="\\")
        )

    messages = query.order_by(EmailMessage.received_at.desc().nullslast()).offset(skip).limit(limit).all()
    return messages


@router.get("/messages/{message_id}", response_model=EmailMessageResponse, summary="Get email message")
async def get_email_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    msg = db.query(EmailMessage).filter(
        EmailMessage.id == message_id,
        EmailMessage.user_id == current_user.id,
        EmailMessage.status != "deleted"
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Email message not found")
    return msg


@router.post("/messages/{message_id}/save-to-knowledge", response_model=dict, summary="Save email as knowledge unit")
async def save_email_to_knowledge(
    message_id: str,
    request: EmailSaveToKnowledgeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    msg = db.query(EmailMessage).filter(
        EmailMessage.id == message_id,
        EmailMessage.user_id == current_user.id,
        EmailMessage.status != "deleted"
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Email message not found")

    # 幂等：已保存过则直接返回既有知识单元
    if msg.knowledge_id:
        existing_unit = db.query(KnowledgeUnit).filter(
            KnowledgeUnit.id == msg.knowledge_id,
            KnowledgeUnit.user_id == current_user.id,
        ).first()
        if existing_unit:
            return {"success": True, "knowledge_id": existing_unit.id}

    content = email_service.extract_main_text(msg.body_text, msg.body_html)
    if not content:
        content = msg.subject or ""

    safe_content, _, safe_title = sanitize_knowledge_input(
        content,
        None,
        msg.subject or "(无主题)"
    )

    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side='network',
        content_raw=safe_content,
        content_type='email',
        title=safe_title,  # 09-16 单元自身标题
        source_url=f"mailto:{msg.sender_email}" if msg.sender_email else None,
        source_title=safe_title,
        source_type='email',
        source_author=msg.sender_name or msg.sender_email,
        verification_status='unverified',
        trust_level='tentative',
        verification_history='[]',
    )
    try:
        db.add(unit)
        db.flush()

        # Attach tags
        if request.tag_ids:
            tag_service.set_tags_for(
                db,
                content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
                content_id=unit.id,
                user_id=current_user.id,
                tag_inputs=request.tag_ids,
            )

        # Auto-link graph（后台队列+防抖，请求路径零扫描；失败不影响导入）
        queue_auto_link("knowledge", unit.id, current_user.id, db)

        msg.status = "imported_to_knowledge"
        msg.knowledge_id = unit.id

        db.commit()
        db.refresh(unit)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="保存邮件到知识库失败")

    return {"success": True, "knowledge_id": unit.id}


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete email message")
async def delete_email_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    msg = db.query(EmailMessage).filter(
        EmailMessage.id == message_id,
        EmailMessage.user_id == current_user.id,
        EmailMessage.status != "deleted"
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Email message not found")
    msg.status = "deleted"
    db.commit()
    return None
