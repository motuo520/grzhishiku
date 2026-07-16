"""Tests for billing scheduler expiry and auto-renewal jobs."""
import pytest
import uuid
from datetime import datetime, timedelta

from app.core.billing_scheduler import expire_subscriptions_job, auto_renew_job
from app.services.payment_providers.factory import init_payment_factory
from app.models.billing import Plan, Subscription, Payment
from app.models.base import User


@pytest.fixture(autouse=True)
def init_payment_factory_fixture():
    init_payment_factory({"alipay": {}, "wechat": {}, "stripe": {}})


@pytest.fixture
def pro_plan(db_session):
    plan = Plan(
        id="plan_pro_test",
        name="Pro",
        slug="pro",
        price_monthly=2000,
        price_yearly=20000,
        currency="CNY",
    )
    db_session.add(plan)
    db_session.commit()
    return plan


@pytest.fixture
def user_with_active_subscription(db_session, pro_plan):
    user = User(
        id=str(uuid.uuid4()),
        email="renewuser@example.com",
        name="Renew User",
        password_hash="hashed",
        status="active",
        subscription_tier="pro",
        subscription_status="active",
    )
    db_session.add(user)
    db_session.flush()

    sub = Subscription(
        id="sub_renew_test",
        user_id=user.id,
        plan_id=pro_plan.id,
        status="active",
        billing_cycle="monthly",
        price_paid=pro_plan.price_monthly,
        currency="CNY",
        started_at=datetime.utcnow() - timedelta(days=29),
        current_period_start=datetime.utcnow() - timedelta(days=29),
        current_period_end=datetime.utcnow() + timedelta(hours=12),
        auto_renew=True,
        payment_method="alipay",
    )
    db_session.add(sub)
    db_session.commit()
    return user, sub


@pytest.mark.asyncio
async def test_expire_subscriptions_job(db_session, pro_plan):
    user = User(
        id=str(uuid.uuid4()),
        email="expired@example.com",
        name="Expired User",
        password_hash="hashed",
        status="active",
        subscription_tier="pro",
        subscription_status="active",
    )
    db_session.add(user)
    db_session.flush()

    sub = Subscription(
        id="sub_expired_test",
        user_id=user.id,
        plan_id=pro_plan.id,
        status="active",
        billing_cycle="monthly",
        price_paid=pro_plan.price_monthly,
        currency="CNY",
        started_at=datetime.utcnow() - timedelta(days=35),
        current_period_start=datetime.utcnow() - timedelta(days=35),
        current_period_end=datetime.utcnow() - timedelta(days=5),
        auto_renew=False,
    )
    db_session.add(sub)
    db_session.commit()
    sub_id = sub.id
    user_id = user.id

    count = await expire_subscriptions_job(db=db_session)
    assert count >= 1

    # Verify our fixture subscription was expired
    refreshed = db_session.query(Subscription).filter(Subscription.id == sub_id).first()
    refreshed_user = db_session.query(User).filter(User.id == user_id).first()
    assert refreshed is not None
    assert refreshed.status == "expired"
    assert refreshed_user.subscription_tier == "free"
    assert refreshed_user.subscription_status == "expired"


@pytest.mark.asyncio
async def test_auto_renew_job_extends_subscription(db_session, user_with_active_subscription):
    user, sub = user_with_active_subscription
    old_end = sub.current_period_end
    sub_id = sub.id
    user_id = user.id

    result = await auto_renew_job(db=db_session)
    # The fixture subscription should be renewed; other existing rows may also match the window
    assert result["renewed"] >= 1

    refreshed_sub = db_session.query(Subscription).filter(Subscription.id == sub_id).first()
    refreshed_user = db_session.query(User).filter(User.id == user_id).first()
    assert refreshed_sub is not None
    assert refreshed_sub.status == "active"
    assert refreshed_sub.current_period_end > old_end
    assert refreshed_user.subscription_status == "active"

    # A successful renewal payment should have been recorded for the fixture user
    payment = db_session.query(Payment).filter(
        Payment.user_id == user_id,
        Payment.payment_type == "subscription",
        Payment.status == "success",
    ).first()
    assert payment is not None
    assert payment.amount == 2000
