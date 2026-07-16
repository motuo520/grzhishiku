"""Add read_later_items and documents tables

Revision ID: 008_add_readlater_documents
Revises: 007_add_social_tables
Create Date: 2026-07-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, DateTime, Integer, Boolean, Text

# revision identifiers
revision = '008_add_readlater_documents'
down_revision = '007_add_social_tables'
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
    if not _table_exists('read_later_items'):
        op.create_table(
            'read_later_items',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('title', String),
            sa.Column('url', String, nullable=False),
            sa.Column('domain', String),
            sa.Column('excerpt', Text),
            sa.Column('full_text', Text),
            sa.Column('cover_image', String),
            sa.Column('status', String, default='unread'),
            sa.Column('is_favorite', Boolean, default=False),
            sa.Column('read_progress', Integer, default=0),
            sa.Column('source', String, default='manual'),
            sa.Column('item_status', String, default='active'),
            sa.Column('knowledge_id', String),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )
    if not _index_exists('ix_read_later_user_status', 'read_later_items'):
        op.create_index('ix_read_later_user_status', 'read_later_items', ['user_id', 'item_status'])
    if not _index_exists('ix_read_later_user_domain', 'read_later_items'):
        op.create_index('ix_read_later_user_domain', 'read_later_items', ['user_id', 'domain'])

    if not _table_exists('documents'):
        op.create_table(
            'documents',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('title', String),
            sa.Column('original_name', String, nullable=False),
            sa.Column('file_path', String, nullable=False),
            sa.Column('file_size', Integer, default=0),
            sa.Column('file_type', String),
            sa.Column('content_text', Text),
            sa.Column('extraction_status', String, default='pending'),
            sa.Column('extraction_error', Text),
            sa.Column('doc_status', String, default='active'),
            sa.Column('knowledge_id', String),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )
    if not _index_exists('ix_documents_user_status', 'documents'):
        op.create_index('ix_documents_user_status', 'documents', ['user_id', 'doc_status'])
    if not _index_exists('ix_documents_user_type', 'documents'):
        op.create_index('ix_documents_user_type', 'documents', ['user_id', 'file_type'])


def downgrade():
    if _index_exists('ix_documents_user_type', 'documents'):
        op.drop_index('ix_documents_user_type', table_name='documents')
    if _index_exists('ix_documents_user_status', 'documents'):
        op.drop_index('ix_documents_user_status', table_name='documents')
    if _table_exists('documents'):
        op.drop_table('documents')
    if _index_exists('ix_read_later_user_domain', 'read_later_items'):
        op.drop_index('ix_read_later_user_domain', table_name='read_later_items')
    if _index_exists('ix_read_later_user_status', 'read_later_items'):
        op.drop_index('ix_read_later_user_status', table_name='read_later_items')
    if _table_exists('read_later_items'):
        op.drop_table('read_later_items')
