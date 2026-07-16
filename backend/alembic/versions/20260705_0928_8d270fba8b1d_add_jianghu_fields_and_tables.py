"""add jianghu fields and tables

Revision ID: 8d270fba8b1d
Revises: 3a4b5c6d7e8f
Create Date: 2026-07-05 09:28:04.836391

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d270fba8b1d'
down_revision: Union[str, None] = '3a4b5c6d7e8f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New tables for Jianghu philosophy workflow
    op.create_table('daily_reviews',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('review_date', sa.DateTime(), nullable=False),
    sa.Column('content_summary', sa.Text(), nullable=True),
    sa.Column('ai_reflection', sa.Text(), nullable=True),
    sa.Column('gaps_found', sa.Text(), nullable=True),
    sa.Column('action_items', sa.Text(), nullable=True),
    sa.Column('praise_items', sa.Text(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_daily_reviews_user_date', 'daily_reviews', ['user_id', 'review_date'], unique=False)

    op.create_table('practice_records',
    sa.Column('id', sa.String(), primary_key=True),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('target_type', sa.String(), nullable=False),
    sa.Column('target_id', sa.String(), nullable=False),
    sa.Column('practice_type', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('result', sa.Text(), nullable=True),
    sa.Column('learned_lesson', sa.Text(), nullable=True),
    sa.Column('context_snapshot', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_practice_created', 'practice_records', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_practice_user_target', 'practice_records', ['user_id', 'target_type', 'target_id'], unique=False)

    # New Jianghu fields on notes
    op.add_column('notes', sa.Column('origin_type', sa.String(), nullable=True))
    op.add_column('notes', sa.Column('invoke_count', sa.Integer(), nullable=True))
    op.add_column('notes', sa.Column('last_invoked_at', sa.DateTime(), nullable=True))
    op.add_column('notes', sa.Column('practice_depth', sa.Integer(), nullable=True))
    op.add_column('notes', sa.Column('personal_relevance_score', sa.Float(), nullable=True))
    op.add_column('notes', sa.Column('evolution_stage', sa.String(), nullable=True))
    op.add_column('notes', sa.Column('attached_practice_ids', sa.Text(), nullable=True))
    op.create_index('ix_notes_evolution', 'notes', ['user_id', 'evolution_stage'], unique=False)
    op.create_index('ix_notes_relevance', 'notes', ['user_id', 'personal_relevance_score'], unique=False)

    # New Jianghu fields on knowledge_units
    op.add_column('knowledge_units', sa.Column('origin_type', sa.String(), nullable=True))
    op.add_column('knowledge_units', sa.Column('invoke_count', sa.Integer(), nullable=True))
    op.add_column('knowledge_units', sa.Column('last_invoked_at', sa.DateTime(), nullable=True))
    op.add_column('knowledge_units', sa.Column('practice_depth', sa.Integer(), nullable=True))
    op.add_column('knowledge_units', sa.Column('personal_relevance_score', sa.Float(), nullable=True))
    op.add_column('knowledge_units', sa.Column('evolution_stage', sa.String(), nullable=True))
    op.add_column('knowledge_units', sa.Column('attached_practice_ids', sa.Text(), nullable=True))
    op.create_index('ix_knowledge_evolution', 'knowledge_units', ['user_id', 'evolution_stage'], unique=False)
    op.create_index('ix_knowledge_invoke', 'knowledge_units', ['user_id', 'invoke_count'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_knowledge_invoke', table_name='knowledge_units')
    op.drop_index('ix_knowledge_evolution', table_name='knowledge_units')
    op.drop_column('knowledge_units', 'attached_practice_ids')
    op.drop_column('knowledge_units', 'evolution_stage')
    op.drop_column('knowledge_units', 'personal_relevance_score')
    op.drop_column('knowledge_units', 'practice_depth')
    op.drop_column('knowledge_units', 'last_invoked_at')
    op.drop_column('knowledge_units', 'invoke_count')
    op.drop_column('knowledge_units', 'origin_type')

    op.drop_index('ix_notes_relevance', table_name='notes')
    op.drop_index('ix_notes_evolution', table_name='notes')
    op.drop_column('notes', 'attached_practice_ids')
    op.drop_column('notes', 'evolution_stage')
    op.drop_column('notes', 'personal_relevance_score')
    op.drop_column('notes', 'practice_depth')
    op.drop_column('notes', 'last_invoked_at')
    op.drop_column('notes', 'invoke_count')
    op.drop_column('notes', 'origin_type')

    op.drop_index('ix_practice_user_target', table_name='practice_records')
    op.drop_index('ix_practice_created', table_name='practice_records')
    op.drop_table('practice_records')

    op.drop_index('ix_daily_reviews_user_date', table_name='daily_reviews')
    op.drop_table('daily_reviews')
