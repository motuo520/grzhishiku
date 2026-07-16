"""add deep work brain side

Revision ID: 3a4b5c6d7e8f
Revises: 9f1e2d3c4b5a
Create Date: 2026-07-05 01:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String

# revision identifiers, used by Alembic.
revision: str = "3a4b5c6d7e8f"
down_revision: Union[str, None] = "9f1e2d3c4b5a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(sa.text(f"PRAGMA table_info({table_name})"))
    return any(row[1] == column_name for row in result.fetchall())


def upgrade() -> None:
    if not _column_exists("deep_work_sessions", "brain_side"):
        op.add_column(
            "deep_work_sessions",
            sa.Column("brain_side", String, nullable=True, server_default="personal"),
        )


def downgrade() -> None:
    if _column_exists("deep_work_sessions", "brain_side"):
        op.drop_column("deep_work_sessions", "brain_side")
