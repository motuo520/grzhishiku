"""provider_account_health

Revision ID: fe9f7e16510f
Revises: b1a2c3d4e5f6
Create Date: 2026-07-05 15:49:44.299394

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, Integer, DateTime, Text, Numeric


# revision identifiers, used by Alembic.
revision: str = 'fe9f7e16510f'
down_revision: Union[str, None] = 'b1a2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite requires batch mode to alter table constraints. We recreate the
    # model_provider_accounts table with the new (provider, name) unique key
    # and health-tracking columns.
    with op.batch_alter_table("model_provider_accounts", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("name", String, nullable=False, server_default="default"))
        batch_op.add_column(sa.Column("failure_count", Integer, default=0))
        batch_op.add_column(sa.Column("last_failure_at", DateTime))
        batch_op.add_column(sa.Column("last_success_at", DateTime))
        # Old unique(provider) is implicitly dropped when the table is recreated;
        # add the new composite unique key.
        batch_op.create_unique_constraint("uq_provider_accounts_provider_name", ["provider", "name"])


def downgrade() -> None:
    with op.batch_alter_table("model_provider_accounts", recreate="always") as batch_op:
        batch_op.drop_constraint("uq_provider_accounts_provider_name", type_="unique")
        batch_op.create_unique_constraint("sqlite_autoindex_model_provider_accounts_1", ["provider"])
        batch_op.drop_column("last_success_at")
        batch_op.drop_column("last_failure_at")
        batch_op.drop_column("failure_count")
        batch_op.drop_column("name")
