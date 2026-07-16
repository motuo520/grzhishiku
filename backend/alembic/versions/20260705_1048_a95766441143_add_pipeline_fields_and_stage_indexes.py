"""add pipeline fields and stage indexes

Revision ID: a95766441143
Revises: 8d270fba8b1d
Create Date: 2026-07-05 10:48:16.378987

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a95766441143'
down_revision: Union[str, None] = '8d270fba8b1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def _index_exists(table: str, index: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(sa.text(f"PRAGMA index_list({table})"))
    return any(row[1] == index for row in result)


def upgrade() -> None:
    if not _column_exists('notes', 'pipeline_stage'):
        op.add_column('notes', sa.Column('pipeline_stage', sa.String(), nullable=True))
    if not _index_exists('notes', 'ix_notes_pipeline'):
        op.create_index('ix_notes_pipeline', 'notes', ['user_id', 'brain_side', 'pipeline_stage'], unique=False)

    if not _column_exists('knowledge_units', 'pipeline_stage'):
        op.add_column('knowledge_units', sa.Column('pipeline_stage', sa.String(), nullable=True))
    if not _column_exists('knowledge_units', 'content_subtype'):
        op.add_column('knowledge_units', sa.Column('content_subtype', sa.String(), nullable=True))
    if not _column_exists('knowledge_units', 'source_id'):
        op.add_column('knowledge_units', sa.Column('source_id', sa.String(), nullable=True))
    if not _column_exists('knowledge_units', 'source_content_type'):
        op.add_column('knowledge_units', sa.Column('source_content_type', sa.String(), nullable=True))
    if not _index_exists('knowledge_units', 'ix_knowledge_pipeline'):
        op.create_index('ix_knowledge_pipeline', 'knowledge_units', ['user_id', 'brain_side', 'pipeline_stage'], unique=False)
    if not _index_exists('knowledge_units', 'ix_knowledge_subtype'):
        op.create_index('ix_knowledge_subtype', 'knowledge_units', ['user_id', 'content_subtype'], unique=False)


def downgrade() -> None:
    if _index_exists('knowledge_units', 'ix_knowledge_subtype'):
        op.drop_index('ix_knowledge_subtype', table_name='knowledge_units')
    if _index_exists('knowledge_units', 'ix_knowledge_pipeline'):
        op.drop_index('ix_knowledge_pipeline', table_name='knowledge_units')
    if _column_exists('knowledge_units', 'source_content_type'):
        op.drop_column('knowledge_units', 'source_content_type')
    if _column_exists('knowledge_units', 'source_id'):
        op.drop_column('knowledge_units', 'source_id')
    if _column_exists('knowledge_units', 'content_subtype'):
        op.drop_column('knowledge_units', 'content_subtype')
    if _column_exists('knowledge_units', 'pipeline_stage'):
        op.drop_column('knowledge_units', 'pipeline_stage')

    if _index_exists('notes', 'ix_notes_pipeline'):
        op.drop_index('ix_notes_pipeline', table_name='notes')
    if _column_exists('notes', 'pipeline_stage'):
        op.drop_column('notes', 'pipeline_stage')
