"""Tests for payment webhook signature verification and idempotency."""
import pytest
from urllib.parse import urlencode

from app.services.payment_providers.factory import init_payment_factory
from app.models.billing import Payment
from app.models.llm_billing import UserBalance


@pytest.fixture(autouse=True)
def init_payment_factory_fixture():
    """Initialize the payment factory for webhook tests."""
    init_payment_factory({"alipay": {}, "wechat": {}, "stripe": {}})


@pytest.fixture
def topup_payment(db_session, test_user):
    payment = Payment(
        id="TOP20250101000000TEST0001",
        user_id=test_user.id,
        amount=10000,
        original_amount=10000,
        currency="CNY",
        status="pending",
        payment_type="topup",
        payment_method="alipay",
        payment_provider="alipay",
        description="LLM 余额充值 100.00 元",
    )
    db_session.add(payment)
    db_session.commit()
    return payment


def _get_balance(db_session, user_id):
    balance = db_session.query(UserBalance).filter(UserBalance.user_id == user_id).first()
    if balance:
        return balance.balance
    return 0


def test_alipay_topup_webhook_form_urlencoded(client, db_session, test_user, topup_payment):
    """支付宝异步通知为 form-urlencoded，应正确解析并到账。"""
    assert topup_payment.status == "pending"

    payload = {
        "out_trade_no": topup_payment.id,
        "trade_no": "ALI202501010000000001",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": "100.00",
        "gmt_payment": "2025-01-01 00:00:00",
    }
    response = client.post(
        "/api/v1/billing/webhook/alipay",
        data=urlencode(payload),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "success"

    db_session.refresh(topup_payment)
    assert topup_payment.status == "success"
    assert topup_payment.provider_transaction_id == "ALI202501010000000001"
    assert topup_payment.balance_added == 10000

    balance = _get_balance(db_session, test_user.id)
    assert balance == 100


def test_alipay_webhook_idempotent(client, db_session, test_user, topup_payment):
    """重复收到同一个支付宝成功通知，不应重复充值。"""
    payload = {
        "out_trade_no": topup_payment.id,
        "trade_no": "ALI202501010000000001",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": "100.00",
        "gmt_payment": "2025-01-01 00:00:00",
    }

    # First webhook
    response = client.post(
        "/api/v1/billing/webhook/alipay",
        data=urlencode(payload),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    assert _get_balance(db_session, test_user.id) == 100

    # Second duplicate webhook
    response = client.post(
        "/api/v1/billing/webhook/alipay",
        data=urlencode(payload),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200

    db_session.refresh(topup_payment)
    assert topup_payment.status == "success"
    assert _get_balance(db_session, test_user.id) == 100

    # 余额只应增加一次
    tx_count = (
        db_session.query(UserBalance)
        .filter(UserBalance.user_id == test_user.id)
        .count()
    )
    assert tx_count == 1


def test_stripe_webhook_mock(client, db_session, test_user):
    """Stripe webhook 在 mock 模式下应正确解析 payment_intent.succeeded（充值场景无需 plan）。"""
    payment = Payment(
        id="TOP20250101000000TEST0002",
        user_id=test_user.id,
        amount=5000,
        original_amount=5000,
        currency="CNY",
        status="pending",
        payment_type="topup",
        payment_method="stripe",
        payment_provider="stripe",
        description="LLM 余额充值 50.00 元",
    )
    db_session.add(payment)
    db_session.commit()

    payload = {
        "id": "evt_test_123",
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": "pi_test_123",
                "amount": 5000,
                "metadata": {"order_id": payment.id, "user_id": test_user.id},
                "charges": {"data": [{"id": "ch_test_123", "created": 1735689600}]},
                "created": 1735689600,
            }
        },
    }
    response = client.post(
        "/api/v1/billing/webhook/stripe",
        json=payload,
        headers={"stripe-signature": "mock_signature"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "success"

    db_session.refresh(payment)
    assert payment.status == "success"
    assert payment.balance_added == 5000
    assert _get_balance(db_session, test_user.id) == 50
