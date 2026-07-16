"""add tenant_id to content tables and create tenants table

Revision ID: 003
Revises: 002
Create Date: 2025-05-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create tenants table
    op.create_table(
        'tenants',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False, unique=True),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('status', sa.String(), server_default='active', nullable=True),
        sa.Column('plan', sa.String(), server_default='free', nullable=True),
        sa.Column('max_users', sa.Integer(), server_default='10', nullable=True),
        sa.Column('max_storage', sa.Integer(), server_default='10737418240', nullable=True),
        sa.Column('owner_id', sa.String(), nullable=True),
        sa.Column('settings', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Add tenant_id to content tables
    for table in ['notes', 'capsules', 'browser_clips', 'knowledge_units']:
        op.add_column(table, sa.Column('tenant_id', sa.String(), nullable=True))
    
    # Add tenant_id to attention tables
    for table in ['attention_activities', 'attention_categories', 'deep_work_sessions']:
        op.add_column(table, sa.Column('tenant_id', sa.String(), nullable=True))


def downgrade() -> None:
    # Drop tenant_id from attention tables
    for table in ['deep_work_sessions', 'attention_categories', 'attention_activities']:
        op.drop_column(table, 'tenant_id')
    
    # Drop tenant_id from content tables
    for table in ['knowledge_units', 'browser_clips', 'capsules', 'notes']:
        op.drop_column(table, 'tenant_id')
    
    # Drop tenants table
    op.drop_table('tenants')
