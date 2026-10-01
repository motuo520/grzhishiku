from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from typing import Optional, List, Any
import json
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.tenant_scope import get_active_tenant
from app.models.base import User
from app.models.chat import ChatConversation, ChatMessage
from app.schemas.chat import (
    ChatConversationCreate, ChatConversationUpdate, ChatConversationOut,
    ChatConversationList, ChatConversationDetail, ChatMessageOut,
)

router = APIRouter()


def _conversation_response(conv: ChatConversation) -> dict:
    return {
        "id": conv.id,
        "title": conv.title or "",
        "mode": getattr(conv, "mode", None) or "chat",
        "created_at": conv.created_at,
        "updated_at": conv.updated_at,
    }


def _message_response(msg: ChatMessage) -> dict:
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "role": msg.role,
        "content": msg.content,
        "refs": msg.refs,
        "model": msg.model,
        "created_at": msg.created_at,
    }


def get_owned_conversation(db: Session, conversation_id: str, user_id: str,
                           tenant=None) -> ChatConversation:
    """Load a conversation owned by the user; 404 otherwise (no existence leak).

    空间口径（双空间隔离）：tenant 非空只看该团队空间会话，空只看个人空间
    （tenant_id IS NULL）；会话始终是创建者私有，user_id 条件不随空间放宽
    （团队会话也不共享给成员）。桌面端 tenant 恒 None，行为与旧版一致。
    """
    conv = db.query(ChatConversation).filter(
        ChatConversation.id == conversation_id,
        ChatConversation.user_id == user_id,
        ChatConversation.tenant_id == tenant.id if tenant else ChatConversation.tenant_id.is_(None),
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


def save_chat_turn(
    db: Session,
    conversation: ChatConversation,
    user_content: Optional[str] = None,
    assistant_content: Optional[str] = None,
    refs: Optional[Any] = None,
    model: Optional[str] = None,
) -> None:
    """Persist one Q&A turn into a conversation.

    宁可少不错：空内容或 [Error: ...] 开头的失败输出不落库。
    会话标题为空时用首条用户消息前 20 字补齐。
    refs：chat 轮传引用源 list（与 sources 事件同构）；agent 轮传 dict 命名空间
    （批⑤ 取证回执 agent_evidence）——前端 parseMessageRefs 对非数组返回 []，
    不撞引用展示。
    """
    if user_content:
        db.add(ChatMessage(
            id=str(uuid.uuid4()),
            conversation_id=conversation.id,
            role="user",
            content=user_content,
        ))
        if not conversation.title:
            conversation.title = user_content.strip()[:20]
    if assistant_content and not assistant_content.lstrip().startswith("[Error:"):
        db.add(ChatMessage(
            id=str(uuid.uuid4()),
            conversation_id=conversation.id,
            role="assistant",
            content=assistant_content,
            refs=json.dumps(refs, ensure_ascii=False) if refs else None,
            model=model,
        ))
    conversation.updated_at = datetime.utcnow()
    db.commit()


@router.get("/conversations", response_model=ChatConversationList, summary="List chat conversations")
async def list_conversations(
    mode: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    q = db.query(ChatConversation).filter(
        ChatConversation.user_id == current_user.id,
        # 空间口径：团队空间只见本团队会话，个人空间只见 tenant_id IS NULL
        ChatConversation.tenant_id == tenant.id if tenant else ChatConversation.tenant_id.is_(None),
    )
    # 形态过滤（09-22 智能体模式）：智能体页与聊天页各看各的，互不混排
    if mode:
        q = q.filter(ChatConversation.mode == mode)
    convs = q.order_by(desc(ChatConversation.updated_at)).all()
    items = []
    for conv in convs:
        count = db.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id).count()
        items.append({**_conversation_response(conv), "message_count": count})
    return {"total": len(items), "conversations": items}


@router.post("/conversations", response_model=ChatConversationOut, status_code=status.HTTP_201_CREATED, summary="Create chat conversation")
async def create_conversation(
    data: Optional[ChatConversationCreate] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    conv = ChatConversation(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        # 空间打戳：团队空间建的会话归团队空间（仍创建者私有），个人空间 NULL
        tenant_id=tenant.id if tenant else None,
        title=(data.title or "").strip() if data else "",
        mode=(data.mode if data and data.mode else "chat"),
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _conversation_response(conv)


@router.get("/conversations/{conversation_id}", response_model=ChatConversationDetail, summary="Get conversation with messages")
async def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = get_owned_conversation(db, conversation_id, current_user.id,
                                  get_active_tenant(db, current_user))
    # created_at 秒级精度，同一轮问答可能同秒：用 role 倒序兜底让 user 排在 assistant 前
    messages = db.query(ChatMessage).filter(
        ChatMessage.conversation_id == conv.id,
    ).order_by(ChatMessage.created_at, desc(ChatMessage.role)).all()
    return {**_conversation_response(conv), "messages": [_message_response(m) for m in messages]}


@router.patch("/conversations/{conversation_id}", response_model=ChatConversationOut, summary="Rename conversation")
async def update_conversation(
    conversation_id: str,
    data: ChatConversationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = get_owned_conversation(db, conversation_id, current_user.id,
                                  get_active_tenant(db, current_user))
    conv.title = data.title.strip()
    conv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conv)
    return _conversation_response(conv)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete conversation and its messages")
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = get_owned_conversation(db, conversation_id, current_user.id,
                                  get_active_tenant(db, current_user))
    db.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id).delete()
    db.delete(conv)
    db.commit()
    return None
