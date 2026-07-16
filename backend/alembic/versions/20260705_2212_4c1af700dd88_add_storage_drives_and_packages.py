"""add_storage_drives_and_packages

Revision ID: 4c1af700dd88
Revises: 95c37f4b9552
Create Date: 2026-07-05 22:12:46.072217

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4c1af700dd88'
down_revision: Union[str, None] = '95c37f4b9552'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 数据打包记录
    op.create_table(
        'data_packages',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('file_path', sa.String(), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('remote_path', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_data_packages_user_status', 'data_packages', ['user_id', 'status'], unique=False)

    # 用户网盘授权
    op.create_table(
        'user_cloud_drives',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('account_name', sa.String(), nullable=True),
        sa.Column('access_token', sa.Text(), nullable=False),
        sa.Column('refresh_token', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('scope', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_user_cloud_drives_user_provider', 'user_cloud_drives', ['user_id', 'provider'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_user_cloud_drives_user_provider', table_name='user_cloud_drives')
    op.drop_table('user_cloud_drives')
    op.drop_index('ix_data_packages_user_status', table_name='data_packages')
    op.drop_table('data_packages')
