import pytest
from fastapi import HTTPException

from app.core.subscription_guard import SubscriptionGuard
from app.services.billing_service import BillingService

# The product now has two subscription tiers: free / storage.
# The free and storage plans are seeded by conftest.seed_default_plans.


@pytest.fixture
def storage_plan(db_session):
    return BillingService(db_session).get_plan_by_slug("storage")


class TestSubscriptionGuard:
    @pytest.mark.asyncio
    async def test_free_user_blocked_from_storage(self, db_session, test_user):
        guard = SubscriptionGuard("storage")
        with pytest.raises(HTTPException) as exc_info:
            await guard(test_user, db_session)
        assert exc_info.value.status_code == 403
        assert "Requires storage subscription" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_storage_user_allowed(self, db_session, test_user, storage_plan):
        billing = BillingService(db_session)
        billing.create_subscription(test_user.id, storage_plan.id, "monthly")

        guard = SubscriptionGuard("storage")
        result = await guard(test_user, db_session)
        assert result.id == test_user.id

    @pytest.mark.asyncio
    async def test_storage_user_allowed_for_free(self, db_session, test_user, storage_plan):
        billing = BillingService(db_session)
        billing.create_subscription(test_user.id, storage_plan.id, "monthly")

        guard = SubscriptionGuard("free")
        result = await guard(test_user, db_session)
        assert result.id == test_user.id

    @pytest.mark.asyncio
    async def test_cancelled_subscription_blocked_from_storage(self, db_session, test_user, storage_plan):
        billing = BillingService(db_session)
        billing.create_subscription(test_user.id, storage_plan.id, "monthly")
        billing.cancel_subscription(test_user.id)

        guard = SubscriptionGuard("storage")
        with pytest.raises(HTTPException) as exc_info:
            await guard(test_user, db_session)
        assert exc_info.value.status_code == 403
        assert "Requires storage subscription" in exc_info.value.detail
