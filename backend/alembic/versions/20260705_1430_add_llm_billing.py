"""add_llm_billing

Revision ID: b1a2c3d4e5f6
Revises: a95766441143
Create Date: 2026-07-05 14:30:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, DateTime, Integer, Boolean, Text, Numeric
from dotenv import load_dotenv

# Load .env so provider API keys are available during seeding.
load_dotenv('.env')

# revision identifiers, used by Alembic.
revision: str = 'b1a2c3d4e5f6'
down_revision: Union[str, None] = 'a95766441143'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ─── LLM model catalog and pricing ───
    op.create_table(
        'llm_models',
        sa.Column('id', String, primary_key=True),
        sa.Column('name', String, nullable=False),
        sa.Column('provider', String, nullable=False),
        sa.Column('provider_model_id', String, nullable=False),
        sa.Column('description', Text),
        sa.Column('icon', String),
        sa.Column('color', String),
        sa.Column('is_active', Boolean, default=True),
        sa.Column('is_system', Boolean, default=True),
        sa.Column('supports_streaming', Boolean, default=True),
        sa.Column('context_length', Integer, default=4096),
        sa.Column('sort_order', Integer, default=0),
        sa.Column('cost_input_per_1k', Numeric(18, 8), default=0),
        sa.Column('cost_output_per_1k', Numeric(18, 8), default=0),
        sa.Column('price_input_per_1k', Numeric(18, 8), default=0),
        sa.Column('price_output_per_1k', Numeric(18, 8), default=0),
        sa.Column('currency', String, default='CNY'),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_llm_models_provider_active', 'llm_models', ['provider', 'is_active'])

    # ─── Platform provider accounts / API keys ───
    op.create_table(
        'model_provider_accounts',
        sa.Column('id', String, primary_key=True),
        sa.Column('provider', String, nullable=False, unique=True),
        sa.Column('api_key', String, nullable=False),
        sa.Column('base_url', String),
        sa.Column('balance_cny', Numeric(18, 4), default=0),
        sa.Column('balance_usd', Numeric(18, 4), default=0),
        sa.Column('is_active', Boolean, default=True),
        sa.Column('priority', Integer, default=0),
        sa.Column('extra_data', Text),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # ─── User prepaid balance ───
    op.create_table(
        'user_balances',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, sa.ForeignKey('users.id'), nullable=False, unique=True),
        sa.Column('balance', Numeric(18, 4), default=0),
        sa.Column('frozen', Numeric(18, 4), default=0),
        sa.Column('total_deposited', Numeric(18, 4), default=0),
        sa.Column('total_used', Numeric(18, 4), default=0),
        sa.Column('version', Integer, default=0),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # ─── Balance ledger ───
    op.create_table(
        'balance_transactions',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('amount', Numeric(18, 4), nullable=False),
        sa.Column('transaction_type', String, nullable=False),
        sa.Column('balance_after', Numeric(18, 4), nullable=False),
        sa.Column('reference_id', String),
        sa.Column('description', String),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
    )
    op.create_index('idx_balance_transactions_user_created', 'balance_transactions', ['user_id', 'created_at'])
    op.create_index('idx_balance_transactions_type_created', 'balance_transactions', ['transaction_type', 'created_at'])

    # ─── Per-call LLM usage records ───
    op.create_table(
        'llm_usage_records',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('model_id', String, sa.ForeignKey('llm_models.id'), nullable=False),
        sa.Column('task_type', String, nullable=False),
        sa.Column('estimated_input_tokens', Integer, default=0),
        sa.Column('estimated_output_tokens', Integer, default=0),
        sa.Column('input_tokens', Integer, default=0),
        sa.Column('output_tokens', Integer, default=0),
        sa.Column('cost', Numeric(18, 8), default=0),
        sa.Column('price', Numeric(18, 8), default=0),
        sa.Column('status', String, default='pending'),
        sa.Column('request_id', String),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('completed_at', DateTime),
    )
    op.create_index('idx_llm_usage_user_created', 'llm_usage_records', ['user_id', 'created_at'])
    op.create_index('idx_llm_usage_model_created', 'llm_usage_records', ['model_id', 'created_at'])

    # ─── Extend payments for top-up ───
    op.add_column('payments', sa.Column('payment_type', String, default='subscription'))
    op.add_column('payments', sa.Column('balance_added', Integer, default=0))
    with op.batch_alter_table('payments') as batch_op:
        batch_op.alter_column('plan_id', nullable=True)

    # ─── Extend users for trial credit tracking ───
    op.add_column('users', sa.Column('trial_credit_given', Boolean, default=False))

    # ─── Seed default models and provider accounts ───
    _seed_data(op)


def downgrade() -> None:
    op.drop_index('idx_llm_usage_model_created', table_name='llm_usage_records')
    op.drop_index('idx_llm_usage_user_created', table_name='llm_usage_records')
    op.drop_table('llm_usage_records')
    op.drop_index('idx_balance_transactions_type_created', table_name='balance_transactions')
    op.drop_index('idx_balance_transactions_user_created', table_name='balance_transactions')
    op.drop_table('balance_transactions')
    op.drop_table('user_balances')
    op.drop_table('model_provider_accounts')
    op.drop_index('idx_llm_models_provider_active', table_name='llm_models')
    op.drop_table('llm_models')
    op.drop_column('users', 'trial_credit_given')
    with op.batch_alter_table('payments') as batch_op:
        batch_op.alter_column('plan_id', nullable=False)
    op.drop_column('payments', 'balance_added')
    op.drop_column('payments', 'payment_type')


def _seed_data(op):
    """Seed default LLM models and provider accounts from environment defaults."""
    import os
    import json

    # Provider accounts - keys come from current env so the system keeps working.
    providers = []
    if os.getenv('DEEPSEEK_API_KEY') or True:  # always seed rows, keys may be empty in dev
        providers.append(('deepseek', os.getenv('DEEPSEEK_API_KEY', ''), os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'), '{}'))
    if os.getenv('OPENAI_API_KEY') or True:
        providers.append(('openai', os.getenv('OPENAI_API_KEY', ''), os.getenv('OPENAI_BASE_URL', 'https://api.openai.com'), '{}'))
    if os.getenv('ANTHROPIC_API_KEY') or True:
        providers.append(('anthropic', os.getenv('ANTHROPIC_API_KEY', ''), 'https://api.anthropic.com', '{}'))
    if os.getenv('KIMI_API_KEY') or True:
        providers.append(('kimi', os.getenv('KIMI_API_KEY', ''), os.getenv('KIMI_BASE_URL', 'https://api.moonshot.cn'), '{}'))
    if os.getenv('QWEN_API_KEY') or True:
        providers.append(('qwen', os.getenv('QWEN_API_KEY', ''), os.getenv('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com'), '{}'))
    if os.getenv('ZHIPU_API_KEY') or True:
        providers.append(('zhipu', os.getenv('ZHIPU_API_KEY', ''), os.getenv('ZHIPU_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4'), '{}'))
    if os.getenv('XIAOMI_API_KEY') or True:
        providers.append(('xiaomi', os.getenv('XIAOMI_API_KEY', ''), os.getenv('XIAOMI_BASE_URL', 'https://api.xiaomi.ai/v1'), '{}'))
    # Ollama has no API key
    providers.append(('ollama', '', os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434'), '{}'))

    for i, (provider, api_key, base_url, extra) in enumerate(providers):
        op.execute(
            sa.text(
                """
                INSERT INTO model_provider_accounts (id, provider, api_key, base_url, balance_cny, balance_usd, is_active, priority, extra_data, created_at, updated_at)
                VALUES (:id, :provider, :api_key, :base_url, 0, 0, 1, :priority, :extra, datetime('now'), datetime('now'))
                """
            ).bindparams(
                id=f"mpa_{provider}",
                provider=provider,
                api_key=api_key,
                base_url=base_url,
                priority=i,
                extra=extra,
            )
        )

    # Default model catalog (CNY per 1K tokens, based on doc prices).
    # price = cost * 2, except where cost unknown -> both 0
    models = [
        # id, name, provider, provider_model_id, is_system, streaming, ctx, cost_in, cost_out, price_in, price_out, desc
        ('ollama-llama3.1', 'Ollama / Llama 3.1', 'ollama', 'llama3.1', False, True, 128000, '0', '0', '0', '0', '本地开源模型，隐私优先，零网络延迟'),
        ('ollama-qwen2.5', 'Ollama / Qwen 2.5', 'ollama', 'qwen2.5', False, True, 128000, '0', '0', '0', '0', '本地通义千问，中文优化'),
        ('ollama-nomic', 'Ollama / Nomic Embed', 'ollama', 'nomic-embed-text', False, False, 2048, '0', '0', '0', '0', '本地嵌入模型'),
        ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 'deepseek-v4-flash', True, True, 128000, '0.001', '0.002', '0.002', '0.004', 'DeepSeek 轻量高速模型'),
        ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'deepseek-v4-pro', True, True, 128000, '0.003', '0.006', '0.006', '0.012', '高性价比推理模型，支持思维链'),
        ('qwen-turbo', '通义千问 Qwen-Turbo', 'qwen', 'qwen-turbo', True, True, 128000, '0.002', '0.010', '0.005', '0.020', '阿里通义千问，中文理解优秀'),
        ('zhipu-glm-4-flash', '智谱 GLM-4-Flash', 'zhipu', 'glm-4-flash', True, True, 128000, '0.001', '0.001', '0.002', '0.002', '智谱轻量高速模型'),
        ('zhipu-glm-4', '智谱 GLM-4', 'zhipu', 'glm-4', True, True, 128000, '0.005', '0.005', '0.010', '0.010', '智谱旗舰模型'),
        ('kimi-latest', 'Kimi K2.6', 'kimi', 'kimi-latest', True, True, 2000000, '0.007', '0.028', '0.014', '0.056', '支持超长上下文，适合长文档'),
        ('claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'anthropic', 'claude-3-5-sonnet-20241022', True, True, 200000, '0.022', '0.108', '0.044', '0.216', 'Anthropic 出品，代码与推理能力最强'),
        ('gpt-4', 'GPT-4', 'openai', 'gpt-4-turbo-preview', True, True, 128000, '0.018', '0.072', '0.036', '0.144', 'OpenAI 旗舰模型，通用能力最强'),
        ('gpt-3.5-turbo', 'GPT-3.5 Turbo', 'openai', 'gpt-3.5-turbo', True, True, 16385, '0.003', '0.006', '0.006', '0.012', 'OpenAI 快速模型，低成本通用查询'),
    ]

    for i, (mid, name, provider, provider_model_id, is_system, streaming, ctx, cost_in, cost_out, price_in, price_out, desc) in enumerate(models):
        op.execute(
            sa.text(
                """
                INSERT INTO llm_models (
                    id, name, provider, provider_model_id, description, is_active, is_system,
                    supports_streaming, context_length, sort_order,
                    cost_input_per_1k, cost_output_per_1k, price_input_per_1k, price_output_per_1k,
                    currency, created_at, updated_at
                ) VALUES (
                    :id, :name, :provider, :provider_model_id, :description, 1, :is_system,
                    :supports_streaming, :context_length, :sort_order,
                    :cost_input_per_1k, :cost_output_per_1k, :price_input_per_1k, :price_output_per_1k,
                    'CNY', datetime('now'), datetime('now')
                )
                """
            ).bindparams(
                id=mid,
                name=name,
                provider=provider,
                provider_model_id=provider_model_id,
                description=desc,
                is_system=1 if is_system else 0,
                supports_streaming=1 if streaming else 0,
                context_length=ctx,
                sort_order=i,
                cost_input_per_1k=cost_in,
                cost_output_per_1k=cost_out,
                price_input_per_1k=price_in,
                price_output_per_1k=price_out,
            )
        )
