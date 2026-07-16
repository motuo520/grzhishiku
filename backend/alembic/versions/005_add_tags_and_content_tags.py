"""Add tags and content_tags tables

Revision ID: 005_add_tags_and_content_tags
Revises: 004_billing_system
Create Date: 2026-07-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, DateTime

# revision identifiers
revision = '005_add_tags_and_content_tags'
down_revision = '004_billing_system'
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    """Check if a table exists in the current SQLite database."""
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name}
    )
    return result.scalar() is not None


def _index_exists(index_name: str, table_name: str) -> bool:
    """Check if an index exists in the current SQLite database."""
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='index' AND name=:name AND tbl_name=:tbl"),
        {"name": index_name, "tbl": table_name}
    )
    return result.scalar() is not None


def upgrade():
    if not _table_exists('tags'):
        op.create_table(
            'tags',
            sa.Column('id', String, primary_key=True),
            sa.Column('user_id', String, nullable=False),
            sa.Column('name', String, nullable=False),
            sa.Column('color', String, default='#8b949e'),
            sa.Column('description', String),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
            sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        )

    if not _index_exists('idx_tags_user', 'tags'):
        op.create_index('idx_tags_user', 'tags', ['user_id'])
    if not _index_exists('idx_tags_user_name', 'tags'):
        op.create_index('idx_tags_user_name', 'tags', ['user_id', 'name'])

    if not _table_exists('content_tags'):
        op.create_table(
            'content_tags',
            sa.Column('content_id', String, nullable=False),
            sa.Column('content_type', String, nullable=False),
            sa.Column('tag_id', String, sa.ForeignKey('tags.id'), nullable=False),
            sa.Column('created_at', DateTime, server_default=sa.func.now()),
        )

    if not _index_exists('idx_content_tags_tag', 'content_tags'):
        op.create_index('idx_content_tags_tag', 'content_tags', ['tag_id'])
    if not _index_exists('idx_content_tags_content', 'content_tags'):
        op.create_index('idx_content_tags_content', 'content_tags', ['content_id', 'content_type'])
    if not _index_exists('idx_content_tags_lookup', 'content_tags'):
        op.create_index('idx_content_tags_lookup', 'content_tags', ['content_id', 'content_type', 'tag_id'], unique=True)


def downgrade():
    if _index_exists('idx_content_tags_lookup', 'content_tags'):
        op.drop_index('idx_content_tags_lookup', table_name='content_tags')
    if _index_exists('idx_content_tags_content', 'content_tags'):
        op.drop_index('idx_content_tags_content', table_name='content_tags')
    if _index_exists('idx_content_tags_tag', 'content_tags'):
        op.drop_index('idx_content_tags_tag', table_name='content_tags')
    if _table_exists('content_tags'):
        op.drop_table('content_tags')
    if _index_exists('idx_tags_user_name', 'tags'):
        op.drop_index('idx_tags_user_name', table_name='tags')
    if _index_exists('idx_tags_user', 'tags'):
        op.drop_index('idx_tags_user', table_name='tags')
    if _table_exists('tags'):
        op.drop_table('tags')
