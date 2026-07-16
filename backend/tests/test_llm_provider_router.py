"""Tests for LLM provider account routing."""
import pytest

from app.services.llm_provider_router import LLMProviderRouter
from app.services.llm_billing_service import LLMBillingService
from app.models.llm_billing import ModelProviderAccount


def test_router_prefers_account_with_key(db_session):
    svc = LLMBillingService(db_session)
    svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "primary",
            "api_key": "sk-primary",
            "base_url": "https://api.deepseek.com",
            "priority": 0,
        }
    )
    svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "empty",
            "api_key": "",
            "base_url": "https://api.deepseek.com",
            "priority": 1,
        }
    )
    db_session.commit()

    router = LLMProviderRouter(db_session)
    creds = router.get_credentials("deepseek")
    assert creds is not None
    assert creds["api_key"] == "sk-primary"
    assert creds["base_url"] == "https://api.deepseek.com"


def test_router_skips_unhealthy_accounts(db_session):
    svc = LLMBillingService(db_session)
    healthy = svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "healthy",
            "api_key": "sk-healthy",
            "priority": 1,
        }
    )
    unhealthy = svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "unhealthy",
            "api_key": "sk-unhealthy",
            "priority": 0,
        }
    )
    unhealthy.failure_count = 10
    db_session.commit()

    router = LLMProviderRouter(db_session)
    account = router.get_account("deepseek")
    assert account is not None
    assert account.id == healthy.id


def test_router_falls_back_when_no_healthy_account(db_session):
    svc = LLMBillingService(db_session)
    unhealthy = svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "unhealthy",
            "api_key": "sk-unhealthy",
            "priority": 0,
        }
    )
    unhealthy.failure_count = 10
    db_session.commit()

    router = LLMProviderRouter(db_session)
    account = router.get_account("deepseek")
    assert account is not None
    assert account.id == unhealthy.id


def test_router_returns_none_for_unknown_provider(db_session):
    router = LLMProviderRouter(db_session)
    assert router.get_account("nonexistent") is None
    assert router.get_credentials("nonexistent") is None


def test_llm_service_uses_platform_account(db_session, test_user):
    from app.services.llm_service import LLMService, ModelProvider

    svc = LLMBillingService(db_session)
    account = svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "platform",
            "api_key": "sk-platform",
            "base_url": "https://platform.deepseek.com",
            "priority": 0,
        }
    )
    db_session.commit()

    llm = LLMService()
    creds = llm._resolve_credentials(ModelProvider.DEEPSEEK, {}, db_session)
    assert creds["api_key"] == "sk-platform"
    assert creds["base_url"] == "https://platform.deepseek.com"
    assert creds["account_id"] == account.id


def test_llm_service_user_key_takes_precedence(db_session, test_user):
    from app.services.llm_service import LLMService, ModelProvider

    svc = LLMBillingService(db_session)
    svc.create_provider_account(
        {
            "provider": "deepseek",
            "name": "platform",
            "api_key": "sk-platform",
            "priority": 0,
        }
    )
    db_session.commit()

    llm = LLMService()
    cfg = {"deepseek_api_key": "sk-user"}
    creds = llm._resolve_credentials(ModelProvider.DEEPSEEK, cfg, db_session)
    assert creds["api_key"] == "sk-user"
    assert "account_id" not in creds
