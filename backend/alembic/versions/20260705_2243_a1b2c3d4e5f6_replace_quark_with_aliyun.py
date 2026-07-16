"""replace_quark_with_aliyun

Revision ID: a1b2c3d4e5f6
Revises: 4c1af700dd88
Create Date: 2026-07-05 22:43:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '4c1af700dd88'
branch_labels: Union[Sequence[str], None] = None
depends_on: Union[Sequence[str], None] = None


def upgrade() -> None:
    # Update storage plan description to mention Aliyun instead of Quark.
    op.execute("""
        UPDATE plans
        SET description = '提供云端存储接口（百度/阿里云盘直传）+ 多端同步 + 时间胶囊云端封存'
        WHERE slug = 'storage';
    """)

    # Remove stale Quark drive bindings since Quark has no public API.
    op.execute("DELETE FROM user_cloud_drives WHERE provider = 'quark';")


def downgrade() -> None:
    op.execute("""
        UPDATE plans
        SET description = '提供云端存储接口（百度/夸克网盘直传）+ 多端同步 + 时间胶囊云端封存'
        WHERE slug = 'storage';
    """)
