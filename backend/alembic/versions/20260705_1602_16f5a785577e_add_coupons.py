"""add_coupons

Revision ID: 16f5a785577e
Revises: 59a10d4fa9b7
Create Date: 2026-07-05 16:02:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, Integer, DateTime, Boolean, Text


# revision identifiers, used by Alembic.
revision: str = '16f5a785577e'
down_revision: Union[str, None] = '59a10d4fa9b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'coupons',
        sa.Column('id', String, primary_key=True),
        sa.Column('code', String, nullable=False, unique=True),
        sa.Column('type', String, nullable=False, default='percent'),
        sa.Column('value', Integer, nullable=False),
        sa.Column('currency', String, default='CNY'),
        sa.Column('min_amount', Integer, default=0),
        sa.Column('max_discount', Integer),
        sa.Column('valid_from', DateTime),
        sa.Column('valid_until', DateTime),
        sa.Column('max_uses', Integer),
        sa.Column('used_count', Integer, default=0),
        sa.Column('is_active', Boolean, default=True),
        sa.Column('applies_to', String, default='all'),
        sa.Column('plan_ids', Text),
        sa.Column('description', String),
        sa.Column('extra_data', Text),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_table(
        'coupon_usages',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False, index=True),
        sa.Column('coupon_id', String, sa.ForeignKey('coupons.id'), nullable=False),
        sa.Column('payment_id', String, sa.ForeignKey('payments.id'), nullable=False),
        sa.Column('used_at', DateTime, server_default=sa.func.now()),
    )

    op.add_column('payments', sa.Column('original_amount', Integer, default=0))
    op.add_column('payments', sa.Column('discount_amount', Integer, default=0))
    # SQLite cannot add a foreign-key column via ALTER; the relationship is enforced by the ORM.
    op.add_column('payments', sa.Column('coupon_id', String))

    op.add_column('subscriptions', sa.Column('coupon_id', String))


def downgrade() -> None:
    op.drop_column('subscriptions', 'coupon_id')
    op.drop_column('payments', 'coupon_id')
    op.drop_column('payments', 'discount_amount')
    op.drop_column('payments', 'original_amount')
    op.drop_table('coupon_usages')
    op.drop_table('coupons')
