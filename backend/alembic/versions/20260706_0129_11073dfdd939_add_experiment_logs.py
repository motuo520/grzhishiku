"""add_experiment_logs

Revision ID: 11073dfdd939
Revises: c021314d4c01
Create Date: 2026-07-06 01:29:34.082988

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '11073dfdd939'
down_revision: Union[str, None] = 'c021314d4c01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('experiment_logs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('hypothesis', sa.Text(), nullable=False),
        sa.Column('controlled_variable', sa.Text(), nullable=True),
        sa.Column('expected_result', sa.Text(), nullable=True),
        sa.Column('actual_result', sa.Text(), nullable=True),
        sa.Column('conclusion', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('related_content_type', sa.String(), nullable=True),
        sa.Column('related_content_id', sa.String(), nullable=True),
        sa.Column('brain_side', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_experiment_logs_user_id'), 'experiment_logs', ['user_id'], unique=False)
    op.create_index('ix_experiment_logs_user_status', 'experiment_logs', ['user_id', 'status'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_experiment_logs_user_status', table_name='experiment_logs')
    op.drop_index(op.f('ix_experiment_logs_user_id'), table_name='experiment_logs')
    op.drop_table('experiment_logs')
