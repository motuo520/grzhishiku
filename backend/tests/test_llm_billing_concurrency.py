"""Tests for concurrent LLM billing safety (optimistic locking)."""
import pytest
from decimal import Decimal

from app.services.llm_billing_service import LLMBillingService, ConcurrentModificationError
from app.models.llm_billing import UserBalance

# deepseek-v4-pro is seeded by conftest.seed_system_models


def _simulate_stale_balance_read(db_session, svc, user_id):
    """
    Bump the DB version and return a balance object whose in-memory version
    is one behind the DB row. This simulates another transaction committing
    between our read and our conditional update.
    """
    db_session.query(UserBalance).filter(UserBalance.user_id == user_id).update(
        {UserBalance.version: UserBalance.version + 1}, synchronize_session=False
    )
    db_session.commit()

    balance = svc.get_balance(user_id)
    # Force the in-memory version to the old value so the conditional update fails.
    balance.version = max(0, (balance.version or 0) - 1)
    return balance


def test_complete_detects_version_conflict(db_session, test_user):
    """complete() raises ConcurrentModificationError when the balance row changed."""
    svc = LLMBillingService(db_session)
    svc.give_trial_credit(test_user.id)

    record_id = svc.freeze(
        user_id=test_user.id,
        model_id="deepseek-v4-pro",
        task_type="chat",
        estimated_input_tokens=10,
        estimated_output_tokens=5,
        estimated_price=Decimal("1.00"),
    )
    db_session.commit()

    _simulate_stale_balance_read(db_session, svc, test_user.id)

    with pytest.raises(ConcurrentModificationError):
        svc.complete(
            record_id=record_id,
            actual_input_tokens=10,
            actual_output_tokens=2,
            actual_cost=Decimal("0.003"),
            actual_price=Decimal("0.50"),
        )


def test_fail_detects_version_conflict(db_session, test_user):
    """fail() raises ConcurrentModificationError when the balance row changed."""
    svc = LLMBillingService(db_session)
    svc.give_trial_credit(test_user.id)

    record_id = svc.freeze(
        user_id=test_user.id,
        model_id="deepseek-v4-pro",
        task_type="chat",
        estimated_input_tokens=10,
        estimated_output_tokens=5,
        estimated_price=Decimal("1.00"),
    )
    db_session.commit()

    _simulate_stale_balance_read(db_session, svc, test_user.id)

    with pytest.raises(ConcurrentModificationError):
        svc.fail(record_id, reason="test")


def test_deposit_balance_detects_version_conflict(db_session, test_user):
    svc = LLMBillingService(db_session)
    svc.give_trial_credit(test_user.id)
    db_session.commit()

    _simulate_stale_balance_read(db_session, svc, test_user.id)

    with pytest.raises(ConcurrentModificationError):
        svc.deposit_balance(
            user_id=test_user.id,
            amount_cents=1000,
            reference_id="ref-1",
            description="Test deposit",
        )


def test_freeze_and_complete_happy_path_balance_correct(db_session, test_user):
    """Ensure normal freeze/complete still works after optimistic-lock changes."""
    svc = LLMBillingService(db_session)
    svc.give_trial_credit(test_user.id)

    record_id = svc.freeze(
        user_id=test_user.id,
        model_id="deepseek-v4-pro",
        task_type="chat",
        estimated_input_tokens=10,
        estimated_output_tokens=5,
        estimated_price=Decimal("1.00"),
    )
    db_session.commit()

    balance = svc.get_balance(test_user.id)
    # Trial credit is 1.00 CNY: 1.00 - 1.00 frozen
    assert balance.balance == Decimal("0.00")
    assert balance.frozen == Decimal("1.00")
    # give_trial_credit -> v1, freeze -> v2
    assert balance.version == 2

    svc.complete(
        record_id=record_id,
        actual_input_tokens=10,
        actual_output_tokens=2,
        actual_cost=Decimal("0.30"),
        actual_price=Decimal("0.50"),
    )
    db_session.commit()

    balance = svc.get_balance(test_user.id)
    # 1.0 - 0.5 = 0.5
    assert balance.balance == Decimal("0.50")
    assert balance.frozen == Decimal("0")
    assert balance.total_used == Decimal("0.50")
    assert balance.version == 3
