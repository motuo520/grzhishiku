"""add_context_guides

Revision ID: c021314d4c01
Revises: f0a1b2c3d4e5
Create Date: 2026-07-06 01:23:32.257658

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c021314d4c01'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('context_guides',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('scope', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('version_tag', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_context_guides_user_active', 'context_guides', ['user_id', 'is_active'], unique=False)
    op.create_index(op.f('ix_context_guides_user_id'), 'context_guides', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_context_guides_user_id'), table_name='context_guides')
    op.drop_index('ix_context_guides_user_active', table_name='context_guides')
    op.drop_table('context_guides')
