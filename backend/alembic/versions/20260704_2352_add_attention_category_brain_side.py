"""add attention category brain side

Revision ID: 7c8d9e0f1a2b
Revises: 6bd0fb64d088
Create Date: 2026-07-04 23:52:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String

# revision identifiers, used by Alembic.
revision: str = "7c8d9e0f1a2b"
down_revision: Union[str, None] = "6bd0fb64d088"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text(f"PRAGMA table_info({table_name})")
    )
    return any(row[1] == column_name for row in result.fetchall())


def upgrade() -> None:
    if not _column_exists("attention_categories", "brain_side"):
        op.add_column(
            "attention_categories",
            sa.Column("brain_side", String, nullable=True, server_default="personal"),
        )


def downgrade() -> None:
    if _column_exists("attention_categories", "brain_side"):
        op.drop_column("attention_categories", "brain_side")
