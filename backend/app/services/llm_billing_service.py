"""User balance, LLM usage records and model/provider account management."""
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, Optional, List
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.llm_billing import (
    LLMModel,
    ModelProviderAccount,
    UserBalance,
    BalanceTransaction,
    LLMUsageRecord,
)
from app.models.base import User


TRIAL_CREDIT_CNY = Decimal("1.00")


class ConcurrentModificationError(Exception):
    """Raised when an optimistic-lock balance update fails due to concurrent mutation."""


def _now() -> datetime:
    return datetime.utcnow()


def _to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


class LLMBillingService:
    """User balance ledger and per-call LLM billing primitives."""

    def __init__(self, db: Session):
        self.db = db

    # ─── User balance ───────────────────────────────────────────────

    def get_or_create_balance(self, user_id: str) -> UserBalance:
        balance = self.db.query(UserBalance).filter(UserBalance.user_id == user_id).first()
        if not balance:
            balance = UserBalance(
                id=str(uuid.uuid4()),
                user_id=user_id,
                balance=Decimal("0"),
                frozen=Decimal("0"),
                total_deposited=Decimal("0"),
                total_used=Decimal("0"),
                version=0,
            )
            self.db.add(balance)
            self.db.flush()
        return balance

    def get_balance(self, user_id: str) -> Optional[UserBalance]:
        return self.db.query(UserBalance).filter(UserBalance.user_id == user_id).first()

    def _atomic_update_balance(
        self,
        user_id: str,
        old_version: int,
        new_balance: Decimal,
        new_frozen: Decimal,
        new_total_used: Optional[Decimal] = None,
        new_total_deposited: Optional[Decimal] = None,
    ) -> bool:
        """
        Optimistic-locking update of user balance.
        Returns True if the row with the expected version was updated.
        """
        updates: Dict[str, Any] = {
            UserBalance.balance: new_balance,
            UserBalance.frozen: new_frozen,
            UserBalance.version: old_version + 1,
        }
        if new_total_used is not None:
            updates[UserBalance.total_used] = new_total_used
        if new_total_deposited is not None:
            updates[UserBalance.total_deposited] = new_total_deposited

        updated = self.db.query(UserBalance).filter(
            UserBalance.user_id == user_id,
            UserBalance.version == old_version,
        ).update(updates, synchronize_session=False)

        return updated > 0

    def give_trial_credit(self, user_id: str, amount: Decimal = TRIAL_CREDIT_CNY, commit: bool = True) -> bool:
        """Give one-time trial credit to a new user. Returns True if credited."""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        if getattr(user, "trial_credit_given", False):
            return False

        balance = self.get_or_create_balance(user_id)
        self._credit_balance(
            user_id=user_id,
            amount=amount,
            transaction_type="gift",
            reference_id=None,
            description="新用户试用余额",
        )
        user.trial_credit_given = True
        if commit:
            self.db.commit()
        return True

    def _credit_balance(
        self,
        user_id: str,
        amount: Decimal,
        transaction_type: str,
        reference_id: Optional[str],
        description: str,
    ) -> BalanceTransaction:
        balance = self.get_or_create_balance(user_id)
        old_version = balance.version or 0
        new_balance = _to_decimal(balance.balance) + amount
        new_total_deposited = None
        if amount > 0:
            new_total_deposited = _to_decimal(balance.total_deposited) + amount

        if not self._atomic_update_balance(
            user_id=user_id,
            old_version=old_version,
            new_balance=new_balance,
            new_frozen=_to_decimal(balance.frozen),
            new_total_deposited=new_total_deposited,
        ):
            raise ConcurrentModificationError("余额被并发修改，请重试")

        # Keep the in-memory object consistent with the DB row
        balance.balance = new_balance
        balance.frozen = _to_decimal(balance.frozen)
        balance.version = old_version + 1
        if new_total_deposited is not None:
            balance.total_deposited = new_total_deposited

        tx = BalanceTransaction(
            id=str(uuid.uuid4()),
            user_id=user_id,
            amount=amount,
            transaction_type=transaction_type,
            balance_after=new_balance,
            reference_id=reference_id,
            description=description,
        )
        self.db.add(tx)
        self.db.flush()
        return tx

    def deposit_balance(
        self,
        user_id: str,
        amount_cents: int,
        reference_id: str,
        description: str,
        commit: bool = True,
    ) -> BalanceTransaction:
        """Credit user balance from a top-up payment (amount in cents -> CNY)."""
        amount = Decimal(amount_cents) / Decimal("100")
        tx = self._credit_balance(
            user_id=user_id,
            amount=amount,
            transaction_type="deposit",
            reference_id=reference_id,
            description=description,
        )
        if commit:
            self.db.commit()
        return tx

    def admin_adjust_balance(
        self,
        user_id: str,
        amount_yuan: float,
        reason: str,
        admin_id: str,
        commit: bool = True,
    ) -> BalanceTransaction:
        """Admin manual adjustment (amount in CNY, can be negative)."""
        amount = _to_decimal(amount_yuan)
        tx = self._credit_balance(
            user_id=user_id,
            amount=amount,
            transaction_type="admin_adjust",
            reference_id=admin_id,
            description=reason,
        )
        if commit:
            self.db.commit()
        return tx

    # ─── LLM usage lifecycle ────────────────────────────────────────

    def _ensure_model_row(self, model_id: str) -> None:
        """目录外模型（内置默认模型、用户自定义本地模型等）自动补一行零计价
        目录，只用于记录用量。否则 llm_usage_records.model_id 的外键会让整个
        请求 500（FK constraint failed）。"""
        exists = self.db.query(LLMModel).filter(LLMModel.id == model_id).first()
        if exists:
            return
        self.db.add(LLMModel(
            id=model_id,
            name=model_id,
            provider=model_id.split("-")[0] if model_id else "unknown",
            provider_model_id=model_id,
            description="自动补录的目录外模型，仅记录用量不计费",
            is_active=False,
            is_system=False,
            supports_streaming=True,
            context_length=128000,
            sort_order=999,
        ))
        self.db.flush()

    def freeze(
        self,
        user_id: str,
        model_id: str,
        task_type: str,
        estimated_input_tokens: int,
        estimated_output_tokens: int,
        estimated_price: Decimal,
        estimated_cost: Optional[Decimal] = None,
        request_id: Optional[str] = None,
    ) -> str:
        """
        Freeze estimated price from user balance and create a pending usage record.
        Returns the usage record id.
        """
        balance = self.get_or_create_balance(user_id)
        price = _to_decimal(estimated_price)

        self._ensure_model_row(model_id)

        if _to_decimal(balance.balance) < price:
            raise ValueError("余额不足，请先充值")

        old_version = balance.version or 0
        new_balance = _to_decimal(balance.balance) - price
        new_frozen = _to_decimal(balance.frozen) + price

        if not self._atomic_update_balance(
            user_id=user_id,
            old_version=old_version,
            new_balance=new_balance,
            new_frozen=new_frozen,
        ):
            raise ConcurrentModificationError("余额被并发修改，请重试")

        balance.balance = new_balance
        balance.frozen = new_frozen
        balance.version = old_version + 1

        record = LLMUsageRecord(
            id=str(uuid.uuid4()),
            user_id=user_id,
            model_id=model_id,
            task_type=task_type,
            estimated_input_tokens=estimated_input_tokens,
            estimated_output_tokens=estimated_output_tokens,
            input_tokens=0,
            output_tokens=0,
            cost=_to_decimal(estimated_cost) if estimated_cost else Decimal("0"),
            price=price,
            status="pending",
            request_id=request_id,
        )
        self.db.add(record)

        tx = BalanceTransaction(
            id=str(uuid.uuid4()),
            user_id=user_id,
            amount=-price,
            transaction_type="freeze",
            balance_after=balance.balance,
            reference_id=record.id,
            description=f"冻结 {task_type} 预估费用",
        )
        self.db.add(tx)
        self.db.flush()
        return record.id

    def complete(
        self,
        record_id: str,
        actual_input_tokens: int,
        actual_output_tokens: int,
        actual_cost: Decimal,
        actual_price: Decimal,
    ) -> Dict[str, Any]:
        """Unfreeze and charge the actual price; return any overcharge."""
        record = self.db.query(LLMUsageRecord).filter(LLMUsageRecord.id == record_id).first()
        if not record:
            raise ValueError("Usage record not found")
        if record.status != "pending":
            raise ValueError(f"Usage record is not pending: {record.status}")

        balance = self.get_or_create_balance(record.user_id)
        frozen = _to_decimal(record.price)
        actual_price_d = _to_decimal(actual_price)
        actual_cost_d = _to_decimal(actual_cost)

        old_version = balance.version or 0
        # Refund the frozen estimate back to available balance, then deduct actual price
        new_balance = _to_decimal(balance.balance) + frozen - actual_price_d
        new_frozen = _to_decimal(balance.frozen) - frozen
        new_total_used = _to_decimal(balance.total_used) + actual_price_d

        if not self._atomic_update_balance(
            user_id=record.user_id,
            old_version=old_version,
            new_balance=new_balance,
            new_frozen=new_frozen,
            new_total_used=new_total_used,
        ):
            raise ConcurrentModificationError("余额被并发修改，请重试")

        balance.balance = new_balance
        balance.frozen = new_frozen
        balance.total_used = new_total_used
        balance.version = old_version + 1

        record.input_tokens = actual_input_tokens
        record.output_tokens = actual_output_tokens
        record.cost = actual_cost_d
        record.price = actual_price_d
        record.status = "completed"
        record.completed_at = _now()

        # Transaction for actual charge
        tx = BalanceTransaction(
            id=str(uuid.uuid4()),
            user_id=record.user_id,
            amount=-actual_price_d,
            transaction_type="usage",
            balance_after=new_balance,
            reference_id=record.id,
            description=f"结算 {record.task_type} 实际费用",
        )
        self.db.add(tx)
        self.db.flush()

        return {
            "record_id": record.id,
            "input_tokens": actual_input_tokens,
            "output_tokens": actual_output_tokens,
            "cost": float(actual_cost_d),
            "price": float(actual_price_d),
            "balance": float(new_balance),
        }

    def fail(self, record_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        """Unfreeze the estimated price when a call fails."""
        record = self.db.query(LLMUsageRecord).filter(LLMUsageRecord.id == record_id).first()
        if not record:
            raise ValueError("Usage record not found")
        if record.status != "pending":
            raise ValueError(f"Usage record is not pending: {record.status}")

        balance = self.get_or_create_balance(record.user_id)
        frozen = _to_decimal(record.price)

        old_version = balance.version or 0
        new_balance = _to_decimal(balance.balance) + frozen
        new_frozen = _to_decimal(balance.frozen) - frozen

        if not self._atomic_update_balance(
            user_id=record.user_id,
            old_version=old_version,
            new_balance=new_balance,
            new_frozen=new_frozen,
        ):
            raise ConcurrentModificationError("余额被并发修改，请重试")

        balance.balance = new_balance
        balance.frozen = new_frozen
        balance.version = old_version + 1

        record.status = "failed"
        record.completed_at = _now()

        tx = BalanceTransaction(
            id=str(uuid.uuid4()),
            user_id=record.user_id,
            amount=frozen,
            transaction_type="unfreeze",
            balance_after=new_balance,
            reference_id=record.id,
            description=f"调用失败，解冻预估费用" + (f" ({reason})" if reason else ""),
        )
        self.db.add(tx)
        self.db.flush()

        return {"record_id": record.id, "refunded": float(frozen), "balance": float(new_balance)}

    def list_usage(
        self,
        user_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[LLMUsageRecord]:
        q = self.db.query(LLMUsageRecord)
        if user_id:
            q = q.filter(LLMUsageRecord.user_id == user_id)
        return q.order_by(LLMUsageRecord.created_at.desc()).offset(skip).limit(limit).all()

    def list_transactions(
        self,
        user_id: Optional[str] = None,
        transaction_type: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[BalanceTransaction]:
        """List balance transactions with optional filtering."""
        q = self.db.query(BalanceTransaction)
        if user_id:
            q = q.filter(BalanceTransaction.user_id == user_id)
        if transaction_type:
            q = q.filter(BalanceTransaction.transaction_type == transaction_type)
        return q.order_by(BalanceTransaction.created_at.desc()).offset(skip).limit(limit).all()

    # ─── Provider account admin helpers ─────────────────────────────

    def list_provider_accounts(
        self,
        provider: Optional[str] = None,
        active_only: bool = False,
    ) -> List[ModelProviderAccount]:
        q = self.db.query(ModelProviderAccount)
        if provider:
            q = q.filter(ModelProviderAccount.provider == provider)
        if active_only:
            q = q.filter(ModelProviderAccount.is_active == True)
        return q.order_by(
            ModelProviderAccount.priority.asc(),
            ModelProviderAccount.failure_count.asc(),
            ModelProviderAccount.last_success_at.desc().nullslast(),
        ).all()

    def get_provider_account(self, provider: str, name: str = "default") -> Optional[ModelProviderAccount]:
        return (
            self.db.query(ModelProviderAccount)
            .filter(ModelProviderAccount.provider == provider, ModelProviderAccount.name == name)
            .first()
        )

    def create_provider_account(self, data: Dict[str, Any]) -> ModelProviderAccount:
        provider = data["provider"]
        name = data.get("name", "default")
        if self.get_provider_account(provider, name):
            raise ValueError(f"Provider account already exists: {provider}/{name}")

        account = ModelProviderAccount(
            id=str(uuid.uuid4()),
            provider=provider,
            name=name,
            api_key=data["api_key"],
            base_url=data.get("base_url"),
            balance_cny=_to_decimal(data.get("balance_cny", 0)),
            balance_usd=_to_decimal(data.get("balance_usd", 0)),
            is_active=data.get("is_active", True),
            priority=data.get("priority", 0),
            extra_data=data.get("extra_data"),
        )
        self.db.add(account)
        self.db.flush()
        return account

    def update_provider_account(
        self,
        provider: str,
        name: str = "default",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        is_active: Optional[bool] = None,
        priority: Optional[int] = None,
        balance_cny: Optional[Decimal] = None,
        balance_usd: Optional[Decimal] = None,
    ) -> ModelProviderAccount:
        account = self.get_provider_account(provider, name)
        if not account:
            raise ValueError(f"Provider account not found: {provider}/{name}")

        if api_key is not None:
            account.api_key = api_key
        if base_url is not None:
            account.base_url = base_url
        if is_active is not None:
            account.is_active = is_active
        if priority is not None:
            account.priority = priority
        if balance_cny is not None:
            account.balance_cny = balance_cny
        if balance_usd is not None:
            account.balance_usd = balance_usd

        account.updated_at = _now()
        self.db.flush()
        return account

    def touch_provider_account_success(self, account_id: str) -> None:
        account = self.db.query(ModelProviderAccount).filter(ModelProviderAccount.id == account_id).first()
        if account:
            account.failure_count = 0
            account.last_success_at = _now()
            account.updated_at = _now()
            self.db.flush()

    def touch_provider_account_failure(self, account_id: str) -> None:
        account = self.db.query(ModelProviderAccount).filter(ModelProviderAccount.id == account_id).first()
        if account:
            account.failure_count = (account.failure_count or 0) + 1
            account.last_failure_at = _now()
            account.updated_at = _now()
            self.db.flush()

    # ─── Model catalog admin helpers ────────────────────────────────

    def list_models(
        self,
        active_only: bool = False,
        provider: Optional[str] = None,
    ) -> List[LLMModel]:
        q = self.db.query(LLMModel)
        if active_only:
            q = q.filter(LLMModel.is_active == True)
        if provider:
            q = q.filter(LLMModel.provider == provider)
        return q.order_by(LLMModel.sort_order.asc(), LLMModel.name.asc()).all()

    def get_model(self, model_id: str) -> Optional[LLMModel]:
        return self.db.query(LLMModel).filter(LLMModel.id == model_id).first()

    def create_model(self, data: Dict[str, Any]) -> LLMModel:
        if self.get_model(data["id"]):
            raise ValueError(f"Model id already exists: {data['id']}")
        model = LLMModel(
            id=data["id"],
            name=data["name"],
            provider=data["provider"],
            provider_model_id=data["provider_model_id"],
            description=data.get("description"),
            icon=data.get("icon"),
            color=data.get("color"),
            is_active=data.get("is_active", True),
            is_system=data.get("is_system", True),
            supports_streaming=data.get("supports_streaming", True),
            context_length=data.get("context_length", 4096),
            sort_order=data.get("sort_order", 0),
            cost_input_per_1k=_to_decimal(data.get("cost_input_per_1k", 0)),
            cost_output_per_1k=_to_decimal(data.get("cost_output_per_1k", 0)),
            price_input_per_1k=_to_decimal(data.get("price_input_per_1k", 0)),
            price_output_per_1k=_to_decimal(data.get("price_output_per_1k", 0)),
            currency=data.get("currency", "CNY"),
        )
        self.db.add(model)
        self.db.flush()
        return model

    def update_model(self, model_id: str, data: Dict[str, Any]) -> LLMModel:
        model = self.get_model(model_id)
        if not model:
            raise ValueError(f"Model not found: {model_id}")

        for field in [
            "name", "provider", "provider_model_id", "description",
            "icon", "color", "is_active", "is_system",
            "supports_streaming", "context_length", "sort_order", "currency",
        ]:
            if field in data:
                setattr(model, field, data[field])

        for field in [
            "cost_input_per_1k", "cost_output_per_1k",
            "price_input_per_1k", "price_output_per_1k",
        ]:
            if field in data:
                setattr(model, field, _to_decimal(data[field]))

        model.updated_at = _now()
        self.db.flush()
        return model

    def delete_model(self, model_id: str) -> None:
        model = self.get_model(model_id)
        if not model:
            raise ValueError(f"Model not found: {model_id}")
        if model.is_system:
            raise ValueError("Cannot delete system models")
        self.db.delete(model)
        self.db.flush()


def get_balance_summary(db: Session, user_id: str) -> Dict[str, float]:
    """Public helper to return user balance as JSON-safe floats."""
    balance = db.query(UserBalance).filter(UserBalance.user_id == user_id).first()
    if not balance:
        return {"balance": 0.0, "frozen": 0.0, "total_deposited": 0.0, "total_used": 0.0}
    def _fmt(d):
        v = _to_decimal(d)
        # Avoid -0.0 float artifacts
        return float(v) if v != 0 else 0.0

    return {
        "balance": _fmt(balance.balance),
        "frozen": _fmt(max(_to_decimal(balance.frozen), Decimal("0"))),
        "total_deposited": _fmt(balance.total_deposited),
        "total_used": _fmt(balance.total_used),
    }


# ─── Billed streaming helper ──────────────────────────────────────

from contextlib import asynccontextmanager
from app.services.llm_cost_service import LLMCostService, estimate_tokens, estimate_message_tokens


@asynccontextmanager
async def billed_stream(
    db: Session,
    user_id: str,
    model_id: str,
    task_type: str,
    input_text: Optional[str] = None,
    input_messages: Optional[List[Dict[str, Any]]] = None,
    request_id: Optional[str] = None,
):
    """
    Async context manager that freezes estimated balance before an LLM call
    and settles the actual cost after the stream finishes.

    Usage:
        async with billed_stream(db, user_id, model_id, "chat", input_messages=messages) as streamer:
            async for chunk in streamer.wrap(llm_service.chat(...)):
                yield chunk
    """
    cost_svc = LLMCostService(db)
    billing_svc = LLMBillingService(db)

    try:
        estimate = cost_svc.estimate_usage(
            model_id=model_id,
            input_text=input_text,
            input_messages=input_messages,
        )
    except ValueError as e:
        # Model not in catalog: allow the call but don't bill
        estimate = {
            "model_id": model_id,
            "input_tokens": estimate_tokens(input_text) if input_text else estimate_message_tokens(input_messages),
            "output_tokens": 0,
            "cost": 0.0,
            "price": 0.0,
        }

    record_id = None
    output_chunks: List[str] = []

    class Streamer:
        async def wrap(self, generator):
            nonlocal output_chunks
            async for chunk in generator:
                if chunk:
                    output_chunks.append(chunk)
                yield chunk

    # Freeze balance with one retry on optimistic-lock conflict.
    for attempt in range(2):
        try:
            # Give existing users a one-time trial credit if they haven't received it
            billing_svc.give_trial_credit(user_id, commit=False)
            record_id = billing_svc.freeze(
                user_id=user_id,
                model_id=estimate["model_id"],
                task_type=task_type,
                estimated_input_tokens=estimate["input_tokens"],
                estimated_output_tokens=estimate["output_tokens"],
                estimated_price=Decimal(str(estimate["price"])),
                estimated_cost=Decimal(str(estimate["cost"])),
                request_id=request_id,
            )
            db.commit()
            break
        except ConcurrentModificationError:
            db.rollback()
            db.expire_all()
            if attempt == 1:
                raise
        except ValueError as e:
            # Balance insufficient
            raise e
        except Exception:
            # Catalog issue, allow call without billing
            record_id = None
            break

    streamer = Streamer()
    failed = False
    try:
        yield streamer
    except Exception as e:
        failed = True
        if record_id:
            try:
                billing_svc.fail(record_id, reason=str(e)[:200])
                db.commit()
            except Exception:
                db.rollback()
        raise
    finally:
        if record_id and not failed:
            output_text = "".join(output_chunks)
            output_tokens = estimate_tokens(output_text)
            settled = False
            for attempt in range(2):
                try:
                    actual = cost_svc.calculate_actual(
                        model_id=estimate["model_id"],
                        input_tokens=estimate["input_tokens"],
                        output_tokens=output_tokens,
                    )
                    billing_svc.complete(
                        record_id=record_id,
                        actual_input_tokens=estimate["input_tokens"],
                        actual_output_tokens=output_tokens,
                        actual_cost=Decimal(str(actual["cost"])),
                        actual_price=Decimal(str(actual["price"])),
                    )
                    db.commit()
                    settled = True
                    break
                except ConcurrentModificationError:
                    db.rollback()
                    db.expire_all()
                    if attempt == 1:
                        break
                except Exception:
                    break

            if not settled:
                try:
                    billing_svc.fail(record_id, reason="settlement_error")
                    db.commit()
                except Exception:
                    db.rollback()


# Ordered fallback models used when the routed/selected provider cannot serve the
# request (e.g. local Ollama offline, or a cloud provider without credentials).
# Only entries that are actually configured in this deployment are used.
PIPELINE_FALLBACK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"]


def _is_failed_llm_output(text: str) -> bool:
    """Detect an empty or provider-error LLM output that should trigger a fallback."""
    if not text or not text.strip():
        return True
    return text.lstrip().startswith("[Error")


async def _chat_once(
    db: Session,
    user_id: str,
    model_id: str,
    task_type: str,
    prompt: str,
    system_prompt: Optional[str],
    request_id: Optional[str],
) -> str:
    """Run a single billed chat completion against one model."""
    from app.services.llm_service import llm_service

    output_chunks: List[str] = []
    messages = [{"role": "user", "content": prompt}]
    async with billed_stream(
        db=db,
        user_id=user_id,
        model_id=model_id,
        task_type=task_type,
        input_messages=messages,
        request_id=request_id,
    ) as streamer:
        async for chunk in streamer.wrap(
            llm_service.chat(
                message=prompt,
                task_type=task_type,
                system_prompt=system_prompt,
                preferred_model=model_id,
            )
        ):
            output_chunks.append(chunk)
    return "".join(output_chunks)


async def billed_chat_completion(
    db: Session,
    user_id: str,
    model_id: str,
    task_type: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    request_id: Optional[str] = None,
) -> str:
    """Non-streaming helper for pipeline extraction / collision. Returns full text.

    If the routed/selected model yields an empty or provider-error response (e.g.
    local Ollama offline), retry against configured cloud fallbacks so the pipeline
    keeps working instead of failing with a 500.
    """
    import logging
    from app.services.llm_service import ModelConfig

    logger = logging.getLogger(__name__)

    fallbacks = [
        m for m in PIPELINE_FALLBACK_MODELS
        if m != model_id and (ModelConfig.get(m) or {}).get("available")
    ]
    candidates = [model_id] + fallbacks

    last_output = ""
    for candidate in candidates:
        output = await _chat_once(
            db=db,
            user_id=user_id,
            model_id=candidate,
            task_type=task_type,
            prompt=prompt,
            system_prompt=system_prompt,
            request_id=request_id,
        )
        if not _is_failed_llm_output(output):
            if candidate != model_id:
                logger.warning(
                    f"LLM fallback engaged: primary model '{model_id}' failed for task "
                    f"'{task_type}', used '{candidate}' instead"
                )
            return output
        last_output = output
        logger.warning(
            f"LLM model '{candidate}' returned empty/error output for task '{task_type}'; "
            f"trying next fallback"
        )
    return last_output


async def billed_embed(
    db: Session,
    user_id: str,
    model_id: str,
    text: str,
    request_id: Optional[str] = None,
) -> List[float]:
    """Generate embedding with balance freeze/settle. Output tokens are zero for embeddings."""
    from app.services.llm_cost_service import LLMCostService, estimate_tokens
    from app.services.llm_service import llm_service

    cost_svc = LLMCostService(db)
    billing_svc = LLMBillingService(db)

    try:
        estimate = cost_svc.estimate_usage(
            model_id=model_id,
            input_text=text,
            output_text="",
        )
    except ValueError:
        # Model not in catalog: allow the call but don't bill
        return await llm_service.embed(text)

    record_id = None
    for attempt in range(2):
        try:
            billing_svc.give_trial_credit(user_id, commit=False)
            record_id = billing_svc.freeze(
                user_id=user_id,
                model_id=estimate["model_id"],
                task_type="embed",
                estimated_input_tokens=estimate["input_tokens"],
                estimated_output_tokens=0,
                estimated_price=Decimal(str(estimate["price"])),
                estimated_cost=Decimal(str(estimate["cost"])),
                request_id=request_id,
            )
            db.commit()
            break
        except ConcurrentModificationError:
            db.rollback()
            db.expire_all()
            if attempt == 1:
                raise
        except ValueError:
            raise
        except Exception:
            record_id = None
            break

    try:
        embedding = await llm_service.embed(text)
    except Exception as e:
        if record_id:
            try:
                billing_svc.fail(record_id, reason=str(e)[:200])
                db.commit()
            except Exception:
                db.rollback()
        raise

    if record_id:
        settled = False
        for attempt in range(2):
            try:
                actual = cost_svc.calculate_actual(
                    model_id=estimate["model_id"],
                    input_tokens=estimate["input_tokens"],
                    output_tokens=0,
                )
                billing_svc.complete(
                    record_id=record_id,
                    actual_input_tokens=estimate["input_tokens"],
                    actual_output_tokens=0,
                    actual_cost=Decimal(str(actual["cost"])),
                    actual_price=Decimal(str(actual["price"])),
                )
                db.commit()
                settled = True
                break
            except ConcurrentModificationError:
                db.rollback()
                db.expire_all()
                if attempt == 1:
                    break
            except Exception:
                break

        if not settled:
            try:
                billing_svc.fail(record_id, reason="settlement_error")
                db.commit()
            except Exception:
                db.rollback()

    return embedding


async def billed_embed_batch(
    db: Session,
    user_id: str,
    model_id: str,
    texts: List[str],
    request_id: Optional[str] = None,
) -> List[List[float]]:
    """Batch embedding with a single balance freeze/settle."""
    from app.services.llm_cost_service import LLMCostService, estimate_tokens
    from app.services.llm_service import llm_service

    cost_svc = LLMCostService(db)
    billing_svc = LLMBillingService(db)

    total_input_tokens = sum(estimate_tokens(t) for t in texts)

    try:
        model = cost_svc.get_model(model_id)
    except ValueError:
        model = None

    if not model:
        # Model not in catalog: allow the call but don't bill
        return await llm_service.batch_embed(texts)

    estimated_cost = (Decimal(str(model.cost_input_per_1k or 0)) * total_input_tokens) / Decimal("1000")
    estimated_price = (Decimal(str(model.price_input_per_1k or 0)) * total_input_tokens) / Decimal("1000")

    record_id = None
    for attempt in range(2):
        try:
            billing_svc.give_trial_credit(user_id, commit=False)
            record_id = billing_svc.freeze(
                user_id=user_id,
                model_id=model.id,
                task_type="embed",
                estimated_input_tokens=total_input_tokens,
                estimated_output_tokens=0,
                estimated_price=estimated_price,
                estimated_cost=estimated_cost,
                request_id=request_id,
            )
            db.commit()
            break
        except ConcurrentModificationError:
            db.rollback()
            db.expire_all()
            if attempt == 1:
                raise
        except ValueError:
            raise
        except Exception:
            record_id = None
            break

    try:
        embeddings = await llm_service.batch_embed(texts)
    except Exception as e:
        if record_id:
            try:
                billing_svc.fail(record_id, reason=str(e)[:200])
                db.commit()
            except Exception:
                db.rollback()
        raise

    if record_id:
        settled = False
        for attempt in range(2):
            try:
                billing_svc.complete(
                    record_id=record_id,
                    actual_input_tokens=total_input_tokens,
                    actual_output_tokens=0,
                    actual_cost=estimated_cost,
                    actual_price=estimated_price,
                )
                db.commit()
                settled = True
                break
            except ConcurrentModificationError:
                db.rollback()
                db.expire_all()
                if attempt == 1:
                    break
            except Exception:
                break

        if not settled:
            try:
                billing_svc.fail(record_id, reason="settlement_error")
                db.commit()
            except Exception:
                db.rollback()

    return embeddings
