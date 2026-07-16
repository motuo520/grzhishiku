"""fix_storage_plan_encoding

Revision ID: 95c37f4b9552
Revises: b2c3d4e5f6a7
Create Date: 2026-07-05 21:59:12.756258

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '95c37f4b9552'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Deactivate legacy Enterprise plan so only Free + Storage remain active.
    op.execute("UPDATE plans SET is_active = 0 WHERE slug IN ('pro', 'enterprise', 'team')")

    # Fix storage plan display name/description (idempotent).
    op.execute("""
        UPDATE plans
        SET name = '存储会员',
            description = '提供云端存储接口（百度/阿里云盘直传）+ 多端同步 + 时间胶囊云端封存',
            is_active = 1,
            sort_order = 1
        WHERE slug = 'storage';
    """)


def downgrade() -> None:
    op.execute("UPDATE plans SET is_active = 1 WHERE slug IN ('enterprise')")
    op.execute("UPDATE plans SET name = '瀛樺偍浼氬憳', description = '浜戠珯瀛樺偍 + 澶氱鍚屾 + 鏃堕棿鑳跺泭浜戠灏佸瓨' WHERE slug = 'storage'")
