"""drop_provider_unique

Revision ID: 59a10d4fa9b7
Revises: fe9f7e16510f
Create Date: 2026-07-05 15:51:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '59a10d4fa9b7'
down_revision: Union[str, None] = 'fe9f7e16510f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite cannot drop a UNIQUE constraint directly, so we recreate the table.
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE _alembic_tmp_model_provider_accounts (
            id VARCHAR NOT NULL PRIMARY KEY,
            name VARCHAR NOT NULL DEFAULT 'default',
            provider VARCHAR NOT NULL,
            api_key VARCHAR NOT NULL,
            base_url VARCHAR,
            balance_cny NUMERIC(18, 4) DEFAULT 0,
            balance_usd NUMERIC(18, 4) DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            priority INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0,
            last_failure_at DATETIME,
            last_success_at DATETIME,
            extra_data TEXT,
            created_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
            updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
            CONSTRAINT uq_provider_accounts_provider_name UNIQUE (provider, name)
        )
    """))
    conn.execute(sa.text("""
        INSERT INTO _alembic_tmp_model_provider_accounts (
            id, name, provider, api_key, base_url, balance_cny, balance_usd,
            is_active, priority, failure_count, last_failure_at, last_success_at,
            extra_data, created_at, updated_at
        )
        SELECT
            id, COALESCE(name, 'default'), provider, api_key, base_url, balance_cny, balance_usd,
            is_active, priority, failure_count, last_failure_at, last_success_at,
            extra_data, created_at, updated_at
        FROM model_provider_accounts
    """))
    conn.execute(sa.text("DROP TABLE model_provider_accounts"))
    conn.execute(sa.text("ALTER TABLE _alembic_tmp_model_provider_accounts RENAME TO model_provider_accounts"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE _alembic_tmp_model_provider_accounts (
            id VARCHAR NOT NULL PRIMARY KEY,
            name VARCHAR NOT NULL DEFAULT 'default',
            provider VARCHAR NOT NULL UNIQUE,
            api_key VARCHAR NOT NULL,
            base_url VARCHAR,
            balance_cny NUMERIC(18, 4) DEFAULT 0,
            balance_usd NUMERIC(18, 4) DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            priority INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0,
            last_failure_at DATETIME,
            last_success_at DATETIME,
            extra_data TEXT,
            created_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
            updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
            CONSTRAINT uq_provider_accounts_provider_name UNIQUE (provider, name)
        )
    """))
    conn.execute(sa.text("""
        INSERT INTO _alembic_tmp_model_provider_accounts (
            id, name, provider, api_key, base_url, balance_cny, balance_usd,
            is_active, priority, failure_count, last_failure_at, last_success_at,
            extra_data, created_at, updated_at
        )
        SELECT
            id, name, provider, api_key, base_url, balance_cny, balance_usd,
            is_active, priority, failure_count, last_failure_at, last_success_at,
            extra_data, created_at, updated_at
        FROM model_provider_accounts
    """))
    conn.execute(sa.text("DROP TABLE model_provider_accounts"))
    conn.execute(sa.text("ALTER TABLE _alembic_tmp_model_provider_accounts RENAME TO model_provider_accounts"))
