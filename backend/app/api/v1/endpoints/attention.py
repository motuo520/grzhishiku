from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
import json
import uuid

from app.core.database import get_db
from app.core.security import get_current_user, validate_password_complexity
from app.models.base import User, AttentionActivity, AttentionCategory, AttentionGuardianRule, AttentionRation, DeepWorkSession
from app.schemas.attention import (
    AttentionActivityCreate, AttentionActivityResponse,
    AttentionCategoryCreate, AttentionCategoryUpdate, AttentionCategoryResponse,
    AttentionGuardianRuleCreate, AttentionGuardianRuleUpdate, AttentionGuardianRuleResponse,
    AttentionRationCreate, AttentionRationUpdate, AttentionRationResponse,
    DeepWorkConfig, DeepWorkSessionResponse,
    AttentionDashboard, AttentionStats, AttentionScore, AttentionWeeklyReport
)
from app.core.xss_sanitizer import sanitize_markdown

router = APIRouter()

@router.get("/activities", response_model=list[AttentionActivityResponse], summary="List attention activities", description="Get attention activities for the current user.")
async def list_activities(
    start: str = None,
    end: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(AttentionActivity).filter(AttentionActivity.user_id == current_user.id)
    if start:
        query = query.filter(AttentionActivity.start_time >= datetime.fromisoformat(start))
    if end:
        query = query.filter(AttentionActivity.start_time <= datetime.fromisoformat(end))
    activities = query.order_by(AttentionActivity.start_time.desc()).all()
    return activities

@router.post("/activities", response_model=AttentionActivityResponse, summary="Record activity", description="Record a new attention activity.")
async def create_activity(
    activity_data: AttentionActivityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    activity = AttentionActivity(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        category_id=activity_data.category_id,
        category=activity_data.category.value if activity_data.category else "other",
        brain_side=activity_data.brain_side,
        description=sanitize_markdown(activity_data.description) if activity_data.description else None,
        start_time=activity_data.start_time,
        end_time=activity_data.end_time,
        actual_duration=activity_data.actual_duration,
        source=activity_data.source,
        metadata_url=activity_data.metadata_url,
        metadata_app=activity_data.metadata_app,
        metadata_title=activity_data.metadata_title,
        completion_status=activity_data.completion_status,
        focus_score=activity_data.focus_score,
        focus_duration=activity_data.focus_duration,
        focus_intensity=activity_data.focus_intensity,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity

def _apply_brain_side(query, model_field, brain_side: str):
    """Filter a query by brain_side where 'both' means no filtering."""
    if not brain_side or brain_side == "both":
        return query
    return query.filter(model_field == brain_side)


@router.get("/dashboard", summary="Attention dashboard", description="Get attention dashboard statistics. Optional brain_side filter: personal | network | both.")
async def get_dashboard(
    brain_side: str = "both",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    total_focus_query = db.query(func.sum(AttentionActivity.actual_duration)).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today
    )
    total_focus_query = _apply_brain_side(total_focus_query, AttentionActivity.brain_side, brain_side)
    total_focus = total_focus_query.scalar() or 0

    interruptions_query = db.query(AttentionActivity).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today,
        AttentionActivity.completion_status == 'interrupted'
    )
    interruptions_query = _apply_brain_side(interruptions_query, AttentionActivity.brain_side, brain_side)
    interruptions = interruptions_query.count()

    sessions_query = db.query(DeepWorkSession).filter(
        DeepWorkSession.user_id == current_user.id,
        DeepWorkSession.started_at >= today
    )
    sessions_query = _apply_brain_side(sessions_query, DeepWorkSession.brain_side, brain_side)
    sessions = sessions_query.count()

    avg_focus_query = db.query(func.avg(AttentionActivity.focus_score)).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today
    )
    avg_focus_query = _apply_brain_side(avg_focus_query, AttentionActivity.brain_side, brain_side)
    avg_focus = avg_focus_query.scalar() or 0

    categories = db.query(AttentionCategory).filter(
        AttentionCategory.user_id == current_user.id,
        AttentionCategory.brain_side.in_([brain_side, "both"]) if brain_side != "both" else True
    ).all()
    category_distribution = [
        {"name": cat.name, "allocated": cat.allocated_minutes, "color": cat.color}
        for cat in categories
    ]

    weekly = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_focus_query = db.query(func.sum(AttentionActivity.actual_duration)).filter(
            AttentionActivity.user_id == current_user.id,
            AttentionActivity.start_time >= day,
            AttentionActivity.start_time < day + timedelta(days=1)
        )
        day_focus_query = _apply_brain_side(day_focus_query, AttentionActivity.brain_side, brain_side)
        day_focus = day_focus_query.scalar() or 0
        weekly.append({"day": day.strftime("%a"), "focus": round(day_focus, 1)})

    return AttentionDashboard(
        total_focus_today=round(total_focus, 1),
        total_interruptions=interruptions,
        category_distribution=category_distribution,
        weekly_trend=weekly,
        deep_work_sessions_today=sessions,
        average_focus_score=round(avg_focus, 1),
    )

@router.get("/stats", summary="Attention statistics", description="Get detailed attention stats with daily, weekly, and category breakdown. Optional brain_side filter: personal | network | both.")
async def get_stats(
    brain_side: str = "both",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Daily overview
    total_activities_query = db.query(AttentionActivity).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today
    )
    total_activities_query = _apply_brain_side(total_activities_query, AttentionActivity.brain_side, brain_side)
    total_activities = total_activities_query.count()

    total_focus_minutes_query = db.query(func.sum(AttentionActivity.actual_duration)).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today
    )
    total_focus_minutes_query = _apply_brain_side(total_focus_minutes_query, AttentionActivity.brain_side, brain_side)
    total_focus_minutes = total_focus_minutes_query.scalar() or 0

    deep_work_count_query = db.query(DeepWorkSession).filter(
        DeepWorkSession.user_id == current_user.id,
        DeepWorkSession.started_at >= today
    )
    deep_work_count_query = _apply_brain_side(deep_work_count_query, DeepWorkSession.brain_side, brain_side)
    deep_work_count = deep_work_count_query.count()

    interruption_count_query = db.query(AttentionActivity).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today,
        AttentionActivity.completion_status == 'interrupted'
    )
    interruption_count_query = _apply_brain_side(interruption_count_query, AttentionActivity.brain_side, brain_side)
    interruption_count = interruption_count_query.count()

    # Weekly trend (last 7 days)
    weekly = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_focus_query = db.query(func.sum(AttentionActivity.actual_duration)).filter(
            AttentionActivity.user_id == current_user.id,
            AttentionActivity.start_time >= day,
            AttentionActivity.start_time < day + timedelta(days=1)
        )
        day_focus_query = _apply_brain_side(day_focus_query, AttentionActivity.brain_side, brain_side)
        day_focus = day_focus_query.scalar() or 0
        weekly.append({
            "date": day.strftime("%Y-%m-%d"),
            "day": day.strftime("%a"),
            "focus_minutes": round(day_focus, 1)
        })

    # Category breakdown by activity.category field
    category_counts_query = db.query(
        AttentionActivity.category,
        func.sum(AttentionActivity.actual_duration),
        func.count(AttentionActivity.id)
    ).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today
    )
    category_counts_query = _apply_brain_side(category_counts_query, AttentionActivity.brain_side, brain_side)
    category_counts = category_counts_query.group_by(AttentionActivity.category).all()

    category_map = {
        "work": {"name": "工作", "color": "#58a6ff"},
        "study": {"name": "学习", "color": "#3fb950"},
        "entertainment": {"name": "娱乐", "color": "#f778ba"},
        "social": {"name": "社交", "color": "#d29922"},
        "other": {"name": "其他", "color": "#8b949e"},
    }

    categories = []
    for cat, duration, count in category_counts:
        info = category_map.get(cat, category_map["other"])
        categories.append({
            "key": cat,
            "name": info["name"],
            "color": info["color"],
            "minutes": round(duration or 0, 1),
            "count": count,
        })

    return AttentionStats(
        daily={
            "total_activities": total_activities,
            "total_focus_minutes": round(total_focus_minutes, 1),
            "deep_work_sessions": deep_work_count,
            "interruptions": interruption_count,
        },
        weekly=weekly,
        categories=categories,
    )

