"""add status and flag_reason to content tables

Revision ID: 002
Revises: 001
Create Date: 2025-05-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add status and flag_reason to notes
    op.add_column('notes', sa.Column('status', sa.String(), nullable=True, server_default='active'))
    op.add_column('notes', sa.Column('flag_reason', sa.String(), nullable=True))
    
    # Add status and flag_reason to capsules
    op.add_column('capsules', sa.Column('status', sa.String(), nullable=True, server_default='active'))
    op.add_column('capsules', sa.Column('flag_reason', sa.String(), nullable=True))
    
    # Add status and flag_reason to browser_clips
    op.add_column('browser_clips', sa.Column('status', sa.String(), nullable=True, server_default='active'))
    op.add_column('browser_clips', sa.Column('flag_reason', sa.String(), nullable=True))
    
    # Add status and flag_reason to knowledge_units
    op.add_column('knowledge_units', sa.Column('status', sa.String(), nullable=True, server_default='active'))
    op.add_column('knowledge_units', sa.Column('flag_reason', sa.String(), nullable=True))


def downgrade() -> None:
    # Remove status and flag_reason from knowledge_units
    op.drop_column('knowledge_units', 'flag_reason')
    op.drop_column('knowledge_units', 'status')
    
    # Remove status and flag_reason from browser_clips
    op.drop_column('browser_clips', 'flag_reason')
    op.drop_column('browser_clips', 'status')
    
    # Remove status and flag_reason from capsules
    op.drop_column('capsules', 'flag_reason')
    op.drop_column('capsules', 'status')
    
    # Remove status and flag_reason from notes
    op.drop_column('notes', 'flag_reason')
    op.drop_column('notes', 'status')
