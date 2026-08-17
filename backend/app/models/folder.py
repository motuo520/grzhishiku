from sqlalchemy import Column, String, DateTime, Integer, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["Folder"]


class Folder(Base):
    """每脑文件夹树：文件夹必属一个脑（personal / network），管「笔记放在哪」。"""

    __tablename__ = "folders"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    brain_side = Column(String, nullable=False)  # personal / network（无 both）
    parent_id = Column(String, index=True)  # 可空，空=根级
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_folders_user_brain', 'user_id', 'brain_side'),
    )