@router.get("/weekly-report", response_model=AttentionWeeklyReport, summary="Weekly attention report", description="Aggregate last 7 days of attention metrics (focus minutes, deep work, interruptions, daily trend, category distribution). Optional brain_side filter: personal | network | both.")
async def get_weekly_report(
    brain_side: str = "both",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today - timedelta(days=6)

    base_filter = [
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= week_start,
    ]

    focus_q = db.query(func.sum(AttentionActivity.actual_duration)).filter(*base_filter)
    focus_q = _apply_brain_side(focus_q, AttentionActivity.brain_side, brain_side)
    total_focus_minutes = focus_q.scalar() or 0

    act_q = db.query(AttentionActivity).filter(*base_filter)
    act_q = _apply_brain_side(act_q, AttentionActivity.brain_side, brain_side)
    total_activities = act_q.count()

    avg_q = db.query(func.avg(AttentionActivity.focus_score)).filter(*base_filter, AttentionActivity.focus_score.isnot(None))
    avg_q = _apply_brain_side(avg_q, AttentionActivity.brain_side, brain_side)
    average_focus_score = avg_q.scalar() or 0

    int_q = db.query(AttentionActivity).filter(*base_filter, AttentionActivity.completion_status == 'interrupted')
    int_q = _apply_brain_side(int_q, AttentionActivity.brain_side, brain_side)
    interruptions = int_q.count()

    dw_q = db.query(DeepWorkSession).filter(
        DeepWorkSession.user_id == current_user.id,
        DeepWorkSession.started_at >= week_start
    )
    dw_q = _apply_brain_side(dw_q, DeepWorkSession.brain_side, brain_side)
    deep_work_sessions = dw_q.count()

    daily_trend = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        dq = db.query(func.sum(AttentionActivity.actual_duration)).filter(
            AttentionActivity.user_id == current_user.id,
            AttentionActivity.start_time >= day,
            AttentionActivity.start_time < day + timedelta(days=1)
        )
        dq = _apply_brain_side(dq, AttentionActivity.brain_side, brain_side)
        daily_trend.append({
            "date": day.strftime("%Y-%m-%d"),
            "day": day.strftime("%a"),
            "focus_minutes": round(dq.scalar() or 0, 1)
        })

    category_map = {
        "work": {"name": "工作", "color": "#58a6ff"},
        "study": {"name": "学习", "color": "#3fb950"},
        "entertainment": {"name": "娱乐", "color": "#f778ba"},
        "social": {"name": "社交", "color": "#d29922"},
        "other": {"name": "其他", "color": "#8b949e"},
    }
    cat_q = db.query(
        AttentionActivity.category,
        func.sum(AttentionActivity.actual_duration),
        func.count(AttentionActivity.id)
    ).filter(*base_filter)
    cat_q = _apply_brain_side(cat_q, AttentionActivity.brain_side, brain_side)
    category_counts = cat_q.group_by(AttentionActivity.category).all()

    category_distribution = []
    for cat, duration, count in category_counts:
        info = category_map.get(cat, category_map["other"])
        category_distribution.append({
            "key": cat,
            "name": info["name"],
            "color": info["color"],
            "minutes": round(duration or 0, 1),
            "count": count,
        })

    return AttentionWeeklyReport(
        week_start=week_start.strftime("%Y-%m-%d"),
        week_end=today.strftime("%Y-%m-%d"),
        brain_side=brain_side,
        total_focus_minutes=round(total_focus_minutes, 1),
        total_activities=total_activities,
        deep_work_sessions=deep_work_sessions,
        interruptions=interruptions,
        average_focus_score=round(float(average_focus_score), 1),
        daily_trend=daily_trend,
        category_distribution=category_distribution,
    )

@router.get("/score", summary="Focus score", description="Get focus score with breakdown and trend. Optional brain_side filter: personal | network | both.")
async def get_score(
    brain_side: str = "both",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Focus duration score (60%): max 8 hours = 100
    total_focus_query = db.query(func.sum(AttentionActivity.actual_duration)).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today
    )
    total_focus_query = _apply_brain_side(total_focus_query, AttentionActivity.brain_side, brain_side)
    total_focus_minutes = total_focus_query.scalar() or 0
    focus_duration_score = min(100, round((total_focus_minutes / 60) / 8 * 100, 1))

    # Interruption penalty (20%): each interruption -5, min 0
    interruption_count_query = db.query(AttentionActivity).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today,
        AttentionActivity.completion_status == 'interrupted'
    )
    interruption_count_query = _apply_brain_side(interruption_count_query, AttentionActivity.brain_side, brain_side)
    interruption_count = interruption_count_query.count()
    interruption_penalty = max(0, 100 - interruption_count * 5)

    # Deep work score (20%): each session +15, max 100
    deep_work_count_query = db.query(DeepWorkSession).filter(
        DeepWorkSession.user_id == current_user.id,
        DeepWorkSession.started_at >= today
    )
    deep_work_count_query = _apply_brain_side(deep_work_count_query, DeepWorkSession.brain_side, brain_side)
    deep_work_count = deep_work_count_query.count()
    deep_work_score = min(100, deep_work_count * 15)

    # Weighted total
    total_score = round(
        focus_duration_score * 0.6 +
        interruption_penalty * 0.2 +
        deep_work_score * 0.2,
        1
    )

    # Historical trend (last 7 days)
    trend = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_focus_query = db.query(func.sum(AttentionActivity.actual_duration)).filter(
            AttentionActivity.user_id == current_user.id,
            AttentionActivity.start_time >= day,
            AttentionActivity.start_time < day + timedelta(days=1)
        )
        day_focus_query = _apply_brain_side(day_focus_query, AttentionActivity.brain_side, brain_side)
        day_focus = day_focus_query.scalar() or 0

        day_interruptions_query = db.query(AttentionActivity).filter(
            AttentionActivity.user_id == current_user.id,
            AttentionActivity.start_time >= day,
            AttentionActivity.start_time < day + timedelta(days=1),
            AttentionActivity.completion_status == 'interrupted'
        )
        day_interruptions_query = _apply_brain_side(day_interruptions_query, AttentionActivity.brain_side, brain_side)
        day_interruptions = day_interruptions_query.count()

        day_deep_query = db.query(DeepWorkSession).filter(
            DeepWorkSession.user_id == current_user.id,
            DeepWorkSession.started_at >= day,
            DeepWorkSession.started_at < day + timedelta(days=1)
        )
        day_deep_query = _apply_brain_side(day_deep_query, DeepWorkSession.brain_side, brain_side)
        day_deep = day_deep_query.count()

        d_score = min(100, round((day_focus / 60) / 8 * 100, 1))
        i_score = max(0, 100 - day_interruptions * 5)
        dw_score = min(100, day_deep * 15)
        day_total = round(d_score * 0.6 + i_score * 0.2 + dw_score * 0.2, 1)

        trend.append({
            "date": day.strftime("%Y-%m-%d"),
            "day": day.strftime("%a"),
            "score": day_total,
        })

    return AttentionScore(
        score=total_score,
        breakdown={
            "focus_duration_score": focus_duration_score,
            "interruption_penalty": interruption_penalty,
            "deep_work_score": deep_work_score,
        },
        trend=trend,
    )

