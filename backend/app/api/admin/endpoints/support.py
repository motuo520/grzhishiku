from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import AdminUser, SupportTicket, SupportTicketReply, User
from app.api.admin.endpoints.auth import get_current_admin
from app.core.xss_sanitizer import sanitize_markdown

router = APIRouter()


class TicketReplyCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000, description="Reply content")


class TicketAssign(BaseModel):
    assigned_to: Optional[str] = Field(None, max_length=100)


class TicketStatusUpdate(BaseModel):
    status: str = Field(..., max_length=50, description="New status")


class TicketResponse(BaseModel):
    id: str
    user_id: str
    user_email: str
    subject: str
    description: str
    status: str
    priority: str
    category: str
    assigned_to: Optional[str]
    assigned_name: Optional[str]
    satisfaction: Optional[int]
    created_at: datetime
    updated_at: datetime
    reply_count: int


@router.get("/tickets", summary="List support tickets", description="List all support tickets with filtering and pagination.")
async def list_tickets(
    status: Optional[str] = Query(None, description="Filter by status: open/closed/pending/in_progress/resolved"),
    category: Optional[str] = Query(None, description="Filter by category: bug/feature/feedback/billing/account/general"),
    priority: Optional[str] = Query(None, description="Filter by priority: low/medium/high/urgent"),
    assigned_to: Optional[str] = Query(None, description="Filter by assigned admin ID"),
    search: Optional[str] = Query(None, description="Search by subject or user email"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SUPPORT_MANAGE))
):
    query = db.query(SupportTicket)

    if status:
        query = query.filter(SupportTicket.status == status)
    if category:
        query = query.filter(SupportTicket.category == category)
    if priority:
        query = query.filter(SupportTicket.priority == priority)
    if assigned_to:
        query = query.filter(SupportTicket.assigned_to == assigned_to)
    if search:
        query = query.filter(
            or_(
                SupportTicket.subject.ilike(f"%{search}%"),
                SupportTicket.user_email.ilike(f"%{search}%"),
            )
        )

    total = query.count()
    tickets = query.order_by(SupportTicket.created_at.desc()).offset(skip).limit(limit).all()

    admins = {a.id: a for a in db.query(AdminUser).all()}
    reply_counts = {}
    for rc in db.query(SupportTicketReply.ticket_id, func.count(SupportTicketReply.id)).group_by(SupportTicketReply.ticket_id).all():
        reply_counts[rc.ticket_id] = rc[1]

    result = []
    for ticket in tickets:
        assigned_admin = admins.get(ticket.assigned_to) if ticket.assigned_to else None
        result.append({
            "id": ticket.id,
            "user_id": ticket.user_id,
            "user_email": ticket.user_email,
            "subject": ticket.subject,
            "description": ticket.description,
            "status": ticket.status,
            "priority": ticket.priority,
            "category": ticket.category,
            "assigned_to": ticket.assigned_to,
            "assigned_name": assigned_admin.name if assigned_admin else None,
            "satisfaction": ticket.satisfaction,
            "created_at": ticket.created_at,
            "updated_at": ticket.updated_at,
            "reply_count": reply_counts.get(ticket.id, 0),
        })

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": result,
    }


@router.get("/tickets/{ticket_id}", summary="Get ticket details", description="Get support ticket details with replies.")
async def get_ticket(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SUPPORT_MANAGE))
):
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    replies = db.query(SupportTicketReply).filter(SupportTicketReply.ticket_id == ticket_id).order_by(SupportTicketReply.created_at).all()

    admins = {a.id: a for a in db.query(AdminUser).all()}
    assigned_admin = admins.get(ticket.assigned_to) if ticket.assigned_to else None

    return {
        "id": ticket.id,
        "user_id": ticket.user_id,
        "user_email": ticket.user_email,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "assigned_to": ticket.assigned_to,
        "assigned_name": assigned_admin.name if assigned_admin else None,
        "satisfaction": ticket.satisfaction,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "replies": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_email": r.user_email,
                "is_admin": r.is_admin,
                "author_type": "admin" if r.is_admin else "user",
                "author_name": "管理员" if r.is_admin else (r.user_email or "用户"),
                "content": r.content,
                "created_at": r.created_at,
            }
            for r in replies
        ],
    }


@router.put("/tickets/{ticket_id}/assign", summary="Assign ticket", description="Assign a ticket to an admin.")
async def assign_ticket(
    ticket_id: str,
    data: TicketAssign,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SUPPORT_MANAGE))
):
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket.assigned_to = data.assigned_to or current_admin.id
    ticket.updated_at = datetime.utcnow()
    db.commit()

    return {"message": "Ticket assigned", "assigned_to": ticket.assigned_to}


