from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["Lead"]


class Lead(Base):
    """企业版意向线索：官网定价区「企业版」占位表单收集，无账号体系要求。"""

    __tablename__ = "leads"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, index=True)
    company = Column(String)
    team_size = Column(String)          # 如 "1-10" / "11-50" / "51-200" / "200+"
    message = Column(Text)
    source = Column(String, default="pricing")  # 收集入口：pricing / paywall ...
    status = Column(String, default="new")      # new / contacted / converted / closed
    created_at = Column(DateTime, server_default=func.now())
