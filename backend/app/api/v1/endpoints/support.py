from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid

from app.core.database import get_db
from app.models.base import SupportTicket, SupportTicketReply, User
from app.core.security import get_current_user

from app.core.xss_sanitizer import sanitize_support_input

router = APIRouter()


class TicketCreate(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200, description="Ticket subject")
    description: str = Field(..., min_length=1, max_length=50000, description="Ticket description")
    category: str = Field("general", max_length=50, description="Ticket category")


class TicketReplyCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000, description="Reply content")


@router.post("/tickets", summary="Create support ticket", description="Create a new support ticket.")
async def create_ticket(
    data: TicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    safe_subject, safe_description = sanitize_support_input(data.subject, data.description)
    ticket = SupportTicket(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        user_email=current_user.email,
        subject=safe_subject,
        description=safe_description,
        status="open",
        priority="medium",
        category=data.category,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return {"id": ticket.id, "message": "Ticket created successfully"}


@router.get("/tickets", summary="List my tickets", description="List current user's support tickets.")
async def list_my_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tickets = db.query(SupportTicket).filter(
        SupportTicket.user_id == current_user.id
    ).order_by(SupportTicket.created_at.desc()).all()

    return [
        {
            "id": t.id,
            "subject": t.subject,
            "status": t.status,
            "priority": t.priority,
            "category": t.category,
            "created_at": t.created_at,
            "updated_at": t.updated_at,
        }
        for t in tickets
    ]


@router.get("/tickets/{ticket_id}", summary="Get ticket details", description="Get support ticket details with replies.")
async def get_my_ticket(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ticket = db.query(SupportTicket).filter(
        SupportTicket.id == ticket_id,
        SupportTicket.user_id == current_user.id
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    replies = db.query(SupportTicketReply).filter(
        SupportTicketReply.ticket_id == ticket_id
    ).order_by(SupportTicketReply.created_at).all()

    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "assigned_to": ticket.assigned_to,
        "satisfaction": ticket.satisfaction,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "replies": [
            {
                "id": r.id,
                "user_email": r.user_email,
                "is_admin": r.is_admin,
                "content": r.content,
                "created_at": r.created_at,
            }
            for r in replies
        ],
    }


@router.post("/tickets/{ticket_id}/reply", summary="Reply to ticket", description="Reply to a support ticket.")
async def reply_to_ticket(
    ticket_id: str,
    data: TicketReplyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ticket = db.query(SupportTicket).filter(
        SupportTicket.id == ticket_id,
        SupportTicket.user_id == current_user.id
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    reply = SupportTicketReply(
        id=str(uuid.uuid4()),
        ticket_id=ticket_id,
        user_id=current_user.id,
        user_email=current_user.email,
        is_admin=False,
        content=sanitize_support_input(None, data.content)[1],
    )
    db.add(reply)
    ticket.updated_at = datetime.utcnow()
    db.commit()

    return {"message": "Reply sent", "reply_id": reply.id}
