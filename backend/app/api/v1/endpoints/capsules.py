from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional
from datetime import datetime
import uuid
import json

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_capsule_input
from app.models.base import User, Capsule, CapsuleDialogue
from app.schemas.capsule import (
    CapsuleCreate, CapsuleResponse, CapsuleDialogueCreate, CapsuleDialogueResponse,
    CapsuleDialogueMessage,
)
from app.services.llm_service import chat_completion

router = APIRouter()


def _build_dialogue_response(dialogue: CapsuleDialogue) -> CapsuleDialogueResponse:
    messages = json.loads(dialogue.conversation or '[]')
    formatted_messages = [CapsuleDialogueMessage(**msg) for msg in messages]
    return CapsuleDialogueResponse(
        id=dialogue.id,
        capsule_id=dialogue.capsule_id,
        opened_at=dialogue.opened_at,
        opened_by=dialogue.opened_by,
        present_context=dialogue.present_context,
        present_mood=dialogue.present_mood,
        present_reflection=dialogue.present_reflection,
        conversation=dialogue.conversation,
        messages=formatted_messages,
        insights_pattern=dialogue.insights_pattern,
        insights_growth=dialogue.insights_growth,
        insights_warning=dialogue.insights_warning,
        insights_suggestion=dialogue.insights_suggestion,
        closed_at=dialogue.closed_at,
        closure=dialogue.closure,
    )

def check_unlock_conditions(capsule: Capsule) -> bool:
    """Check if capsule unlock conditions are met"""
    if capsule.unlock_status != 'locked':
        return True
    
    try:
        config = json.loads(capsule.unlock_config) if isinstance(capsule.unlock_config, str) else capsule.unlock_config
    except:
        return False
    
    if capsule.unlock_type == 'temporal':
        unlock_date = config.get('unlock_date')
        if unlock_date:
            try:
                return datetime.now() >= datetime.fromisoformat(unlock_date.replace('Z', '+00:00'))
            except (ValueError, TypeError, AttributeError):
                return False
    
    # For other types, require manual unlock or additional checks
    return False

def _capsule_to_response(capsule: Capsule, db: Session) -> CapsuleResponse:
    # Lazily persist auto-unlock for temporal capsules whose time has come,
    # so unlock_status stays consistent across list, detail and dialogue.
    if capsule.unlock_status == 'locked' and check_unlock_conditions(capsule):
        capsule.unlock_status = 'unlocked'
        db.commit()
        db.refresh(capsule)
    return CapsuleResponse(
        id=capsule.id,
        user_id=capsule.user_id,
        brain_side=capsule.brain_side,
        content_type=capsule.content_type or 'text',
        content_body=capsule.content_body,
        content_attachments=capsule.content_attachments,
        mood_emotion=capsule.mood_emotion,
        mood_intensity=capsule.mood_intensity,
        mood_energy_level=capsule.mood_energy_level,
        mood_tags=capsule.mood_tags,
        sealed_at=capsule.sealed_at,
        sealed_fingerprint=capsule.sealed_fingerprint,
        unlock_type=capsule.unlock_type or 'temporal',
        unlock_config=capsule.unlock_config,
        unlock_status=capsule.unlock_status,
        is_unlocked=capsule.unlock_status != 'locked',
        privacy_level=capsule.privacy_level,
        privacy_require_auth=capsule.privacy_require_auth,
        privacy_allow_export=capsule.privacy_allow_export,
        created_at=capsule.created_at,
        updated_at=capsule.updated_at,
    )


@router.get("/", response_model=List[CapsuleResponse], summary="List capsules", description="Get all capsules for the current user.")
async def list_capsules(
    brain_side: Optional[str] = None,
    privacy_level: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Capsule).filter(Capsule.user_id == current_user.id)
    if brain_side and brain_side != "both":
        query = query.filter(Capsule.brain_side == brain_side)
    if privacy_level:
        query = query.filter(Capsule.privacy_level == privacy_level)
    capsules = query.order_by(Capsule.created_at.desc()).all()
    return [_capsule_to_response(c, db) for c in capsules]

