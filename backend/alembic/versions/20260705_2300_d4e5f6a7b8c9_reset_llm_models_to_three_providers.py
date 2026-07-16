"""reset_llm_models_to_three_providers

Revision ID: d4e5f6a7b8c9
Revises: a1b2c3d4e5f6
Create Date: 2026-07-05 23:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import String, Numeric


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# USD -> CNY exchange rate and markup.  Prices are per 1M tokens in the
# source table; DB stores CNY per 1K tokens.
_EXCHANGE_RATE = 7.2
_MARKUP = 2.5


def _cny_cost(usd_per_1m: float) -> str:
    """Return CNY cost per 1K tokens."""
    return str(round(usd_per_1m / 1000 * _EXCHANGE_RATE, 8))


def _cny_price(usd_per_1m: float) -> str:
    """Return user price per 1K tokens = cost * 2.5."""
    return str(round(usd_per_1m / 1000 * _EXCHANGE_RATE * _MARKUP, 8))


def upgrade() -> None:
    # ─── Reset model catalog ───
    # Usage records reference llm_models.id, so clear them first. Balance
    # transactions only store a reference_id string, not a real FK, so they
    # can be left in place for audit purposes.
    op.execute("DELETE FROM llm_usage_records;")
    op.execute("DELETE FROM llm_models;")

    # id, name, provider, provider_model_id, is_system, supports_streaming, context_length,
    # cost_input_per_1k, cost_output_per_1k, price_input_per_1k, price_output_per_1k, description
    models = [
        # Local / Ollama
        ('ollama-qwen2.5', 'Ollama / Qwen 2.5', 'ollama', 'qwen2.5', False, True, 128000,
         '0', '0', '0', '0', '本地通义千问，中文优化'),
        ('ollama-nomic', 'Ollama / Nomic Embed', 'ollama', 'nomic-embed-text', False, False, 2048,
         '0', '0', '0', '0', '本地嵌入模型，专用于文本向量化'),

        # DeepSeek
        ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'deepseek-v4-pro', True, True, 128000,
         _cny_cost(1.74), _cny_cost(3.48), _cny_price(1.74), _cny_price(3.48),
         'DeepSeek 旗舰推理模型，支持思维链'),
        ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 'deepseek-v4-flash', True, True, 128000,
         _cny_cost(0.14), _cny_cost(0.28), _cny_price(0.14), _cny_price(0.28),
         'DeepSeek 轻量高速模型'),

        # Kimi
        ('kimi-k2-7-code', 'Kimi K2.7 Code', 'kimi', 'kimi-k2-7-code', True, True, 256000,
         _cny_cost(0.95), _cny_cost(4.00), _cny_price(0.95), _cny_price(4.00),
         'Moonshot 代码专用模型'),
        ('kimi-k2-6', 'Kimi K2.6', 'kimi', 'kimi-k2-6', True, True, 256000,
         _cny_cost(0.95), _cny_cost(4.00), _cny_price(0.95), _cny_price(4.00),
         'Moonshot 通用长上下文模型'),

        # OpenCode (GLM / MiMo / MiniMax / Qwen 聚合)
        ('opencode-glm-5', 'GLM-5', 'opencode', 'glm-5', True, True, 128000,
         _cny_cost(1.40), _cny_cost(4.40), _cny_price(1.40), _cny_price(4.40),
         '智谱 GLM-5 通用模型'),
        ('opencode-glm-5-1', 'GLM-5.1', 'opencode', 'glm-5.1', True, True, 128000,
         _cny_cost(1.40), _cny_cost(4.40), _cny_price(1.40), _cny_price(4.40),
         '智谱 GLM-5.1 通用模型'),
        ('opencode-mimo-v2-5', 'MiMo V2.5', 'opencode', 'mimo-v2-5', True, True, 128000,
         _cny_cost(0.14), _cny_cost(0.28), _cny_price(0.14), _cny_price(0.28),
         '小米 MiMo 轻量模型'),
        ('opencode-mimo-v2-5-pro', 'MiMo V2.5 Pro', 'opencode', 'mimo-v2-5-pro', True, True, 128000,
         _cny_cost(1.74), _cny_cost(3.48), _cny_price(1.74), _cny_price(3.48),
         '小米 MiMo Pro 模型'),
        ('opencode-minimax-m3', 'MiniMax M3', 'opencode', 'minimax-m3', True, True, 128000,
         _cny_cost(0.30), _cny_cost(1.20), _cny_price(0.30), _cny_price(1.20),
         'MiniMax M3 通用模型'),
        ('opencode-minimax-m2-7', 'MiniMax M2.7', 'opencode', 'minimax-m2-7', True, True, 128000,
         _cny_cost(0.30), _cny_cost(1.20), _cny_price(0.30), _cny_price(1.20),
         'MiniMax M2.7 通用模型'),
        ('opencode-minimax-m2-5', 'MiniMax M2.5', 'opencode', 'minimax-m2-5', True, True, 128000,
         _cny_cost(0.30), _cny_cost(1.20), _cny_price(0.30), _cny_price(1.20),
         'MiniMax M2.5 通用模型'),
        ('opencode-qwen-3-7-max', 'Qwen 3.7 Max', 'opencode', 'qwen-3-7-max', True, True, 256000,
         _cny_cost(2.50), _cny_cost(7.50), _cny_price(2.50), _cny_price(7.50),
         '阿里通义千问 3.7 Max'),
        ('opencode-qwen-3-7-plus-256k', 'Qwen 3.7 Plus (≤256K)', 'opencode', 'qwen-3-7-plus-256k', True, True, 256000,
         _cny_cost(0.40), _cny_cost(1.60), _cny_price(0.40), _cny_price(1.60),
         '阿里通义千问 3.7 Plus 标准上下文'),
        ('opencode-qwen-3-7-plus-long', 'Qwen 3.7 Plus (>256K)', 'opencode', 'qwen-3-7-plus-long', True, True, 1000000,
         _cny_cost(1.20), _cny_cost(4.80), _cny_price(1.20), _cny_price(4.80),
         '阿里通义千问 3.7 Plus 超长上下文'),
        ('opencode-qwen-3-6-plus-256k', 'Qwen 3.6 Plus (≤256K)', 'opencode', 'qwen-3-6-plus-256k', True, True, 256000,
         _cny_cost(0.50), _cny_cost(3.00), _cny_price(0.50), _cny_price(3.00),
         '阿里通义千问 3.6 Plus 标准上下文'),
        ('opencode-qwen-3-6-plus-long', 'Qwen 3.6 Plus (>256K)', 'opencode', 'qwen-3-6-plus-long', True, True, 1000000,
         _cny_cost(2.00), _cny_cost(6.00), _cny_price(2.00), _cny_price(6.00),
         '阿里通义千问 3.6 Plus 超长上下文'),
    ]

    for i, (mid, name, provider, provider_model_id, is_system, streaming, ctx,
            cost_in, cost_out, price_in, price_out, desc) in enumerate(models):
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

    # ─── Clean up default provider accounts for removed vendors ───
    # Remove only the auto-seeded default rows; leave any custom admin-created accounts alone.
    for removed in ('openai', 'anthropic', 'qwen', 'zhipu', 'xiaomi'):
        op.execute(
            sa.text("DELETE FROM model_provider_accounts WHERE id = :id").bindparams(id=f"mpa_{removed}")
        )

    # Seed a default OpenCode account if it doesn't exist yet.
    op.execute(
        sa.text(
            """
            INSERT OR IGNORE INTO model_provider_accounts
                (id, provider, name, api_key, base_url, balance_cny, balance_usd, is_active, priority, extra_data, created_at, updated_at)
            VALUES
                (:id, :provider, 'default', :api_key, :base_url, 0, 0, 1, 0, '{}', datetime('now'), datetime('now'))
            """
        ).bindparams(
            id='mpa_opencode',
            provider='opencode',
            api_key='',
            base_url='https://api.opencode.ai',
        )
    )


def downgrade() -> None:
    # Downgrade is intentionally a no-op: restoring the old heterogeneous catalog
    # would require re-inserting all previous model/provider rows and is not safe
    # to do automatically after this reset.
    pass
