"""自动日报落库表：每日一份 Markdown 运营日报。

report_date 唯一，同日重复生成=覆盖更新（幂等）；内容全部由 SQL/系统指标
计算，零 LLM 调用。生成逻辑见 app/services/daily_report.py。
"""
from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.sql import func

from app.core.database import Base

__all__ = ["DailyReport"]


class DailyReport(Base):
    __tablename__ = "daily_reports"

    id = Column(String, primary_key=True)
    report_date = Column(String, nullable=False, unique=True, index=True)  # YYYY-MM-DD
    content_md = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