@router.post("/", response_model=CapsuleResponse, status_code=status.HTTP_201_CREATED, summary="Create capsule", description="Create a new time capsule.")
async def create_capsule(
    capsule_data: CapsuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # XSS sanitization
    safe_content, safe_mood_tags = sanitize_capsule_input(
        capsule_data.content_body, capsule_data.mood_tags
    )
    capsule = Capsule(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=capsule_data.brain_side or 'personal',
        content_type=capsule_data.content_type,
        content_body=safe_content,
        content_attachments=json.dumps(capsule_data.content_attachments) if capsule_data.content_attachments else None,
        mood_emotion=capsule_data.mood_emotion,
        mood_intensity=capsule_data.mood_intensity,
        mood_energy_level=capsule_data.mood_energy_level,
        mood_tags=json.dumps(safe_mood_tags) if safe_mood_tags else None,
        mood_trigger=capsule_data.mood_trigger,
        mood_weather=capsule_data.mood_weather,
        mood_location=capsule_data.mood_location,
        sealed_at=datetime.now(),
        sealed_context=json.dumps({'ip': '127.0.0.1', 'device': 'web'}),
        sealed_fingerprint=str(uuid.uuid4()),
        unlock_type=capsule_data.unlock_type,
        unlock_config=json.dumps(capsule_data.unlock_config),
        privacy_level=capsule_data.privacy_level,
        privacy_require_auth=capsule_data.privacy_require_auth,
        privacy_allow_export=capsule_data.privacy_allow_export,
        privacy_encryption_level=capsule_data.privacy_encryption_level,
    )
    db.add(capsule)
    db.commit()
    db.refresh(capsule)
    return _capsule_to_response(capsule, db)

@router.get("/stats", summary="Capsule statistics", description="Get capsule statistics grouped by brain side.")
async def get_capsule_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    def side_stats(side: str):
        base = db.query(Capsule).filter(Capsule.user_id == current_user.id)
        if side != "both":
            base = base.filter(Capsule.brain_side == side)
        total = base.count()
        locked = base.filter(Capsule.unlock_status == 'locked').count()
        unlocked = base.filter(Capsule.unlock_status == 'unlocked').count()
        opened = base.filter(Capsule.unlock_status == 'opened').count()
        return {
            "total": total,
            "locked": locked,
            "unlocked": unlocked,
            "opened": opened,
            "unlock_rate": round((unlocked + opened) / total * 100, 2) if total > 0 else 0,
        }

    return {
        "personal": side_stats("personal"),
        "network": side_stats("network"),
        "both": side_stats("both"),
    }


@router.get("/plaza", response_model=List[CapsuleResponse], summary="Capsule plaza", description="Get public capsules from all users for the plaza.")
async def get_capsule_plaza(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Plaza shows everyone's public capsules, plus the user's own shared ones.
    capsules = db.query(Capsule).filter(
        or_(
            Capsule.privacy_level == 'public',
            and_(Capsule.user_id == current_user.id, Capsule.privacy_level == 'shared')
        )
    ).order_by(Capsule.created_at.desc()).all()
    result = []
    for c in capsules:
        resp = _capsule_to_response(c, db)
        # Never leak sealed content of other people's capsules
        if c.user_id != current_user.id and resp.unlock_status == 'locked':
            resp.content_body = '（内容封存中，到达解锁时间后可见）'
        result.append(resp)
    return result


@router.get("/schedule", response_model=List[CapsuleResponse], summary="Capsule unlock schedule", description="Get capsules ordered by unlock date/time.")
async def get_capsule_schedule(
    brain_side: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Capsule).filter(Capsule.user_id == current_user.id)
    if brain_side and brain_side != "both":
        query = query.filter(Capsule.brain_side == brain_side)
    capsules = query.order_by(Capsule.created_at.desc()).all()
    # Sort by earliest unlock date if temporal
    def sort_key(c: Capsule):
        if c.unlock_type == 'temporal' and isinstance(c.unlock_config, str):
            try:
                cfg = json.loads(c.unlock_config)
                date_str = cfg.get('unlock_date')
                if date_str:
                    return datetime.fromisoformat(date_str.replace('Z', '+00:00')).timestamp()
            except Exception:
                pass
        return c.created_at.timestamp() if c.created_at else 0
    capsules.sort(key=sort_key)
    return [_capsule_to_response(c, db) for c in capsules]


@router.post("/{capsule_id}/collect", response_model=CapsuleResponse, summary="Collect capsule", description="Collect a plaza capsule into personal brain.")
async def collect_capsule(
    capsule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    if capsule.privacy_level == 'private':
        raise HTTPException(status_code=400, detail="Private capsules cannot be collected")
    if capsule.user_id != current_user.id and capsule.privacy_level != 'public':
        raise HTTPException(status_code=403, detail="Only public capsules can be collected")

    collected = Capsule(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side='personal',
        content_type=capsule.content_type,
        content_body=capsule.content_body,
        content_attachments=capsule.content_attachments,
        mood_emotion=capsule.mood_emotion,
        mood_intensity=capsule.mood_intensity,
        mood_energy_level=capsule.mood_energy_level,
        mood_tags=capsule.mood_tags,
        mood_trigger=capsule.mood_trigger,
        mood_weather=capsule.mood_weather,
        mood_location=capsule.mood_location,
        sealed_at=datetime.now(),
        sealed_context=capsule.sealed_context,
        sealed_fingerprint=str(uuid.uuid4()),
        unlock_type=capsule.unlock_type,
        unlock_config=capsule.unlock_config,
        privacy_level='private',
        privacy_require_auth=False,
        privacy_allow_export=True,
        privacy_encryption_level=capsule.privacy_encryption_level,
    )
    db.add(collected)
    db.commit()
    db.refresh(collected)
    return _capsule_to_response(collected, db)

@router.get("/{capsule_id}", response_model=CapsuleResponse, summary="Get capsule", description="Get a specific capsule by ID.")
async def get_capsule(
    capsule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id, Capsule.user_id == current_user.id).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    return _capsule_to_response(capsule, db)

@router.delete("/{capsule_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete capsule", description="Delete a capsule.")
async def delete_capsule(
    capsule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id, Capsule.user_id == current_user.id).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, capsule_id)
    db.delete(capsule)
    db.commit()
    return None

@router.post("/{capsule_id}/unlock", summary="Unlock capsule", description="Attempt to unlock a time capsule.")
async def unlock_capsule(
    capsule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id, Capsule.user_id == current_user.id).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")

    if capsule.unlock_status != 'locked':
        return {"success": True, "message": "Capsule already unlocked", "status": capsule.unlock_status}

    if capsule.unlock_type == 'temporal':
        if not check_unlock_conditions(capsule):
            raise HTTPException(status_code=403, detail="解锁时间未到，暂时无法开启")
    # eventual/conditional 等类型由主人手动确认条件已达成后解锁

    capsule.unlock_status = 'unlocked'
    db.commit()
    db.refresh(capsule)

    return {"success": True, "message": "Capsule unlocked", "status": capsule.unlock_status}

@router.get("/{capsule_id}/dialogue", response_model=CapsuleDialogueResponse, summary="Get capsule dialogue history", description="Retrieve the existing dialogue history for a capsule.")
async def get_capsule_dialogue(
    capsule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id, Capsule.user_id == current_user.id).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")

    if capsule.unlock_status == 'locked':
        raise HTTPException(status_code=403, detail="Capsule is locked")

    dialogue = db.query(CapsuleDialogue).filter(CapsuleDialogue.capsule_id == capsule_id).first()
    if not dialogue:
        # Return an empty dialogue shell so the frontend can start chatting
        dialogue = CapsuleDialogue(
            id=str(uuid.uuid4()),
            capsule_id=capsule_id,
            opened_at=datetime.now(),
            opened_by='user',
            conversation=json.dumps([]),
        )
        db.add(dialogue)
        db.commit()
        db.refresh(dialogue)

    return _build_dialogue_response(dialogue)


@router.post("/{capsule_id}/dialogue", response_model=CapsuleDialogueResponse, summary="Capsule dialogue", description="Send a message to the past self through the capsule.")
async def capsule_dialogue(
    capsule_id: str,
    dialogue_data: CapsuleDialogueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id, Capsule.user_id == current_user.id).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")

    if capsule.unlock_status == 'locked':
        raise HTTPException(status_code=403, detail="Capsule is locked")

    # Get or create dialogue
    dialogue = db.query(CapsuleDialogue).filter(CapsuleDialogue.capsule_id == capsule_id).first()
    if not dialogue:
        dialogue = CapsuleDialogue(
            id=str(uuid.uuid4()),
            capsule_id=capsule_id,
            opened_at=datetime.now(),
            opened_by='user',
            present_context=json.dumps(dialogue_data.present_context) if dialogue_data.present_context else None,
            present_mood=json.dumps(dialogue_data.present_mood) if dialogue_data.present_mood else None,
            present_reflection=dialogue_data.present_reflection,
            conversation=json.dumps([]),
        )
        db.add(dialogue)

    # Append message to conversation
    conversation = json.loads(dialogue.conversation or '[]')
    now_iso = datetime.now().isoformat()
    conversation.append({
        'role': 'user',
        'content': dialogue_data.message,
        'timestamp': now_iso,
        'is_cross_time': True,
    })

    # Build context for the "past self" persona
    mood_parts = []
    if capsule.mood_emotion:
        mood_parts.append(f"情绪：{capsule.mood_emotion}")
    if capsule.mood_intensity is not None:
        mood_parts.append(f"强度：{capsule.mood_intensity}/10")
    if capsule.mood_tags:
        try:
            tags = json.loads(capsule.mood_tags)
            if isinstance(tags, list) and tags:
                mood_parts.append(f"标签：{', '.join(str(t) for t in tags)}")
        except Exception:
            pass
    if dialogue_data.present_mood:
        mood_parts.append(f"当下心情：{json.dumps(dialogue_data.present_mood, ensure_ascii=False)}")

    past_context = (
        f"你是用户过去的自己。下面是一封用户在 {capsule.created_at.isoformat() if capsule.created_at else '过去'} "
        f"封存的时间胶囊内容，代表了当时的心境、想法和处境。\n\n"
        f"【时间胶囊原文】\n{capsule.content_body}\n\n"
    )
    if mood_parts:
        past_context += f"【封存时的心境】\n{'；'.join(mood_parts)}\n\n"
    if dialogue_data.present_reflection:
        past_context += f"【用户现在的反思】\n{dialogue_data.present_reflection}\n\n"
    if dialogue_data.present_context:
        past_context += f"【用户当下的补充背景】\n{json.dumps(dialogue_data.present_context, ensure_ascii=False)}\n\n"

    system_prompt = (
        past_context
        + "现在，用户正在跨越时间与当时的自己对话。请完全代入「过去的自己」的角色，用第一人称回复。\n"
        + "回复要求：\n"
        + "1. 保持当时的心境、认知水平和表达方式，不要刻意成熟或说教；\n"
        + "2. 真诚回应用户的问题或倾诉，可以惊讶、关心、鼓励或提出当时的视角；\n"
        + "3. 回复控制在 200 字以内，自然口语化；\n"
        + "4. 不要泄露你是 AI，也不要跳出角色。"
    )

    # Call LLM
    try:
        ai_reply = await chat_completion(
            prompt=dialogue_data.message,
            task_type="capsule_dialogue",
            system_prompt=system_prompt,
            preferred_model=dialogue_data.preferred_model,
        )
    except Exception:
        # Fallback to a safe message if LLM fails, preserving conversation
        ai_reply = "（过去的自己仿佛隔着时光点了点头，但声音有些模糊……AI 暂时不可用，请稍后重试）"

    conversation.append({
        'role': 'ai',
        'content': ai_reply.strip(),
        'timestamp': datetime.now().isoformat(),
        'is_cross_time': True,
    })

    dialogue.conversation = json.dumps(conversation)
    db.commit()
    db.refresh(dialogue)

    return _build_dialogue_response(dialogue)
