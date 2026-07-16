from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["SupportTicket", "SupportTicketReply"]


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    user_email = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String, default="open")
    priority = Column(String, default="medium")
    category = Column(String, default="general")
    assigned_to = Column(String)
    satisfaction = Column(Integer, nullable=True)  # 1-5
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SupportTicketReply(Base):
    __tablename__ = "support_ticket_replies"

    id = Column(String, primary_key=True)
    ticket_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False)  # can be user or admin
    user_email = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
