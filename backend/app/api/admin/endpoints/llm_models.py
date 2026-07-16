"""Admin endpoints for LLM model catalog and provider account management."""
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.admin_permissions import Permission, require_permission
from app.models.base import AdminUser
from app.api.admin.endpoints.auth import get_current_admin
from app.services.llm_billing_service import LLMBillingService

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────────────

class LLMModelBase(BaseModel):
    name: str
    provider: str
    provider_model_id: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: bool = True
    is_system: bool = True
    supports_streaming: bool = True
    context_length: int = 4096
    sort_order: int = 0
    cost_input_per_1k: float = 0.0
    cost_output_per_1k: float = 0.0
    price_input_per_1k: float = 0.0
    price_output_per_1k: float = 0.0
    currency: str = "CNY"


class LLMModelCreate(LLMModelBase):
    id: str = Field(..., min_length=1, max_length=128)


class LLMModelUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    provider_model_id: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None
    is_system: Optional[bool] = None
    supports_streaming: Optional[bool] = None
    context_length: Optional[int] = None
    sort_order: Optional[int] = None
    cost_input_per_1k: Optional[float] = None
    cost_output_per_1k: Optional[float] = None
    price_input_per_1k: Optional[float] = None
    price_output_per_1k: Optional[float] = None
    currency: Optional[str] = None


class LLMModelOut(BaseModel):
    id: str
    name: str
    provider: str
    provider_model_id: str
    description: Optional[str]
    icon: Optional[str]
    color: Optional[str]
    is_active: bool
    is_system: bool
    supports_streaming: bool
    context_length: int
    sort_order: int
    cost_input_per_1k: float
    cost_output_per_1k: float
    price_input_per_1k: float
    price_output_per_1k: float
    currency: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ProviderAccountOut(BaseModel):
    id: str
    name: str
    provider: str
    base_url: Optional[str]
    balance_cny: float
    balance_usd: float
    is_active: bool
    priority: int
    failure_count: int
    last_failure_at: Optional[datetime]
    last_success_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ProviderAccountCreate(BaseModel):
    provider: str
    name: str = "default"
    api_key: str
    base_url: Optional[str] = None
    balance_cny: float = 0.0
    balance_usd: float = 0.0
    is_active: bool = True
    priority: int = 0


class ProviderAccountUpdate(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None
    balance_cny: Optional[float] = None
    balance_usd: Optional[float] = None


# ─── Helpers ──────────────────────────────────────────────────────

def _model_to_dict(model) -> dict:
    return {
        "id": model.id,
        "name": model.name,
        "provider": model.provider,
        "provider_model_id": model.provider_model_id,
        "description": model.description,
        "icon": model.icon,
        "color": model.color,
        "is_active": model.is_active,
        "is_system": model.is_system,
        "supports_streaming": model.supports_streaming,
        "context_length": model.context_length,
        "sort_order": model.sort_order,
        "cost_input_per_1k": float(model.cost_input_per_1k or 0),
        "cost_output_per_1k": float(model.cost_output_per_1k or 0),
        "price_input_per_1k": float(model.price_input_per_1k or 0),
        "price_output_per_1k": float(model.price_output_per_1k or 0),
        "currency": model.currency,
        "created_at": model.created_at,
        "updated_at": model.updated_at,
    }


# ─── Model catalog endpoints ──────────────────────────────────────

@router.get("/models", response_model=List[LLMModelOut], summary="List LLM models")
async def list_models(
    active_only: bool = False,
    provider: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    return [_model_to_dict(m) for m in svc.list_models(active_only=active_only, provider=provider)]


@router.post("/models", response_model=LLMModelOut, summary="Create LLM model")
async def create_model(
    data: LLMModelCreate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    try:
        model = svc.create_model(data.model_dump())
        db.commit()
        db.refresh(model)
        return _model_to_dict(model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建模型失败: {e}")


@router.get("/models/{model_id}", response_model=LLMModelOut, summary="Get LLM model")
async def get_model(
    model_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    model = svc.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return _model_to_dict(model)


@router.patch("/models/{model_id}", response_model=LLMModelOut, summary="Update LLM model")
async def update_model(
    model_id: str,
    data: LLMModelUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    try:
        model = svc.update_model(model_id, data.model_dump(exclude_unset=True))
        db.commit()
        db.refresh(model)
        return _model_to_dict(model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新模型失败: {e}")


@router.delete("/models/{model_id}", summary="Delete LLM model")
async def delete_model(
    model_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    try:
        svc.delete_model(model_id)
        db.commit()
        return {"message": "Model deleted"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除模型失败: {e}")


# ─── Provider account endpoints ───────────────────────────────────

def _account_to_dict(account) -> dict:
    return {
        "id": account.id,
        "name": account.name,
        "provider": account.provider,
        "base_url": account.base_url,
        "balance_cny": float(account.balance_cny or 0),
        "balance_usd": float(account.balance_usd or 0),
        "is_active": account.is_active,
        "priority": account.priority,
        "failure_count": account.failure_count or 0,
        "last_failure_at": account.last_failure_at,
        "last_success_at": account.last_success_at,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


@router.get("/provider-accounts", response_model=List[ProviderAccountOut], summary="List provider accounts")
async def list_provider_accounts(
    provider: Optional[str] = None,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    accounts = svc.list_provider_accounts(provider=provider)
    return [_account_to_dict(a) for a in accounts]


@router.get("/provider-accounts/{account_id}", response_model=ProviderAccountOut, summary="Get provider account")
async def get_provider_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    from app.models.llm_billing import ModelProviderAccount
    account = db.query(ModelProviderAccount).filter(ModelProviderAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Provider account not found")
    return _account_to_dict(account)


@router.post("/provider-accounts", response_model=ProviderAccountOut, summary="Create provider account")
async def create_provider_account(
    data: ProviderAccountCreate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    svc = LLMBillingService(db)
    try:
        account = svc.create_provider_account(data.model_dump())
        db.commit()
        db.refresh(account)
        return _account_to_dict(account)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建厂商账户失败: {e}")


@router.patch("/provider-accounts/{account_id}", response_model=ProviderAccountOut, summary="Update provider account")
async def update_provider_account(
    account_id: str,
    data: ProviderAccountUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.MODELS_MANAGE)),
):
    from app.models.llm_billing import ModelProviderAccount
    svc = LLMBillingService(db)
    try:
        account = db.query(ModelProviderAccount).filter(ModelProviderAccount.id == account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Provider account not found")

        kwargs = data.model_dump(exclude_unset=True)
        if "balance_cny" in kwargs:
            kwargs["balance_cny"] = Decimal(str(kwargs["balance_cny"]))
        if "balance_usd" in kwargs:
            kwargs["balance_usd"] = Decimal(str(kwargs["balance_usd"]))

        for field, value in kwargs.items():
            setattr(account, field, value)
        account.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(account)
        return _account_to_dict(account)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新厂商账户失败: {e}")
