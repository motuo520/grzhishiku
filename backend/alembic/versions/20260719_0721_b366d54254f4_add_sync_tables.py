"""add sync tables

Revision ID: b366d54254f4
Revises: 226f6db2e151
Create Date: 2026-07-19 07:21:15.511985

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b366d54254f4'
down_revision: Union[str, None] = '226f6db2e151'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('sync_devices',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('fingerprint', sa.String(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(), nullable=True),
        sa.Column('is_current', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sync_devices_fingerprint'), 'sync_devices', ['fingerprint'], unique=False)
    op.create_index(op.f('ix_sync_devices_user_id'), 'sync_devices', ['user_id'], unique=False)

    op.create_table('sync_operations',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('device_id', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.String(), nullable=False),
        sa.Column('op_type', sa.String(), nullable=False),
        sa.Column('op_timestamp', sa.DateTime(), nullable=False),
        sa.Column('checksum', sa.String(), nullable=False),
        sa.Column('applied_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sync_operations_device_id'), 'sync_operations', ['device_id'], unique=False)
    op.create_index(op.f('ix_sync_operations_user_id'), 'sync_operations', ['user_id'], unique=False)

    op.create_table('sync_snapshots',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('device_id', sa.String(), nullable=False),
        sa.Column('s3_key', sa.String(), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('salt', sa.String(), nullable=False),
        sa.Column('iv', sa.String(), nullable=False),
        sa.Column('entity_count', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('s3_key')
    )
    op.create_index(op.f('ix_sync_snapshots_device_id'), 'sync_snapshots', ['device_id'], unique=False)
    op.create_index(op.f('ix_sync_snapshots_user_id'), 'sync_snapshots', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_sync_snapshots_user_id'), table_name='sync_snapshots')
    op.drop_index(op.f('ix_sync_snapshots_device_id'), table_name='sync_snapshots')
    op.drop_table('sync_snapshots')
    op.drop_index(op.f('ix_sync_operations_user_id'), table_name='sync_operations')
    op.drop_index(op.f('ix_sync_operations_device_id'), table_name='sync_operations')
    op.drop_table('sync_operations')
    op.drop_index(op.f('ix_sync_devices_user_id'), table_name='sync_devices')
    op.drop_index(op.f('ix_sync_devices_fingerprint'), table_name='sync_devices')
    op.drop_table('sync_devices')
