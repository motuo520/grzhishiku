"""add pipeline_stage to clips and rss entries

Revision ID: 226f6db2e151
Revises: 521d3d29e12b
Create Date: 2026-07-12 16:13:43.337543

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '226f6db2e151'
down_revision: Union[str, None] = '521d3d29e12b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add pipeline_stage to browser_clips
    op.add_column('browser_clips', sa.Column('pipeline_stage', sa.String(), nullable=True))
    op.create_index('ix_clips_user_pipeline', 'browser_clips', ['user_id', 'pipeline_stage'], unique=False)
    # Backfill existing clips as raw stage
    op.execute("UPDATE browser_clips SET pipeline_stage = 'raw' WHERE pipeline_stage IS NULL")

    # Add pipeline_stage to rss_entries
    op.add_column('rss_entries', sa.Column('pipeline_stage', sa.String(), nullable=True))
    op.create_index('ix_rss_entries_user_pipeline', 'rss_entries', ['user_id', 'pipeline_stage'], unique=False)
    # Backfill existing rss entries as raw stage
    op.execute("UPDATE rss_entries SET pipeline_stage = 'raw' WHERE pipeline_stage IS NULL")


def downgrade() -> None:
    op.drop_index('ix_rss_entries_user_pipeline', table_name='rss_entries')
    op.drop_column('rss_entries', 'pipeline_stage')
    op.drop_index('ix_clips_user_pipeline', table_name='browser_clips')
    op.drop_column('browser_clips', 'pipeline_stage')
