from decimal import Decimal
from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, Numeric, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class LLMModel(Base):
    """System-managed LLM models that can be billed per token."""
    __tablename__ = "llm_models"

    id = Column(String, primary_key=True)                       # e.g. "deepseek-v4-pro"
    name = Column(String, nullable=False)                       # display name
    provider = Column(String, nullable=False)                   # ollama / deepseek / kimi / opencode
    provider_model_id = Column(String, nullable=False)          # real model id passed to the provider
    description = Column(Text)
    icon = Column(String)
    color = Column(String)

    is_active = Column(Boolean, default=True)                   # visible/available to users
    is_system = Column(Boolean, default=True)                   # True = platform pays; False = local/user-key
    supports_streaming = Column(Boolean, default=True)
    context_length = Column(Integer, default=4096)
    sort_order = Column(Integer, default=0)

    # Pricing in CNY per 1K tokens
    cost_input_per_1k = Column(Numeric(18, 8), default=Decimal("0"))
    cost_output_per_1k = Column(Numeric(18, 8), default=Decimal("0"))
    price_input_per_1k = Column(Numeric(18, 8), default=Decimal("0"))
    price_output_per_1k = Column(Numeric(18, 8), default=Decimal("0"))
    currency = Column(String, default="CNY")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_llm_models_provider_active", "provider", "is_active"),
    )


class ModelProviderAccount(Base):
    """Platform API keys / accounts used to call upstream providers."""
    __tablename__ = "model_provider_accounts"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, default="default")    # human-readable account name
    provider = Column(String, nullable=False)                   # e.g. deepseek / kimi / opencode
    api_key = Column(String, nullable=False)                    # TODO: encrypt at rest in production
    base_url = Column(String)
    balance_cny = Column(Numeric(18, 4), default=Decimal("0"))
    balance_usd = Column(Numeric(18, 4), default=Decimal("0"))
    is_active = Column(Boolean, default=True)
    priority = Column(Integer, default=0)                       # lower = tried first
    failure_count = Column(Integer, default=0)
    last_failure_at = Column(DateTime)
    last_success_at = Column(DateTime)
    extra_data = Column(Text)                                   # JSON
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # One provider may have multiple accounts; (provider, name) is the natural key.
        Index("idx_provider_accounts_provider_name", "provider", "name", unique=True),
    )


class UserBalance(Base):
    """Prepaid LLM balance account for each user."""
    __tablename__ = "user_balances"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    balance = Column(Numeric(18, 4), default=Decimal("0"))      # available balance
    frozen = Column(Numeric(18, 4), default=Decimal("0"))       # temporarily frozen during a call
    total_deposited = Column(Numeric(18, 4), default=Decimal("0"))
    total_used = Column(Numeric(18, 4), default=Decimal("0"))
    version = Column(Integer, default=0)                        # optimistic locking
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="balance_account")


class BalanceTransaction(Base):
    """Ledger of every balance change."""
    __tablename__ = "balance_transactions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 4), nullable=False)             # positive = deposit/gift/refund; negative = usage
    transaction_type = Column(String, nullable=False)           # deposit / usage / refund / gift / adjust / unfreeze
    balance_after = Column(Numeric(18, 4), nullable=False)
    reference_id = Column(String)
    description = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_balance_transactions_user_created", "user_id", "created_at"),
        Index("idx_balance_transactions_type_created", "transaction_type", "created_at"),
    )


class LLMUsageRecord(Base):
    """Per-call usage record for system models."""
    __tablename__ = "llm_usage_records"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    model_id = Column(String, ForeignKey("llm_models.id"), nullable=False)
    task_type = Column(String, nullable=False)                  # chat / summarize / extract / collision / verify / ...

    estimated_input_tokens = Column(Integer, default=0)
    estimated_output_tokens = Column(Integer, default=0)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)

    cost = Column(Numeric(18, 8), default=Decimal("0"))         # platform cost in CNY
    price = Column(Numeric(18, 8), default=Decimal("0"))        # user charge in CNY

    status = Column(String, default="pending")                  # pending / completed / failed / refunded
    request_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime)

    __table_args__ = (
        Index("idx_llm_usage_user_created", "user_id", "created_at"),
        Index("idx_llm_usage_model_created", "model_id", "created_at"),
    )
