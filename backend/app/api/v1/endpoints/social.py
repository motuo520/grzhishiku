import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, SocialAccount, SocialMessage
from app.schemas.social import (
    SocialAccountCreate,
    SocialAccountUpdate,
    SocialAccountResponse,
    SocialMessageResponse,
    SocialUploadResult,
    SocialSaveToKnowledgeRequest,
)
from app.services import social_service, tag_service

router = APIRouter()


def _build_account_response(account: SocialAccount) -> dict:
    return {
        "id": account.id,
        "user_id": account.user_id,
        "provider": account.provider,
        "account_name": account.account_name,
        "connection_type": account.connection_type,
        "sync_status": account.sync_status,
        "last_sync_at": account.last_sync_at,
        "last_error": account.last_error,
        "sync_count": account.sync_count or 0,
        "status": account.status,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


@router.get("/accounts", response_model=List[SocialAccountResponse], summary="List social accounts")
async def list_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(SocialAccount).filter(
        SocialAccount.user_id == current_user.id,
        SocialAccount.status == "active"
    ).order_by(SocialAccount.created_at.desc()).all()
    return [_build_account_response(a) for a in accounts]


@router.post("/accounts", response_model=SocialAccountResponse, status_code=status.HTTP_201_CREATED, summary="Add social account")
async def create_account(
    data: SocialAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = social_service.create_account(
        db, current_user, data.provider, data.account_name
    )
    return _build_account_response(account)


@router.get("/accounts/{account_id}", response_model=SocialAccountResponse, summary="Get social account")
async def get_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(SocialAccount).filter(
        SocialAccount.id == account_id,
        SocialAccount.user_id == current_user.id,
        SocialAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Social account not found")
    return _build_account_response(account)


@router.put("/accounts/{account_id}", response_model=SocialAccountResponse, summary="Update social account")
async def update_account(
    account_id: str,
    data: SocialAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(SocialAccount).filter(
        SocialAccount.id == account_id,
        SocialAccount.user_id == current_user.id,
        SocialAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Social account not found")
    if data.account_name is not None:
        account.account_name = data.account_name
    if data.status is not None:
        account.status = data.status
    account.updated_at = datetime.now()
    db.commit()
    db.refresh(account)
    return _build_account_response(account)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete social account")
async def delete_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        social_service.delete_account(db, current_user, account_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Social account not found")
    return None


@router.post("/accounts/{account_id}/upload", response_model=SocialUploadResult, summary="Upload and parse social chat export")
async def upload_file(
    account_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account = db.query(SocialAccount).filter(
        SocialAccount.id == account_id,
        SocialAccount.user_id == current_user.id,
        SocialAccount.status == "active"
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Social account not found")

    if account.connection_type != "local_import":
        raise HTTPException(status_code=400, detail="该账号类型不支持文件上传导入")

    # Validate extension; strip any path components to prevent path traversal
    # (Linux 上 os.path.basename 不认 "\"，先统一成 "/" 再取纯文件名)
    filename = os.path.basename((file.filename or "unknown").replace("\\", "/")) or "unknown"
    ext = os.path.splitext(filename)[1].lower()
    allowed = {".txt", ".csv", ".html", ".htm", ".json", ".zip"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}，请上传 {', '.join(allowed)} 文件")

    upload_dir = "uploads/social"
    os.makedirs(upload_dir, exist_ok=True)
    unique_name = f"{uuid.uuid4()}_{filename}"
    file_path = os.path.join(upload_dir, unique_name)

    # 09-30 安全批：社交导入此前无大小帽（对照文档 20MB）——单请求百 MB zip 落盘+
    # 解压 500MB+请求内千万行 insert，一键打穿。上限 50MB + 磁盘水位闸同文档口径
    MAX_SOCIAL_UPLOAD_BYTES = 50 * 1024 * 1024
    usage = shutil.disk_usage(".")
    if usage.used / usage.total >= 0.8:
        raise HTTPException(status_code=503, detail="存储水位过高，已暂停上传，请稍后再试")
    try:
        written = 0
        with open(file_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 256)  # async 读，别堵事件循环
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_SOCIAL_UPLOAD_BYTES:
                    raise HTTPException(status_code=400, detail="单文件超过 50MB，请拆分后分批导入")
                buffer.write(chunk)
    except HTTPException:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise
    except Exception:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail="保存上传文件失败")
    finally:
        await file.close()

    result = social_service.process_upload(db, current_user, account, file_path)
    return SocialUploadResult(**result)


@router.get("/messages", response_model=List[SocialMessageResponse], summary="List social messages")
async def list_messages(
    account_id: Optional[str] = Query(None),
    conversation_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search content, sender or conversation name"),
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return social_service.list_messages(
        db, current_user, account_id=account_id, q=q,
        conversation_id=conversation_id, skip=skip, limit=limit
    )


@router.get("/messages/{message_id}", response_model=SocialMessageResponse, summary="Get social message")
async def get_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    msg = social_service.get_message(db, current_user, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Social message not found")
    return msg


@router.post("/messages/{message_id}/save-to-knowledge", response_model=dict, summary="Save social message as knowledge unit")
async def save_message_to_knowledge(
    message_id: str,
    request: SocialSaveToKnowledgeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    msg = social_service.get_message(db, current_user, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Social message not found")

    knowledge_id = social_service.save_to_knowledge(db, current_user, msg, request.tag_ids, request.brain_side)
    return {"success": True, "knowledge_id": knowledge_id}


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete social message")
async def delete_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        social_service.delete_message(db, current_user, message_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Social message not found")
    return None
