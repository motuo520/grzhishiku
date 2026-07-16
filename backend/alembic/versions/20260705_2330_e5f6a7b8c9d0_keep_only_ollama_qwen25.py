"""keep_only_ollama_qwen25

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-05 23:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Keep only one local chat model; Qwen 2.5 is better for Chinese content.
    op.execute("DELETE FROM llm_models WHERE id = 'ollama-llama3.1';")


def downgrade() -> None:
    # Re-insert Llama 3.1 if downgraded.
    op.execute(
        sa.text(
            """
            INSERT OR IGNORE INTO llm_models (
                id, name, provider, provider_model_id, description, is_active, is_system,
                supports_streaming, context_length, sort_order,
                cost_input_per_1k, cost_output_per_1k, price_input_per_1k, price_output_per_1k,
                currency, created_at, updated_at
            ) VALUES (
                :id, :name, :provider, :provider_model_id, :description, 1, 0,
                1, :context_length, 0,
                '0', '0', '0', '0',
                'CNY', datetime('now'), datetime('now')
            )
            """
        ).bindparams(
            id='ollama-llama3.1',
            name='Ollama / Llama 3.1',
            provider='ollama',
            provider_model_id='llama3.1',
            description='本地开源模型，隐私优先，零网络延迟',
            context_length=128000,
        )
    )
