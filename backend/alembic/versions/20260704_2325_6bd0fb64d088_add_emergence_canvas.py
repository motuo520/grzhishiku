"""add emergence canvas

Revision ID: 6bd0fb64d088
Revises: 5f4eba7b5dff
Create Date: 2026-07-04 23:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, Text, DateTime

# revision identifiers, used by Alembic.
revision: str = "6bd0fb64d088"
down_revision: Union[str, None] = "5f4eba7b5dff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    if not _table_exists("emergence_canvases"):
        op.create_table(
            "emergence_canvases",
            sa.Column("id", String, primary_key=True),
            sa.Column("user_id", String, nullable=False),
            sa.Column("title", String, nullable=False),
            sa.Column("description", Text, nullable=True),
            sa.Column("brain_side", String, nullable=True, server_default="both"),
            sa.Column("nodes", Text, nullable=True, server_default="[]"),
            sa.Column("edges", Text, nullable=True, server_default="[]"),
            sa.Column("created_at", DateTime, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", DateTime, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Index("ix_emergence_canvases_user_updated", "user_id", "updated_at"),
        )


def downgrade() -> None:
    op.drop_table("emergence_canvases")
