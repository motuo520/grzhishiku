"""Add social_accounts and social_messages tables

Revision ID: 007_add_social_tables
Revises: 006_add_email_tables
Create Date: 2026-07-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, DateTime, Integer, Boolean, Text

# revision identifiers
revision = '007_add_social_tables'
down_revision = '006_add_email_tables'
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name}
    )
    return result.scalar() is not None


def _index_exists(index_name: str, table_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='index' AND name=:name AND tbl_name=:tbl"),
        {"name": index_name, "tbl": table_name}
    )
    return result.scalar() is not None


def upgrade():
    if not _table_exists('social_accounts'):
        op.create_table(
            'social_accounts',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('provider', String, nullable=False),  # wechat / dingtalk / feishu
            sa.Column('account_name', String),
            sa.Column('connection_type', String, default='local_import'),  # local_import / oauth_api
            sa.Column('oauth_token', Text),
            sa.Column('oauth_refresh_token', Text),
            sa.Column('oauth_expires_at', DateTime),
            sa.Column('sync_status', String, default='pending'),
            sa.Column('last_sync_at', DateTime),
            sa.Column('last_error', Text),
            sa.Column('sync_count', Integer, default=0),
            sa.Column('status', String, default='active'),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )
    if not _index_exists('ix_social_accounts_user_status', 'social_accounts'):
        op.create_index('ix_social_accounts_user_status', 'social_accounts', ['user_id', 'status'])

    if not _table_exists('social_messages'):
        op.create_table(
            'social_messages',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('account_id', String, nullable=False),
            sa.Column('platform', String, nullable=False),  # wechat / dingtalk / feishu
            sa.Column('conversation_id', String),
            sa.Column('conversation_name', String),
            sa.Column('message_uid', String, nullable=False),
            sa.Column('sender_name', String),
            sa.Column('sender_id', String),
            sa.Column('content_raw', Text),
            sa.Column('content_text', Text),
            sa.Column('message_type', String, default='text'),  # text / image / file / link / system
            sa.Column('attachments', Text),  # JSON
            sa.Column('sent_at', DateTime),
            sa.Column('is_me', Boolean, default=False),
            sa.Column('status', String, default='active'),  # active / imported_to_knowledge / deleted
            sa.Column('knowledge_id', String),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )
    if not _index_exists('ix_social_messages_account_uid', 'social_messages'):
        op.create_index('ix_social_messages_account_uid', 'social_messages', ['account_id', 'message_uid'], unique=True)
    if not _index_exists('ix_social_messages_user_status', 'social_messages'):
        op.create_index('ix_social_messages_user_status', 'social_messages', ['user_id', 'status'])
    if not _index_exists('ix_social_messages_sent_at', 'social_messages'):
        op.create_index('ix_social_messages_sent_at', 'social_messages', ['sent_at'])
    if not _index_exists('ix_social_messages_conversation', 'social_messages'):
        op.create_index('ix_social_messages_conversation', 'social_messages', ['account_id', 'conversation_id'])


def downgrade():
    if _index_exists('ix_social_messages_conversation', 'social_messages'):
        op.drop_index('ix_social_messages_conversation', table_name='social_messages')
    if _index_exists('ix_social_messages_sent_at', 'social_messages'):
        op.drop_index('ix_social_messages_sent_at', table_name='social_messages')
    if _index_exists('ix_social_messages_user_status', 'social_messages'):
        op.drop_index('ix_social_messages_user_status', table_name='social_messages')
    if _index_exists('ix_social_messages_account_uid', 'social_messages'):
        op.drop_index('ix_social_messages_account_uid', table_name='social_messages')
    if _table_exists('social_messages'):
        op.drop_table('social_messages')
    if _index_exists('ix_social_accounts_user_status', 'social_accounts'):
        op.drop_index('ix_social_accounts_user_status', table_name='social_accounts')
    if _table_exists('social_accounts'):
        op.drop_table('social_accounts')
