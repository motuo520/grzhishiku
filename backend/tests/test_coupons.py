"""Tests for coupon validation, discount calculation and usage tracking."""
import pytest
from datetime import datetime, timedelta

from app.services.coupon_service import CouponService, CouponError
from app.services.payment_providers.factory import init_payment_factory
from app.models.billing import Plan, Payment


@pytest.fixture(autouse=True)
def init_payment_factory_fixture(client):
    """Initialize the payment factory for order tests.

    Must run after the app lifespan (which re-initializes the factory from the
    real DB at TestClient startup), hence the dependency on `client`.
    Alipay is marked enabled with a partial credential set so it is listed as
    available while the provider itself stays in mock mode (no private key)."""
    init_payment_factory({"alipay": {"enabled": True, "app_id": "test-app-id"}, "wechat": {}, "stripe": {}})


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


def _create_coupon(db_session, **kwargs):
    svc = CouponService(db_session)
    data = {
        "code": kwargs.pop("code"),
        "type": kwargs.pop("type", "fixed"),
        "value": kwargs.pop("value"),
        "applies_to": kwargs.pop("applies_to", "all"),
        **kwargs,
    }
    coupon = svc.create_coupon(data)
    db_session.commit()
    return coupon


def test_fixed_coupon_discount(client, db_session, auth_headers, pro_plan):
    _create_coupon(db_session, code="FIXED500", type="fixed", value=500, applies_to="subscription")

    res = client.post(
        "/api/v1/billing/validate-coupon",
        headers=auth_headers,
        json={
            "code": "FIXED500",
            "payment_type": "subscription",
            "original_amount": pro_plan.price_monthly,
            "plan_id": pro_plan.id,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["discount_amount"] == 500
    assert data["final_amount"] == 1500


def test_percent_coupon_with_cap(client, db_session, auth_headers, pro_plan):
    _create_coupon(
        db_session,
        code="PCT20",
        type="percent",
        value=20,
        max_discount=300,
        applies_to="subscription",
    )

    res = client.post(
        "/api/v1/billing/validate-coupon",
        headers=auth_headers,
        json={
            "code": "PCT20",
            "payment_type": "subscription",
            "original_amount": pro_plan.price_monthly,
            "plan_id": pro_plan.id,
        },
    )
    assert res.status_code == 200
    # 20% of 2000 = 400, capped at 300
    assert res.json()["discount_amount"] == 300


def test_expired_coupon_rejected(client, db_session, auth_headers, pro_plan):
    _create_coupon(
        db_session,
        code="EXPIRED",
        type="fixed",
        value=500,
        applies_to="subscription",
        valid_until=datetime.utcnow() - timedelta(days=1),
    )

    res = client.post(
        "/api/v1/billing/validate-coupon",
        headers=auth_headers,
        json={
            "code": "EXPIRED",
            "payment_type": "subscription",
            "original_amount": pro_plan.price_monthly,
            "plan_id": pro_plan.id,
        },
    )
    assert res.status_code == 400
    assert "过期" in res.json()["error"]["message"]


def test_max_uses_coupon_rejected(client, db_session, auth_headers, pro_plan):
    _create_coupon(
        db_session,
        code="LIMIT0",
        type="fixed",
        value=500,
        applies_to="subscription",
        max_uses=0,
    )

    res = client.post(
        "/api/v1/billing/validate-coupon",
        headers=auth_headers,
        json={
            "code": "LIMIT0",
            "payment_type": "subscription",
            "original_amount": pro_plan.price_monthly,
            "plan_id": pro_plan.id,
        },
    )
    assert res.status_code == 400
    assert "上限" in res.json()["error"]["message"]


def test_coupon_applies_to_mismatch(client, db_session, auth_headers, pro_plan):
    _create_coupon(
        db_session,
        code="SUBONLY",
        type="fixed",
        value=500,
        applies_to="subscription",
    )

    res = client.post(
        "/api/v1/billing/validate-coupon",
        headers=auth_headers,
        json={
            "code": "SUBONLY",
            "payment_type": "topup",
            "original_amount": 1000,
        },
    )
    assert res.status_code == 400
    assert "不适用" in res.json()["error"]["message"]


def test_topup_with_coupon_webhook_balance(client, db_session, test_user_token):
    _create_coupon(
        db_session,
        code="TOPUP300",
        type="fixed",
        value=300,
        applies_to="topup",
    )

    order_res = client.post(
        "/api/v1/billing/topup",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={"amount": 1000, "payment_method": "alipay", "coupon_code": "TOPUP300"},
    )
    assert order_res.status_code == 200
    order = order_res.json()
    assert order["amount"] == 700

    # Simulate Alipay webhook with the discounted amount
    webhook_res = client.post(
        "/api/v1/billing/webhook/alipay",
        json={
            "out_trade_no": order["order_id"],
            "trade_no": "ALI123456",
            "trade_status": "TRADE_SUCCESS",
            "total_amount": "7.00",
        },
    )
    assert webhook_res.status_code == 200

    balance_res = client.get(
        "/api/v1/billing/balance",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert balance_res.status_code == 200
    assert balance_res.json()["balance"] == 7.0

    # Verify usage was recorded
    payment = db_session.query(Payment).filter(Payment.id == order["order_id"]).first()
    assert payment is not None
    assert payment.discount_amount == 300
    assert payment.coupon_id is not None
