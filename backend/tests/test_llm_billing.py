"""Tests for LLM billing: trial credit, balance API, top-up orders and webhooks."""
import pytest
from decimal import Decimal

from app.services.llm_billing_service import LLMBillingService
from app.services.payment_providers.factory import init_payment_factory


@pytest.fixture(autouse=True)
def init_payment_factory_fixture(client):
    """Initialize the payment factory for top-up tests.

    Must run after the app lifespan (which re-initializes the factory from the
    real DB at TestClient startup), hence the dependency on `client`.
    Alipay is marked enabled with a partial credential set so it is listed as
    available while the provider itself stays in mock mode (no private key)."""
    init_payment_factory({"alipay": {"enabled": True, "app_id": "test-app-id"}, "wechat": {}, "stripe": {}})


def test_register_gives_trial_credit(client, db_session, register_user):
    res = register_user("billing@example.com", "TestPass123")
    assert res.status_code == 200
    token = res.json()["access_token"]

    balance_res = client.get("/api/v1/billing/balance", headers={"Authorization": f"Bearer {token}"})
    assert balance_res.status_code == 200
    data = balance_res.json()
    # Trial credit amount is TRIAL_CREDIT_CNY = 1.00 CNY (reduced from 5 CNY in Jul 2026)
    assert data["balance"] == 1.0
    assert data["total_deposited"] == 1.0


def test_balance_endpoint_requires_auth(client):
    res = client.get("/api/v1/billing/balance")
    assert res.status_code == 401


def test_topup_order_and_webhook(client, test_user_token):
    # Create a top-up order
    res = client.post(
        "/api/v1/billing/topup",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={"amount": 1000, "payment_method": "alipay"},
    )
    assert res.status_code == 200
    order = res.json()
    assert order["amount"] == 1000
    assert order["status"] == "pending"

    # Simulate Alipay webhook
    webhook_res = client.post(
        "/api/v1/billing/webhook/alipay",
        json={
            "out_trade_no": order["order_id"],
            "trade_no": "ALI123456",
            "trade_status": "TRADE_SUCCESS",
            "total_amount": "10.00",
        },
    )
    assert webhook_res.status_code == 200

    balance_res = client.get("/api/v1/billing/balance", headers={"Authorization": f"Bearer {test_user_token}"})
    assert balance_res.status_code == 200
    assert balance_res.json()["balance"] == 10.0


def test_llm_billing_service_freeze_and_complete(db_session, test_user):
    # deepseek-v4-pro is seeded by conftest.seed_system_models
    svc = LLMBillingService(db_session)
    svc.give_trial_credit(test_user.id)

    record_id = svc.freeze(
        user_id=test_user.id,
        model_id="deepseek-v4-pro",
        task_type="chat",
        estimated_input_tokens=10,
        estimated_output_tokens=5,
        estimated_price=Decimal("0.01"),
    )
    db_session.commit()

    balance = svc.get_balance(test_user.id)
    assert balance.frozen == Decimal("0.01")
    # Trial credit is 1.00 CNY: 1.0 - 0.01 frozen
    assert balance.balance == Decimal("0.99")

    svc.complete(
        record_id=record_id,
        actual_input_tokens=10,
        actual_output_tokens=2,
        actual_cost=Decimal("0.003"),
        actual_price=Decimal("0.006"),
    )
    db_session.commit()

    balance = svc.get_balance(test_user.id)
    assert balance.frozen == Decimal("0")
    # 1.0 - 0.006 = 0.994
    assert balance.balance == Decimal("0.994")
