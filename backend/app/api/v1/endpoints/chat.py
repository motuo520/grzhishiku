from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from typing import Optional, List
import json
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
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


def get_owned_conversation(db: Session, conversation_id: str, user_id: str) -> ChatConversation:
    """Load a conversation owned by the user; 404 otherwise (no existence leak)."""
    conv = db.query(ChatConversation).filter(
        ChatConversation.id == conversation_id,
        ChatConversation.user_id == user_id,
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


def save_chat_turn(
    db: Session,
    conversation: ChatConversation,
    user_content: Optional[str] = None,
    assistant_content: Optional[str] = None,
    refs: Optional[List[dict]] = None,
    model: Optional[str] = None,
) -> None:
    """Persist one Q&A turn into a conversation.

    宁可少不错：空内容或 [Error: ...] 开头的失败输出不落库。
    会话标题为空时用首条用户消息前 20 字补齐。
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    convs = db.query(ChatConversation).filter(
        ChatConversation.user_id == current_user.id,
    ).order_by(desc(ChatConversation.updated_at)).all()
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
    conv = ChatConversation(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=(data.title or "").strip() if data else "",
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
    conv = get_owned_conversation(db, conversation_id, current_user.id)
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
    conv = get_owned_conversation(db, conversation_id, current_user.id)
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
    conv = get_owned_conversation(db, conversation_id, current_user.id)
    db.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id).delete()
    db.delete(conv)
    db.commit()
    return None
