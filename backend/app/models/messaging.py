from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = [
    "RssFeed", "RssEntry", "EmailAccount", "EmailMessage",
    "SocialAccount", "SocialMessage",
]


class RssFeed(Base):
    __tablename__ = "rss_feeds"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String)
    url = Column(String, nullable=False)
    description = Column(Text)
    site_url = Column(String)
    language = Column(String)
    last_fetched_at = Column(DateTime)
    fetch_status = Column(String, default="pending")  # pending / success / error
    fetch_error = Column(Text)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_rss_feeds_user_status', 'user_id', 'status'),
    )

class RssEntry(Base):
    __tablename__ = "rss_entries"

    id = Column(String, primary_key=True)
    feed_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String)
    link = Column(String, nullable=False)
    summary = Column(Text)
    content = Column(Text)
    author = Column(String)
    published_at = Column(DateTime)
    is_read = Column(Boolean, default=False)
    is_saved = Column(Boolean, default=False)  # saved to clip/knowledge
    external_id = Column(String, index=True)  # guid / id from feed
    status = Column(String, default="active")
    pipeline_stage = Column(String, default="raw")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_rss_entries_feed', 'feed_id', 'published_at'),
        Index('ix_rss_entries_user_saved', 'user_id', 'is_saved'),
        Index('ix_rss_entries_user_pipeline', 'user_id', 'pipeline_stage'),
    )

class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)  # gmail / outlook / qq / 163 / imap_other
    email_address = Column(String, nullable=False)
    imap_host = Column(String)
    imap_port = Column(Integer, default=993)
    imap_use_ssl = Column(Boolean, default=True)
    access_token = Column(Text)      # encrypted OAuth token or IMAP password/auth code
    refresh_token = Column(Text)     # encrypted OAuth refresh token
    sync_status = Column(String, default="pending")  # pending / syncing / success / error
    last_sync_at = Column(DateTime)
    last_error = Column(Text)
    sync_count = Column(Integer, default=0)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_email_accounts_user_status', 'user_id', 'status'),
    )


class EmailMessage(Base):
    __tablename__ = "email_messages"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    account_id = Column(String, nullable=False, index=True)
    message_uid = Column(String, nullable=False)  # IMAP UID or provider message id
    subject = Column(String)
    sender_name = Column(String)
    sender_email = Column(String, index=True)
    recipients_to = Column(Text)  # JSON
    recipients_cc = Column(Text)  # JSON
    body_text = Column(Text)
    body_html = Column(Text)
    received_at = Column(DateTime, index=True)
    is_read = Column(Boolean, default=False)
    labels = Column(Text)  # JSON array
    status = Column(String, default="active")  # active / imported_to_knowledge / archived
    knowledge_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_email_messages_account_uid', 'account_id', 'message_uid', unique=True),
        Index('ix_email_messages_user_status', 'user_id', 'status'),
    )


class SocialAccount(Base):
    __tablename__ = "social_accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)  # wechat / dingtalk / feishu
    account_name = Column(String)
    connection_type = Column(String, default="local_import")  # local_import / oauth_api
    oauth_token = Column(Text)
    oauth_refresh_token = Column(Text)
    oauth_expires_at = Column(DateTime)
    sync_status = Column(String, default="pending")  # pending / syncing / success / error
    last_sync_at = Column(DateTime)
    last_error = Column(Text)
    sync_count = Column(Integer, default=0)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_social_accounts_user_status', 'user_id', 'status'),
    )


class SocialMessage(Base):
    __tablename__ = "social_messages"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    account_id = Column(String, nullable=False, index=True)
    platform = Column(String, nullable=False)  # wechat / dingtalk / feishu
    conversation_id = Column(String)
    conversation_name = Column(String)
    message_uid = Column(String, nullable=False)
    sender_name = Column(String)
    sender_id = Column(String)
    content_raw = Column(Text)
    content_text = Column(Text)
    message_type = Column(String, default="text")  # text / image / file / link / system
    attachments = Column(Text)  # JSON
    sent_at = Column(DateTime)
    is_me = Column(Boolean, default=False)
    status = Column(String, default="active")  # active / imported_to_knowledge / deleted
    knowledge_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_social_messages_account_uid', 'account_id', 'message_uid', unique=True),
        Index('ix_social_messages_user_status', 'user_id', 'status'),
    )
