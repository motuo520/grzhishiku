"""桌面端外部模型会员门：本机注册的桌面用户使用外部模型（BYOK/平台）
必须是云端存储会员（9.9/月档及以上）。

判定方式：桌面端绑定云端账号后，用云端 token 拉取云端账号的
subscription_tier 并缓存 1 小时；非 free 即放行。网页端/自托管不受影响。
"""
import json
import os
import time
from typing import Optional

import httpx
from fastapi import HTTPException

_BINDING_FILE = "cloud_account.json"
_TIER_CACHE_SECONDS = 3600
_MEMBER_TIERS = {"storage", "pro", "team", "enterprise"}


def is_desktop() -> bool:
    return os.environ.get("PSB_DESKTOP") == "1"


def _binding_path() -> str:
    return os.path.join(os.getcwd(), _BINDING_FILE)


def _load_binding() -> Optional[dict]:
    path = _binding_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _save_binding(binding: dict) -> None:
    with open(_binding_path(), "w", encoding="utf-8") as f:
        json.dump(binding, f, ensure_ascii=False)


async def cloud_member_tier() -> Optional[str]:
    """云端账号的订阅 tier；未绑定/查询失败返回 None。结果缓存 1 小时。"""
    binding = _load_binding()
    if not binding:
        return None
    now = time.time()
    if binding.get("tier") and now - binding.get("tier_checked_at", 0) < _TIER_CACHE_SECONDS:
        return binding["tier"]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{binding['server_url']}/api/v1/users/me",
                headers={"Authorization": f"Bearer {binding['token']}"},
            )
        if resp.status_code == 200:
            tier = resp.json().get("subscription_tier") or "free"
            binding["tier"] = tier
            binding["tier_checked_at"] = now
            _save_binding(binding)
            return tier
    except httpx.HTTPError:
        pass
    return binding.get("tier")  # 网络失败时沿用旧缓存（可能为 None）


async def require_external_models_member(provider: str, db=None, user_id: str = "") -> None:
    """桌面端外部模型守卫：非 ollama 模型需会员。网页端直接放行。

    会员判定（任一满足）：
    1. 本机订阅有效（9.9 存储会员，本机扫码购买，复用 cloud_sync 功能位）
    2. 绑定的云端账号是付费会员（云端已付费，不重复购买）
    """
    if not is_desktop() or provider == "ollama":
        return
    if db is not None and user_id:
        try:
            from app.services.billing_service import BillingService
            if BillingService(db).check_feature_access(user_id, "cloud_sync"):
                return
        except Exception:
            pass
    tier = await cloud_member_tier()
    if tier in _MEMBER_TIERS:
        return
    raise HTTPException(
        status_code=403,
        detail="外部模型为存储会员功能（¥9.9/月）。请在「设置 → 桌面端/会员」本机开通，或绑定已开通会员的云端账号。token 用量可走自己的 API Key（BYOK）另计。",
    )
