import pytest
from fastapi import HTTPException

from app.core.subscription_guard import SubscriptionGuard
from app.services.billing_service import BillingService


@pytest.fixture
def free_plan(db_session):
    from app.models.billing import Plan
    plan = Plan(
        id="plan_free",
        name="Free",
        slug="free",
        price_monthly=0,
        price_yearly=0,
        currency="CNY",
        is_active=True,
    )
    db_session.add(plan)
    db_session.commit()
    db_session.refresh(plan)
    return plan


@pytest.fixture
def pro_plan(db_session):
    from app.models.billing import Plan
    plan = Plan(
        id="plan_pro",
        name="Pro",
        slug="pro",
        price_monthly=2900,
        price_yearly=29000,
        currency="CNY",
        is_active=True,
    )
    db_session.add(plan)
    db_session.commit()
    db_session.refresh(plan)
    return plan


class TestSubscriptionGuard:
    @pytest.mark.asyncio
    async def test_free_user_blocked_from_pro(self, db_session, test_user, pro_plan):
        guard = SubscriptionGuard("pro")
        with pytest.raises(HTTPException) as exc_info:
            await guard(test_user, db_session)
        assert exc_info.value.status_code == 403
        assert "Requires pro subscription" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_pro_user_allowed(self, db_session, test_user, pro_plan, free_plan):
        billing = BillingService(db_session)
        billing.create_subscription(test_user.id, pro_plan.id, "monthly")

        guard = SubscriptionGuard("pro")
        result = await guard(test_user, db_session)
        assert result.id == test_user.id

    @pytest.mark.asyncio
    async def test_team_user_allowed_for_pro(self, db_session, test_user, pro_plan, free_plan):
        from app.models.billing import Plan
        team_plan = Plan(
            id="plan_team",
            name="Team",
            slug="team",
            price_monthly=9900,
            price_yearly=99000,
            currency="CNY",
            is_active=True,
        )
        db_session.add(team_plan)
        db_session.commit()
        db_session.refresh(team_plan)

        billing = BillingService(db_session)
        billing.create_subscription(test_user.id, team_plan.id, "monthly")

        guard = SubscriptionGuard("pro")
        result = await guard(test_user, db_session)
        assert result.id == test_user.id

    @pytest.mark.asyncio
    async def test_pro_user_blocked_from_team(self, db_session, test_user, pro_plan, free_plan):
        billing = BillingService(db_session)
        billing.create_subscription(test_user.id, pro_plan.id, "monthly")

        guard = SubscriptionGuard("team")
        with pytest.raises(HTTPException) as exc_info:
            await guard(test_user, db_session)
        assert exc_info.value.status_code == 403
        assert "Requires team subscription" in exc_info.value.detail
