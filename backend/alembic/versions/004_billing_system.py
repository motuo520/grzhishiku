"""Add billing system tables - plans, subscriptions, payments, invoices

Revision ID: 004_billing_system
Revises: 003_add_tenants
Create Date: 2026-01-20

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, DateTime, Integer, Boolean, Float, Text

# revision identifiers
revision = '004_billing_system'
down_revision = '003'
branch_labels = None
depends_on = None

def upgrade():
    # ─── plans: 定价计划配置 ───
    op.create_table(
        'plans',
        sa.Column('id', String, primary_key=True),
        sa.Column('name', String, nullable=False),          # e.g. "Free", "Pro", "Team"
        sa.Column('slug', String, nullable=False, unique=True),  # e.g. "free", "pro", "team"
        sa.Column('description', Text),
        sa.Column('price_monthly', Integer, default=0),     # 分，¥29 = 2900
        sa.Column('price_yearly', Integer, default=0),      # 分，¥290 = 29000
        sa.Column('currency', String, default='CNY'),
        sa.Column('billing_cycle', String, default='monthly'),  # monthly / yearly / both
        sa.Column('is_active', Boolean, default=True),
        sa.Column('sort_order', Integer, default=0),
        # 功能配额（JSON 配置）
        sa.Column('features', Text),                         # JSON: {"capsules_limit": 5, "llm_routing": false, ...}
        sa.Column('limits', Text),                           # JSON: {"storage_mb": 1024, "team_members": 1, ...}
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_plans_slug', 'plans', ['slug'])
    op.create_index('idx_plans_active', 'plans', ['is_active'])

    # ─── subscriptions: 用户订阅记录 ───
    op.create_table(
        'subscriptions',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('plan_id', String, nullable=False),
        sa.Column('status', String, default='active'),       # active / cancelled / expired / paused / trial
        sa.Column('billing_cycle', String, default='monthly'), # monthly / yearly
        sa.Column('price_paid', Integer, default=0),          # 分，实际支付金额
        sa.Column('currency', String, default='CNY'),
        sa.Column('started_at', DateTime, nullable=False),
        sa.Column('current_period_start', DateTime, nullable=False),
        sa.Column('current_period_end', DateTime, nullable=False),
        sa.Column('cancelled_at', DateTime),
        sa.Column('cancel_reason', String),
        sa.Column('payment_method', String),                   # alipay / wechat / stripe / paypal
        sa.Column('payment_provider_id', String),              # 第三方支付流水号
        sa.Column('auto_renew', Boolean, default=True),
        sa.Column('trial_end', DateTime),
        sa.Column('extra_data', Text),                            # JSON 扩展字段
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_subscriptions_user', 'subscriptions', ['user_id'])
    op.create_index('idx_subscriptions_status', 'subscriptions', ['status'])
    op.create_index('idx_subscriptions_period_end', 'subscriptions', ['current_period_end'])

    # ─── payments: 支付记录 ───
    op.create_table(
        'payments',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('subscription_id', String),
        sa.Column('plan_id', String, nullable=False),
        sa.Column('amount', Integer, nullable=False),         # 分
        sa.Column('currency', String, default='CNY'),
        sa.Column('status', String, default='pending'),        # pending / success / failed / refunded / cancelled
        sa.Column('payment_method', String),                     # alipay / wechat / stripe / paypal
        sa.Column('payment_provider', String),                   # alipay / wechat_pay / stripe
        sa.Column('provider_transaction_id', String),            # 第三方交易 ID
        sa.Column('provider_response', Text),                  # 第三方原始响应
        sa.Column('paid_at', DateTime),
        sa.Column('refunded_at', DateTime),
        sa.Column('refund_amount', Integer, default=0),
        sa.Column('invoice_id', String),
        sa.Column('description', String),
        sa.Column('extra_data', Text),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_payments_user', 'payments', ['user_id'])
    op.create_index('idx_payments_status', 'payments', ['status'])
    op.create_index('idx_payments_subscription', 'payments', ['subscription_id'])
    op.create_index('idx_payments_provider_tx', 'payments', ['provider_transaction_id'])

    # ─── invoices: 发票记录 ───
    op.create_table(
        'invoices',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('subscription_id', String),
        sa.Column('payment_id', String),
        sa.Column('invoice_number', String, nullable=False, unique=True),  # e.g. "INV-202601-00001"
        sa.Column('amount', Integer, nullable=False),          # 分
        sa.Column('tax_amount', Integer, default=0),
        sa.Column('currency', String, default='CNY'),
        sa.Column('status', String, default='pending'),        # pending / issued / paid / void
        sa.Column('invoice_type', String, default='personal'),   # personal / enterprise / vat
        sa.Column('title', String),                              # 发票抬头
        sa.Column('tax_number', String),                        # 税号
        sa.Column('email', String),                             # 接收邮箱
        sa.Column('issued_at', DateTime),
        sa.Column('paid_at', DateTime),
        sa.Column('items', Text),                                # JSON: [{"description": "Pro 月付", "amount": 2900}]
        sa.Column('extra_data', Text),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_invoices_user', 'invoices', ['user_id'])
    op.create_index('idx_invoices_number', 'invoices', ['invoice_number'])
    op.create_index('idx_invoices_status', 'invoices', ['status'])

    # ─── 插入默认定价计划 ───
    op.execute("""
        INSERT INTO plans (id, name, slug, description, price_monthly, price_yearly, currency, billing_cycle, is_active, sort_order, features, limits)
        VALUES 
        ('plan_free', 'Free', 'free', '永久免费，本地优先', 0, 0, 'CNY', 'none', 1, 0,
         '{"capsules_limit": 5, "llm_routing": false, "sync_devices": 1, "advanced_cognitive": false, "team_collaboration": false, "priority_support": false}',
         '{"storage_mb": 1024, "team_members": 1, "notes_limit": null, "api_calls_per_day": 100}'),
        
        ('plan_pro', 'Pro', 'pro', '个人效率升级', 2900, 29000, 'CNY', 'both', 1, 1,
         '{"capsules_limit": null, "llm_routing": true, "sync_devices": 5, "advanced_cognitive": true, "team_collaboration": false, "priority_support": true}',
         '{"storage_mb": 10240, "team_members": 1, "notes_limit": null, "api_calls_per_day": 1000}'),
        
        ('plan_team', 'Team', 'team', '团队协作', 9900, 99000, 'CNY', 'both', 1, 2,
         '{"capsules_limit": null, "llm_routing": true, "sync_devices": null, "advanced_cognitive": true, "team_collaboration": true, "priority_support": true}',
         '{"storage_mb": 102400, "team_members": 10, "notes_limit": null, "api_calls_per_day": 10000}')
    """)


def downgrade():
    op.drop_index('idx_invoices_status', table_name='invoices')
    op.drop_index('idx_invoices_number', table_name='invoices')
    op.drop_index('idx_invoices_user', table_name='invoices')
    op.drop_table('invoices')
    
    op.drop_index('idx_payments_provider_tx', table_name='payments')
    op.drop_index('idx_payments_subscription', table_name='payments')
    op.drop_index('idx_payments_status', table_name='payments')
    op.drop_index('idx_payments_user', table_name='payments')
    op.drop_table('payments')
    
    op.drop_index('idx_subscriptions_period_end', table_name='subscriptions')
    op.drop_index('idx_subscriptions_status', table_name='subscriptions')
    op.drop_index('idx_subscriptions_user', table_name='subscriptions')
    op.drop_table('subscriptions')
    
    op.drop_index('idx_plans_active', table_name='plans')
    op.drop_index('idx_plans_slug', table_name='plans')
    op.drop_table('plans')
