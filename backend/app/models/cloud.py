from sqlalchemy import Column, String, DateTime, Float, Boolean
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = ["CloudBinding"]


class CloudBinding(Base):
    """云端账号绑定（用户级）：每个本地用户各绑各的云端号。

    取代早期机器级 cloud_account.json——机器级绑定让本机所有本地号共享
    云端会员与余额，批量注册本地号即可白嫖；用户级绑定后新号无绑定即
    纯免费本地版。旧文件在首次访问时自动迁移（见 app.core.cloud_binding）。
    """

    __tablename__ = "cloud_bindings"

    user_id = Column(String, primary_key=True)
    server_url = Column(String, nullable=False)
    email = Column(String, nullable=False)
    token = Column(String, nullable=False)
    # refresh token（30 天滑动续期）：access token 7 天过期后凭它静默续期，
    # 不再 401 即删绑定（09-22 实捕：绑定 7 天必死、平台模型整组消失）
    refresh_token = Column(String, default="")
    tier = Column(String)                    # 云端订阅 tier 缓存
    tier_checked_at = Column(Float, default=0)  # tier 缓存时间戳（epoch 秒）
    # 云端会员总开关缓存（/users/me 带出；NULL=从未拉到，维持本机口径不放行）
    membership_enabled = Column(Boolean)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
