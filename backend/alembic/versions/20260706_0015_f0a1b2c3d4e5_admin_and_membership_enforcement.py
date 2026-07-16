"""admin_and_membership_enforcement

Revision ID: f0a1b2c3d4e5
Revises: e5f6a7b8c9d0
Create Date: 2026-07-06 00:15:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import json
import uuid as _uuid


# revision identifiers, used by Alembic.
revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ensure default free and storage plans exist for membership enforcement.
    conn = op.get_bind()

    free_exists = conn.execute(sa.text("SELECT 1 FROM plans WHERE slug = 'free' LIMIT 1")).scalar()
    if not free_exists:
        conn.execute(sa.text("""
            INSERT INTO plans (id, name, slug, description, price_monthly, price_yearly, currency, billing_cycle, is_active, sort_order, features, limits, created_at, updated_at)
            VALUES ('plan_free', '免费版', 'free', '免费基础版', 0, 0, 'CNY', 'monthly', 1, 0, :features, :limits, datetime('now'), datetime('now'))
        """), {
            "features": json.dumps({
                "ai_summary": True,
                "web_clipper": True,
                "public_sharing": False,
                "cloud_backup": False,
            }),
            "limits": json.dumps({
                "notes": 100,
                "clips_per_month": 50,
                "knowledge_units": 200,
                "documents": 20,
                "storage_bytes": 1073741824,
                "llm_calls_per_day": 50,
            }),
        })

    storage_exists = conn.execute(sa.text("SELECT 1 FROM plans WHERE slug = 'storage' LIMIT 1")).scalar()
    if not storage_exists:
        conn.execute(sa.text("""
            INSERT INTO plans (id, name, slug, description, price_monthly, price_yearly, currency, billing_cycle, is_active, sort_order, features, limits, created_at, updated_at)
            VALUES ('plan_storage', '存储会员', 'storage', '9.9 元/月，解锁云端备份接口与更大额度', 990, 9900, 'CNY', 'monthly', 1, 1, :features, :limits, datetime('now'), datetime('now'))
        """), {
            "features": json.dumps({
                "cloud_backup": True,
                "priority_support": True,
                "ai_summary": True,
                "web_clipper": True,
                "public_sharing": True,
            }),
            "limits": json.dumps({
                "notes": -1,
                "clips_per_month": -1,
                "knowledge_units": -1,
                "documents": -1,
                "storage_bytes": 10737418240,
                "llm_calls_per_day": -1,
            }),
        })

    # Ensure system_configs contains the new keys needed by the admin/membership system.
    def ensure_config(key: str, value: str):
        exists = conn.execute(sa.text("SELECT 1 FROM system_configs WHERE key = :key LIMIT 1"), {"key": key}).scalar()
        if not exists:
            conn.execute(sa.text("""
                INSERT INTO system_configs (id, key, value_json, updated_at) VALUES (:id, :key, :val, datetime('now'))
            """), {"id": str(_uuid.uuid4()), "key": key, "val": value})

    ensure_config("default_plan", '"free"')

    # Merge module flags into existing feature_flags if present
    row = conn.execute(sa.text("SELECT value_json FROM system_configs WHERE key = 'feature_flags' LIMIT 1")).fetchone()
    if row:
        try:
            flags = json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            flags = {}
        defaults = {
            "module_pipeline_enabled": True,
            "module_social_brain_enabled": True,
            "module_embodied_cognition_enabled": True,
            "module_plugins_enabled": True,
        }
        updated = {**defaults, **flags}
        conn.execute(sa.text("UPDATE system_configs SET value_json = :val WHERE key = 'feature_flags'"), {"val": json.dumps(updated)})
    else:
        ensure_config("feature_flags", json.dumps({
            "beta_features": False,
            "ai_summary": True,
            "web_clipper": True,
            "public_sharing": False,
            "module_pipeline_enabled": True,
            "module_social_brain_enabled": True,
            "module_embodied_cognition_enabled": True,
            "module_plugins_enabled": True,
        }))

    # Ensure other system config keys exist with sensible defaults.
    ensure_config("registration_open", "true")
    ensure_config("maintenance_mode", '{"enabled": false}')
    ensure_config("announcement", '{"title": "", "content": ""}')
    ensure_config("enable_signup_bonus", "false")


def downgrade() -> None:
    pass
