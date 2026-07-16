"""storage_membership_plan

Revision ID: b2c3d4e5f6a7
Revises: 16f5a785577e
Create Date: 2026-07-05 21:46:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = '16f5a785577e'
branch_labels: Union[Sequence[str], None] = None
depends_on: Union[Sequence[str], None] = None


def upgrade() -> None:
    # Deactivate legacy Pro/Team/Enterprise plans; keep Free so existing free users keep working.
    op.execute("UPDATE plans SET is_active = 0 WHERE slug IN ('pro', 'team', 'enterprise')")

    # Insert the single storage membership plan (9.9 CNY/month, 99 CNY/year).
    # If it already exists, just reactivate/update it.
    op.execute("""
        INSERT INTO plans (id, name, slug, description, price_monthly, price_yearly, currency, billing_cycle, is_active, sort_order, features, limits)
        VALUES (
            'plan_storage',
            '存储会员',
            'storage',
            '提供云端存储接口（百度/阿里云盘直传）+ 多端同步 + 时间胶囊云端封存',
            990,
            9900,
            'CNY',
            'both',
            1,
            1,
            '{"cloud_sync": true, "multi_device_sync": true, "cloud_capsules": true, "advanced_cognitive": false, "llm_routing": false, "team_collaboration": false, "priority_support": true}',
            '{"storage_mb": 10240, "team_members": 1, "sync_devices": 5}'
        )
        ON CONFLICT(slug) DO UPDATE SET
            is_active = 1,
            price_monthly = 990,
            price_yearly = 9900,
            features = excluded.features,
            limits = excluded.limits;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM plans WHERE slug = 'storage'")
    op.execute("UPDATE plans SET is_active = 1 WHERE slug IN ('pro', 'team')")
