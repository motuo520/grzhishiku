"""Add email_accounts and email_messages tables

Revision ID: 006_add_email_tables
Revises: 005_add_tags_and_content_tags
Create Date: 2026-07-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, DateTime, Integer, Boolean, Text

# revision identifiers
revision = '006_add_email_tables'
down_revision = '005_add_tags_and_content_tags'
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
    if not _table_exists('email_accounts'):
        op.create_table(
            'email_accounts',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('provider', String, nullable=False),
            sa.Column('email_address', String, nullable=False),
            sa.Column('imap_host', String),
            sa.Column('imap_port', Integer, default=993),
            sa.Column('imap_use_ssl', Boolean, default=True),
            sa.Column('access_token', Text),
            sa.Column('refresh_token', Text),
            sa.Column('sync_status', String, default='pending'),
            sa.Column('last_sync_at', DateTime),
            sa.Column('last_error', Text),
            sa.Column('sync_count', Integer, default=0),
            sa.Column('status', String, default='active'),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )
    if not _index_exists('ix_email_accounts_user_status', 'email_accounts'):
        op.create_index('ix_email_accounts_user_status', 'email_accounts', ['user_id', 'status'])

    if not _table_exists('email_messages'):
        op.create_table(
            'email_messages',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('account_id', String, nullable=False),
            sa.Column('message_uid', String, nullable=False),
            sa.Column('subject', String),
            sa.Column('sender_name', String),
            sa.Column('sender_email', String),
            sa.Column('recipients_to', Text),
            sa.Column('recipients_cc', Text),
            sa.Column('body_text', Text),
            sa.Column('body_html', Text),
            sa.Column('received_at', DateTime),
            sa.Column('is_read', Boolean, default=False),
            sa.Column('labels', Text),
            sa.Column('status', String, default='active'),
            sa.Column('knowledge_id', String),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )
    if not _index_exists('ix_email_messages_account_uid', 'email_messages'):
        op.create_index('ix_email_messages_account_uid', 'email_messages', ['account_id', 'message_uid'], unique=True)
    if not _index_exists('ix_email_messages_user_status', 'email_messages'):
        op.create_index('ix_email_messages_user_status', 'email_messages', ['user_id', 'status'])
    if not _index_exists('ix_email_messages_sender_email', 'email_messages'):
        op.create_index('ix_email_messages_sender_email', 'email_messages', ['sender_email'])
    if not _index_exists('ix_email_messages_received_at', 'email_messages'):
        op.create_index('ix_email_messages_received_at', 'email_messages', ['received_at'])


def downgrade():
    if _index_exists('ix_email_messages_received_at', 'email_messages'):
        op.drop_index('ix_email_messages_received_at', table_name='email_messages')
    if _index_exists('ix_email_messages_sender_email', 'email_messages'):
        op.drop_index('ix_email_messages_sender_email', table_name='email_messages')
    if _index_exists('ix_email_messages_user_status', 'email_messages'):
        op.drop_index('ix_email_messages_user_status', table_name='email_messages')
    if _index_exists('ix_email_messages_account_uid', 'email_messages'):
        op.drop_index('ix_email_messages_account_uid', table_name='email_messages')
    if _table_exists('email_messages'):
        op.drop_table('email_messages')
    if _index_exists('ix_email_accounts_user_status', 'email_accounts'):
        op.drop_index('ix_email_accounts_user_status', table_name='email_accounts')
    if _table_exists('email_accounts'):
        op.drop_table('email_accounts')
