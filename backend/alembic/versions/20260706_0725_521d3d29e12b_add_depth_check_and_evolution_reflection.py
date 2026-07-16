"""add_depth_check_and_evolution_reflection

Revision ID: 521d3d29e12b
Revises: 11073dfdd939
Create Date: 2026-07-06 07:25:19.405610

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '521d3d29e12b'
down_revision: Union[str, None] = '11073dfdd939'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('depth_check_logs',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=False),
    sa.Column('content_id', sa.String(), nullable=True),
    sa.Column('content_preview', sa.String(), nullable=True),
    sa.Column('depth_score', sa.Float(), nullable=True),
    sa.Column('is_passed', sa.Boolean(), nullable=True),
    sa.Column('feedback', sa.Text(), nullable=True),
    sa.Column('suggestions', sa.Text(), nullable=True),
    sa.Column('model_used', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_depth_check_logs_user_created', 'depth_check_logs', ['user_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_depth_check_logs_user_id'), 'depth_check_logs', ['user_id'], unique=False)

    op.create_table('evolution_reflections',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('title', sa.String(), nullable=False),
    sa.Column('discomfort_level', sa.Integer(), nullable=True),
    sa.Column('pain_description', sa.Text(), nullable=True),
    sa.Column('joy_description', sa.Text(), nullable=True),
    sa.Column('learning', sa.Text(), nullable=True),
    sa.Column('is_true_evolution', sa.Boolean(), nullable=True),
    sa.Column('related_content_type', sa.String(), nullable=True),
    sa.Column('related_content_id', sa.String(), nullable=True),
    sa.Column('brain_side', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_evolution_reflections_user_created', 'evolution_reflections', ['user_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_evolution_reflections_user_id'), 'evolution_reflections', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_evolution_reflections_user_id'), table_name='evolution_reflections')
    op.drop_index('ix_evolution_reflections_user_created', table_name='evolution_reflections')
    op.drop_table('evolution_reflections')

    op.drop_index(op.f('ix_depth_check_logs_user_id'), table_name='depth_check_logs')
    op.drop_index('ix_depth_check_logs_user_created', table_name='depth_check_logs')
    op.drop_table('depth_check_logs')
