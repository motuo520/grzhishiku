"""Route LLM calls to the best available platform provider account."""
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session

from app.services.llm_billing_service import LLMBillingService
from app.models.llm_billing import ModelProviderAccount


class LLMProviderRouter:
    """
    Selects platform-owned API keys / endpoints for a given provider.

    Resolution order:
      1. Active accounts for the provider, sorted by priority, failure_count,
         and most recent success.
      2. Skip accounts that look unhealthy (failure_count >= max_failure_threshold).
      3. Return the first account with a non-empty API key.
    """

    MAX_FAILURE_THRESHOLD = 5

    def __init__(self, db: Session):
        self.db = db
        self.billing = LLMBillingService(db)

    def get_account(
        self,
        provider: str,
        require_key: bool = True,
    ) -> Optional[ModelProviderAccount]:
        """Return the best available platform account for a provider."""
        accounts = self.billing.list_provider_accounts(provider=provider, active_only=True)

        for account in accounts:
            if (account.failure_count or 0) >= self.MAX_FAILURE_THRESHOLD:
                continue
            if require_key and not account.api_key:
                continue
            return account

        # Fallback: ignore failure threshold if all accounts are failing
        for account in accounts:
            if require_key and not account.api_key:
                continue
            return account

        return None

    def get_credentials(
        self,
        provider: str,
        default_base_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Return {"api_key": ..., "base_url": ...} for the best account."""
        account = self.get_account(provider)
        if not account:
            return None
        return {
            "account_id": account.id,
            "api_key": account.api_key,
            "base_url": account.base_url or default_base_url,
        }

    def touch_success(self, account_id: str) -> None:
        self.billing.touch_provider_account_success(account_id)

    def touch_failure(self, account_id: str) -> None:
        self.billing.touch_provider_account_failure(account_id)
