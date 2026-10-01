"""检索健康度运行时计数表：日级聚合小表。

(day, metric) 联合主键，value 累加；由 app/services/retrieval_metrics.py 原子 upsert。
"""
from sqlalchemy import Column, String, Integer
from app.core.database import Base

__all__ = ["RetrievalMetricsDaily"]


class RetrievalMetricsDaily(Base):
    __tablename__ = "retrieval_metrics_daily"

    day = Column(String, primary_key=True)  # YYYY-MM-DD（UTC）
    metric = Column(String, primary_key=True)
    value = Column(Integer, nullable=False, default=0)
