"""Cost estimation and pricing helpers for LLM usage."""
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, Optional
import re

from sqlalchemy.orm import Session

from app.models.llm_billing import LLMModel


# Rough token estimation tuned for mixed Chinese / English content.
# Chinese characters are roughly 1.5 tokens; English/other characters roughly 0.25 tokens.
CHINESE_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")


def estimate_tokens(text: Optional[str]) -> int:
    """Estimate token count for a piece of text."""
    if not text:
        return 0
    chinese = len(CHINESE_CHAR_RE.findall(text))
    other = len(text) - chinese
    return max(1, int(chinese * Decimal("1.5") + other * Decimal("0.25")))


def estimate_message_tokens(messages: Optional[list]) -> int:
    """Estimate tokens for a list of chat messages."""
    if not messages:
        return 0
    total = 0
    for msg in messages:
        content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
        total += estimate_tokens(content)
        # Per-message overhead (~4 tokens for role / metadata)
        total += 4
    return total


class LLMCostService:
    """Read model pricing from the database and compute cost / price."""

    def __init__(self, db: Session):
        self.db = db

    def get_model(self, model_id: str) -> Optional[LLMModel]:
        return self.db.query(LLMModel).filter(LLMModel.id == model_id).first()

    def get_active_models(self) -> list[LLMModel]:
        return (
            self.db.query(LLMModel)
            .filter(LLMModel.is_active == True)
            .order_by(LLMModel.sort_order.asc())
            .all()
        )

    def estimate_usage(
        self,
        model_id: str,
        input_text: Optional[str] = None,
        output_text: Optional[str] = None,
        input_messages: Optional[list] = None,
        estimated_output_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Return estimated tokens and CNY cost/price for a call."""
        model = self.get_model(model_id)
        if not model:
            raise ValueError(f"Unknown model: {model_id}")

        if input_messages is not None:
            input_tokens = estimate_message_tokens(input_messages)
        else:
            input_tokens = estimate_tokens(input_text)

        output_tokens = estimated_output_tokens or estimate_tokens(output_text)

        return self._calculate(model, input_tokens, output_tokens, status="estimated")

    def calculate_actual(
        self,
        model_id: str,
        input_tokens: int,
        output_tokens: int,
    ) -> Dict[str, Any]:
        """Calculate cost/price from actual token counts."""
        model = self.get_model(model_id)
        if not model:
            raise ValueError(f"Unknown model: {model_id}")
        return self._calculate(model, input_tokens, output_tokens, status="calculated")

    def _calculate(
        self,
        model: LLMModel,
        input_tokens: int,
        output_tokens: int,
        status: str,
    ) -> Dict[str, Any]:
        cost_input = (Decimal(model.cost_input_per_1k or 0) * input_tokens) / Decimal("1000")
        cost_output = (Decimal(model.cost_output_per_1k or 0) * output_tokens) / Decimal("1000")
        price_input = (Decimal(model.price_input_per_1k or 0) * input_tokens) / Decimal("1000")
        price_output = (Decimal(model.price_output_per_1k or 0) * output_tokens) / Decimal("1000")

        cost = (cost_input + cost_output).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
        price = (price_input + price_output).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)

        return {
            "model_id": model.id,
            "provider": model.provider,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": float(cost),
            "price": float(price),
            "currency": model.currency or "CNY",
            "status": status,
        }

    @staticmethod
    def normalize_for_json(value: Decimal) -> float:
        return float(value) if value is not None else 0.0