@router.post("/deep-work", response_model=DeepWorkSessionResponse, status_code=201, summary="Start deep work", description="Start a deep work session.")
async def start_deep_work(
    config: DeepWorkConfig,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = DeepWorkSession(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=config.brain_side or "personal",
        task=config.task,
        planned_duration=config.planned_duration,
        started_at=datetime.now(),
        rules_block_notifications=config.rules_block_notifications,
        rules_blocked_websites=json.dumps(config.rules_blocked_websites) if config.rules_blocked_websites else None,
        rules_blocked_apps=json.dumps(config.rules_blocked_apps) if config.rules_blocked_apps else None,
        rules_allowed_websites=json.dumps(config.rules_allowed_websites) if config.rules_allowed_websites else None,
        rules_ambient_sound=config.rules_ambient_sound,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.put("/deep-work/{session_id}/pause", summary="Pause deep work", description="Pause a deep work session.")
async def pause_deep_work(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(DeepWorkSession).filter(
        DeepWorkSession.id == session_id,
        DeepWorkSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completion_status == 'completed':
        raise HTTPException(status_code=409, detail="会话已结束，无法暂停")
    if session.completion_status != 'paused':
        # active → paused：把已计时分钟累计进 actual_duration，恢复时重新起算，
        # 这样暂停时间不会计入专注时长
        if session.started_at:
            elapsed_min = int((datetime.now() - session.started_at).total_seconds() / 60)
            session.actual_duration = (session.actual_duration or 0) + max(0, elapsed_min)
    session.completion_status = 'paused'
    db.commit()
    db.refresh(session)
    return {"success": True, "session_id": session_id, "status": "paused"}

@router.put("/deep-work/{session_id}/resume", summary="Resume deep work", description="Resume a paused deep work session.")
async def resume_deep_work(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(DeepWorkSession).filter(
        DeepWorkSession.id == session_id,
        DeepWorkSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completion_status == 'completed':
        raise HTTPException(status_code=409, detail="会话已结束，无法恢复")
    if session.completion_status == 'paused':
        # 暂停期间不计时：从恢复时刻重新起算
        session.started_at = datetime.now()
    session.completion_status = 'active'
    db.commit()
    db.refresh(session)
    return {"success": True, "session_id": session_id, "status": "active"}

@router.post("/deep-work/{session_id}/interruption", summary="Record interruption", description="Record an interruption during a deep work session.")
async def record_interruption(
    session_id: str,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(DeepWorkSession).filter(
        DeepWorkSession.id == session_id,
        DeepWorkSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completion_status == 'completed':
        raise HTTPException(status_code=409, detail="会话已结束，无法记录干扰")
    session.interruptions = (session.interruptions or 0) + 1
    # Store interruption logs in end_reason field as JSON (temporary until dedicated column exists)
    logs = []
    if session.end_reason:
        try:
            logs = json.loads(session.end_reason)
            if not isinstance(logs, list):
                logs = []
        except:
            logs = []
    logs.append({
        "reason": data.get("reason", "other"),
        "timestamp": datetime.now().isoformat(),
    })
    session.end_reason = json.dumps(logs)
    db.commit()
    db.refresh(session)
    return {"success": True, "session_id": session_id, "interruptions": session.interruptions}

@router.post("/deep-work/{session_id}/end", summary="End deep work", description="End a deep work session.")
async def end_deep_work(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(DeepWorkSession).filter(
        DeepWorkSession.id == session_id,
        DeepWorkSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.completion_status == 'completed':
        # 幂等：重复结束不重复累计时长、不重复写活动
        return {"success": True, "session_id": session_id}

    now = datetime.now()
    session.ended_at = now
    if session.started_at:
        elapsed_min = int((now - session.started_at).total_seconds() / 60)
        session.actual_duration = (session.actual_duration or 0) + max(0, elapsed_min)
    session.completion_status = 'completed'

    # 同步写入注意力活动，让仪表盘/统计/评分拿到真实专注时长
    duration_min = session.actual_duration or 0
    activity = AttentionActivity(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        category_id="deep-work",
        category="work",
        brain_side=session.brain_side,
        description=f"深度工作：{session.task}",
        start_time=now - timedelta(minutes=duration_min),
        end_time=now,
        actual_duration=duration_min,
        source="manual",
        completion_status="completed",
    )
    db.add(activity)
    db.commit()
    db.refresh(session)
    return {"success": True, "session_id": session_id}

@router.get("/deep-work", response_model=list[DeepWorkSessionResponse], summary="List deep work sessions", description="Get deep work history. Optional brain_side filter.")
async def list_deep_work(
    brain_side: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(DeepWorkSession).filter(
        DeepWorkSession.user_id == current_user.id
    )
    if brain_side and brain_side != "both":
        query = query.filter(DeepWorkSession.brain_side == brain_side)
    sessions = query.order_by(DeepWorkSession.started_at.desc()).all()
    return sessions

@router.get("/categories", response_model=list[AttentionCategoryResponse], summary="List categories", description="Get attention categories for the current user with today usage.")
async def list_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from datetime import date
    categories = db.query(AttentionCategory).filter(AttentionCategory.user_id == current_user.id).all()

    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = datetime.combine(date.today(), datetime.max.time())
    usage = db.query(
        AttentionActivity.category_id,
        func.coalesce(func.sum(AttentionActivity.actual_duration), 0)
    ).filter(
        AttentionActivity.user_id == current_user.id,
        AttentionActivity.start_time >= today_start,
        AttentionActivity.start_time <= today_end,
    ).group_by(AttentionActivity.category_id).all()
    usage_map = {cid: float(minutes) for cid, minutes in usage}

    result = []
    for cat in categories:
        data = {c.name: getattr(cat, c.name) for c in cat.__table__.columns}
        data["used_minutes"] = round(usage_map.get(cat.id, 0), 1)
        result.append(AttentionCategoryResponse(**data))
    return result

@router.post("/categories", response_model=AttentionCategoryResponse, status_code=201, summary="Create category", description="Create a new attention category.")
async def create_category(
    category_data: AttentionCategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    category = AttentionCategory(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        name=category_data.name,
        icon=category_data.icon,
        color=category_data.color,
        brain_side=category_data.brain_side or "personal",
        allocated_minutes=category_data.allocated_minutes,
        min_required=category_data.min_required,
        max_allowed=category_data.max_allowed,
        priority=category_data.priority,
        auto_rebalance_from=json.dumps(category_data.auto_rebalance_from) if category_data.auto_rebalance_from else None,
        notify_at=category_data.notify_at,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return AttentionCategoryResponse(**{c.name: getattr(category, c.name) for c in category.__table__.columns}, used_minutes=0.0)

@router.put("/categories/{category_id}", response_model=AttentionCategoryResponse, summary="Update category")
async def update_category(
    category_id: str,
    category_data: AttentionCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    category = db.query(AttentionCategory).filter(
        AttentionCategory.id == category_id,
        AttentionCategory.user_id == current_user.id,
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = category_data.model_dump(exclude_unset=True)
    if "auto_rebalance_from" in update_data and update_data["auto_rebalance_from"] is not None:
        update_data["auto_rebalance_from"] = json.dumps(update_data["auto_rebalance_from"])
    for key, value in update_data.items():
        setattr(category, key, value)
    db.commit()
    db.refresh(category)
    return AttentionCategoryResponse(**{c.name: getattr(category, c.name) for c in category.__table__.columns}, used_minutes=0.0)

@router.delete("/categories/{category_id}", status_code=204, summary="Delete category")
async def delete_category(
    category_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    category = db.query(AttentionCategory).filter(
        AttentionCategory.id == category_id,
        AttentionCategory.user_id == current_user.id,
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(category)
    db.commit()
    return None


# ---------- Guardian Rules ----------

@router.get("/guardian-rules", response_model=list[AttentionGuardianRuleResponse], summary="List guardian rules")
async def list_guardian_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rules = db.query(AttentionGuardianRule).filter(
        AttentionGuardianRule.user_id == current_user.id
    ).order_by(AttentionGuardianRule.created_at.desc()).all()
    return rules


@router.post("/guardian-rules", response_model=AttentionGuardianRuleResponse, status_code=201, summary="Create guardian rule")
async def create_guardian_rule(
    data: AttentionGuardianRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rule = AttentionGuardianRule(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        type=data.type,
        target=data.target,
        mode=data.mode,
        limit_minutes=data.limit_minutes,
        active=data.active,
        schedule_days=json.dumps(data.schedule_days) if data.schedule_days else None,
        schedule_start=data.schedule_start,
        schedule_end=data.schedule_end,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/guardian-rules/{rule_id}", response_model=AttentionGuardianRuleResponse, summary="Update guardian rule")
async def update_guardian_rule(
    rule_id: str,
    data: AttentionGuardianRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rule = db.query(AttentionGuardianRule).filter(
        AttentionGuardianRule.id == rule_id,
        AttentionGuardianRule.user_id == current_user.id,
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    update_data = data.model_dump(exclude_unset=True)
    if "schedule_days" in update_data and update_data["schedule_days"] is not None:
        update_data["schedule_days"] = json.dumps(update_data["schedule_days"])
    for key, value in update_data.items():
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/guardian-rules/{rule_id}", status_code=204, summary="Delete guardian rule")
async def delete_guardian_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rule = db.query(AttentionGuardianRule).filter(
        AttentionGuardianRule.id == rule_id,
        AttentionGuardianRule.user_id == current_user.id,
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return None


# ---------- Rations ----------

@router.get("/rations", response_model=list[AttentionRationResponse], summary="List attention rations")
async def list_rations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rations = db.query(AttentionRation).filter(
        AttentionRation.user_id == current_user.id
    ).order_by(AttentionRation.created_at.desc()).all()
    return rations


@router.post("/rations", response_model=AttentionRationResponse, status_code=201, summary="Create attention ration")
async def create_ration(
    data: AttentionRationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ration = AttentionRation(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        source_type=data.source_type,
        source_id=data.source_id,
        name=data.name,
        daily_limit_minutes=data.daily_limit_minutes,
        active=data.active,
    )
    db.add(ration)
    db.commit()
    db.refresh(ration)
    return ration


@router.put("/rations/{ration_id}", response_model=AttentionRationResponse, summary="Update attention ration")
async def update_ration(
    ration_id: str,
    data: AttentionRationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ration = db.query(AttentionRation).filter(
        AttentionRation.id == ration_id,
        AttentionRation.user_id == current_user.id,
    ).first()
    if not ration:
        raise HTTPException(status_code=404, detail="Ration not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ration, key, value)
    db.commit()
    db.refresh(ration)
    return ration


@router.delete("/rations/{ration_id}", status_code=204, summary="Delete attention ration")
async def delete_ration(
    ration_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ration = db.query(AttentionRation).filter(
        AttentionRation.id == ration_id,
        AttentionRation.user_id == current_user.id,
    ).first()
    if not ration:
        raise HTTPException(status_code=404, detail="Ration not found")
    db.delete(ration)
    db.commit()
    return None
