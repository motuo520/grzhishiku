from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class DataPackage(Base):
    """用户数据打包记录"""
    __tablename__ = "data_packages"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending / ready / failed / uploaded
    provider = Column(String, nullable=True)  # baidu / aliyun / local
    remote_path = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_data_packages_user_status', 'user_id', 'status'),
    )


class UserCloudDrive(Base):
    """用户第三方网盘授权"""
    __tablename__ = "user_cloud_drives"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)  # baidu / aliyun
    account_name = Column(String, nullable=True)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    scope = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_user_cloud_drives_user_provider', 'user_id', 'provider', unique=True),
    )
