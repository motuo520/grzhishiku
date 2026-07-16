"""add emergence brain side and idea

Revision ID: 5f4eba7b5dff
Revises: 008_add_readlater_documents
Create Date: 2026-07-04 22:46:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, Text, DateTime

# revision identifiers, used by Alembic.
revision: str = "5f4eba7b5dff"
down_revision: Union[str, None] = "008_add_readlater_documents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name},
    )
    return result.fetchone() is not None


def _column_exists(table_name: str, column_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(sa.text(f"PRAGMA table_info({table_name})"))
    rows = result.fetchall()
    return any(row[1] == column_name for row in rows)


def upgrade() -> None:
    # Add new columns to emergence_results
    with op.batch_alter_table("emergence_results", schema=None) as batch_op:
        if not _column_exists("emergence_results", "brain_side"):
            batch_op.add_column(
                sa.Column("brain_side", String, nullable=True, server_default="both")
            )
        if not _column_exists("emergence_results", "source_ids"):
            batch_op.add_column(
                sa.Column("source_ids", Text, nullable=True, server_default="[]")
            )
        if not _column_exists("emergence_results", "source_types"):
            batch_op.add_column(
                sa.Column("source_types", Text, nullable=True, server_default="[]")
            )
        if not _column_exists("emergence_results", "model_used"):
            batch_op.add_column(sa.Column("model_used", String, nullable=True))

    # Create emergence_ideas table
    if not _table_exists("emergence_ideas"):
        op.create_table(
            "emergence_ideas",
            sa.Column("id", String, primary_key=True),
            sa.Column("user_id", String, nullable=False, index=True),
            sa.Column("title", String, nullable=False),
            sa.Column("summary", Text, nullable=True),
            sa.Column("brain_side", String, nullable=True, server_default="both"),
            sa.Column("source_result_ids", Text, nullable=True, server_default="[]"),
            sa.Column("tags", Text, nullable=True, server_default="[]"),
            sa.Column("status", String, nullable=True, server_default="draft"),
            sa.Column("target_type", String, nullable=True),
            sa.Column("target_id", String, nullable=True),
            sa.Column("created_at", DateTime, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", DateTime, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Index("ix_emergence_ideas_user_status", "user_id", "status"),
        )


def downgrade() -> None:
    op.drop_table("emergence_ideas")
    with op.batch_alter_table("emergence_results", schema=None) as batch_op:
        batch_op.drop_column("model_used")
        batch_op.drop_column("source_types")
        batch_op.drop_column("source_ids")
        batch_op.drop_column("brain_side")