@router.put("/tickets/{ticket_id}/status", summary="Update ticket status", description="Update ticket status.")
async def update_ticket_status(
    ticket_id: str,
    data: TicketStatusUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SUPPORT_MANAGE))
):
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket.status = data.status
    ticket.updated_at = datetime.utcnow()
    db.commit()

    return {"message": "Status updated", "status": ticket.status}


@router.post("/tickets/{ticket_id}/replies", summary="Reply to ticket", description="Reply to a support ticket as admin.")
async def reply_to_ticket(
    ticket_id: str,
    data: TicketReplyCreate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SUPPORT_MANAGE))
):
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    reply = SupportTicketReply(
        id=str(uuid.uuid4()),
        ticket_id=ticket_id,
        user_id=current_admin.id,
        user_email=current_admin.email,
        is_admin=True,
        content=sanitize_markdown(data.content),
    )
    db.add(reply)

    if ticket.status == "open":
        ticket.status = "in_progress"
    ticket.updated_at = datetime.utcnow()
    db.commit()

    return {"message": "Reply sent", "reply_id": reply.id}


@router.get("/stats", summary="Support stats", description="Get support ticket statistics.")
async def get_support_stats(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SUPPORT_MANAGE))
):
    today = datetime.utcnow().date()
    today_start = datetime.combine(today, datetime.min.time())

    total = db.query(func.count(SupportTicket.id)).scalar()
    new_today = db.query(func.count(SupportTicket.id)).filter(SupportTicket.created_at >= today_start).scalar()
    open_count = db.query(func.count(SupportTicket.id)).filter(SupportTicket.status == "open").scalar()
    pending_count = db.query(func.count(SupportTicket.id)).filter(SupportTicket.status == "pending").scalar()
    in_progress = db.query(func.count(SupportTicket.id)).filter(SupportTicket.status == "in_progress").scalar()
    resolved = db.query(func.count(SupportTicket.id)).filter(SupportTicket.status == "resolved").scalar()
    closed = db.query(func.count(SupportTicket.id)).filter(SupportTicket.status == "closed").scalar()

    # Average response time: first admin reply time after ticket creation
    avg_response_seconds = None
    tickets_with_replies = db.query(SupportTicket).join(
        SupportTicketReply, SupportTicket.id == SupportTicketReply.ticket_id
    ).filter(SupportTicketReply.is_admin == True).all()

    if tickets_with_replies:
        total_diff = 0
        count = 0
        for ticket in tickets_with_replies:
            first_reply = db.query(SupportTicketReply).filter(
                SupportTicketReply.ticket_id == ticket.id,
                SupportTicketReply.is_admin == True
            ).order_by(SupportTicketReply.created_at).first()
            if first_reply and ticket.created_at:
                diff = (first_reply.created_at - ticket.created_at).total_seconds()
                if diff >= 0:
                    total_diff += diff
                    count += 1
        if count > 0:
            avg_response_seconds = round(total_diff / count)

    # Satisfaction
    avg_satisfaction = db.query(func.avg(SupportTicket.satisfaction)).filter(
        SupportTicket.satisfaction != None
    ).scalar()

    # Category breakdown
    category_counts = {}
    for cat in db.query(SupportTicket.category, func.count(SupportTicket.id)).group_by(SupportTicket.category).all():
        category_counts[cat.category] = cat[1]

    # Priority breakdown
    priority_counts = {}
    for pri in db.query(SupportTicket.priority, func.count(SupportTicket.id)).group_by(SupportTicket.priority).all():
        priority_counts[pri.priority] = pri[1]

    return {
        "totalTickets": total,
        "newToday": new_today,
        "openTickets": open_count,
        "pending": pending_count + in_progress,
        "pendingTickets": pending_count,
        "inProgress": in_progress,
        "resolved": resolved,
        "closed": closed,
        "averageResponseTime": round(avg_response_seconds / 3600, 1) if avg_response_seconds else 0,
        "avgResponseTime": round(avg_response_seconds / 3600, 1) if avg_response_seconds else 0,
        "averageSatisfaction": round(avg_satisfaction, 1) if avg_satisfaction else 0,
        "satisfaction": round(avg_satisfaction, 1) if avg_satisfaction else 0,
        "categoryCounts": category_counts,
        "priorityCounts": priority_counts,
    }
