"""add guardian and ration tables

Revision ID: 9f1e2d3c4b5a
Revises: 7c8d9e0f1a2b
Create Date: 2026-07-05 00:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String

# revision identifiers, used by Alembic.
revision: str = "9f1e2d3c4b5a"
down_revision: Union[str, None] = "7c8d9e0f1a2b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(sa.text(f"PRAGMA table_info({table_name})"))
    return bool(result.fetchall())


def upgrade() -> None:
    if not _table_exists("attention_guardian_rules"):
        op.create_table(
            "attention_guardian_rules",
            sa.Column("id", String, primary_key=True),
            sa.Column("user_id", String, nullable=False, index=True),
            sa.Column("type", String, nullable=False),
            sa.Column("target", String, nullable=False),
            sa.Column("mode", String, nullable=False, server_default="block"),
            sa.Column("limit_minutes", sa.Integer(), nullable=True),
            sa.Column("active", sa.Boolean(), server_default=sa.true()),
            sa.Column("schedule_days", String, nullable=True),
            sa.Column("schedule_start", String, nullable=True),
            sa.Column("schedule_end", String, nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        )

    if not _table_exists("attention_rations"):
        op.create_table(
            "attention_rations",
            sa.Column("id", String, primary_key=True),
            sa.Column("user_id", String, nullable=False, index=True),
            sa.Column("source_type", String, nullable=False),
            sa.Column("source_id", String, nullable=True),
            sa.Column("name", String, nullable=False),
            sa.Column("daily_limit_minutes", sa.Integer, nullable=False),
            sa.Column("used_minutes", sa.Integer, server_default="0"),
            sa.Column("active", sa.Boolean(), server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
        )


def downgrade() -> None:
    if _table_exists("attention_rations"):
        op.drop_table("attention_rations")
    if _table_exists("attention_guardian_rules"):
        op.drop_table("attention_guardian_rules")
