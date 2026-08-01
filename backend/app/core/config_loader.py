"""Unified system config loader with in-memory cache.

This module provides a cached view of the `system_configs` table for use by
business endpoints and middleware. Admin endpoints in
`app.api.admin.endpoints.system` write to the same table and invalidate the
cache after updates.
"""

import json
import time
import threading
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.base import SystemConfig as SysConfigModel
from app.services.email_sender import EmailConfig


class SystemConfigSnapshot:
    """Read-only snapshot of system configuration."""

    def __init__(self, raw: Dict[str, Any]):
        self._raw = raw

    def _get(self, key: str, default: Any) -> Any:
        val = self._raw.get(key)
        if val is None:
            return default
        if isinstance(val, str) and val.lower() in ("true", "false"):
            return val.lower() == "true"
        return val

    @property
    def registration_open(self) -> bool:
        return bool(self._get("registration_open", True))

    @property
    def maintenance_enabled(self) -> bool:
        mode = self._get("maintenance_mode", {})
        if isinstance(mode, str):
            try:
                mode = json.loads(mode)
            except json.JSONDecodeError:
                mode = {}
        return bool(mode.get("enabled", False)) if isinstance(mode, dict) else False

    @property
    def maintenance_message(self) -> Optional[str]:
        mode = self._get("maintenance_mode", {})
        if isinstance(mode, str):
            try:
                mode = json.loads(mode)
            except json.JSONDecodeError:
                mode = {}
        if not isinstance(mode, dict):
            return None
        return mode.get("message") or mode.get("estimated_recovery")

    @property
    def max_upload_size(self) -> int:
        return int(self._get("max_upload_size", 10 * 1024 * 1024))

    @property
    def allowed_file_types(self) -> List[str]:
        val = self._get("allowed_file_types", [".jpg", ".png", ".pdf", ".md"])
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except json.JSONDecodeError:
                val = []
        return list(val) if isinstance(val, list) else []

    @property
    def email_config(self) -> EmailConfig:
        val = self._get("email_config", {})
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except json.JSONDecodeError:
                val = {}
        if not isinstance(val, dict):
            val = {}
        return EmailConfig(**val)

    @property
    def email_enabled(self) -> bool:
        return self.email_config.is_configured

    @property
    def announcement(self) -> Dict[str, Any]:
        val = self._get("announcement", {})
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except json.JSONDecodeError:
                val = {}
        return val if isinstance(val, dict) else {}

    def feature_flags(self) -> Dict[str, bool]:
        val = self._get("feature_flags", {})
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except json.JSONDecodeError:
                val = {}
        return val if isinstance(val, dict) else {}

    def is_feature_enabled(self, key: str, default: bool = False) -> bool:
        return bool(self.feature_flags().get(key, default))

    def module_enabled(self, module_key: str) -> bool:
        """Check whether a top-level module is enabled.

        Module keys are stored as feature flags like `module_pipeline_enabled`.
        """
        flag_key = f"module_{module_key}_enabled"
        return self.is_feature_enabled(flag_key, default=True)


# In-memory cache with TTL
_cache_lock = threading.RLock()
_cached_snapshot: Optional[SystemConfigSnapshot] = None
_cache_loaded_at: Optional[float] = None
_CACHE_TTL_SECONDS = 30  # short TTL so admin changes propagate quickly


def _load_raw(db: Session) -> Dict[str, Any]:
    configs = db.query(SysConfigModel).all()
    result: Dict[str, Any] = {}
    for c in configs:
        try:
            result[c.key] = json.loads(c.value_json)
        except (json.JSONDecodeError, TypeError):
            result[c.key] = c.value_json
    return result


def get_system_config(db: Session, force_refresh: bool = False) -> SystemConfigSnapshot:
    """Get a cached snapshot of system configuration.

    The cache is refreshed automatically every `_CACHE_TTL_SECONDS` or when
    `force_refresh=True`.
    """
    global _cached_snapshot, _cache_loaded_at

    now = time.time()
    with _cache_lock:
        if (
            not force_refresh
            and _cached_snapshot is not None
            and _cache_loaded_at is not None
            and (now - _cache_loaded_at) < _CACHE_TTL_SECONDS
        ):
            return _cached_snapshot

        raw = _load_raw(db)
        _cached_snapshot = SystemConfigSnapshot(raw)
        _cache_loaded_at = now
        return _cached_snapshot


def invalidate_system_config_cache():
    """Invalidate the in-memory config cache.

    Admin endpoints should call this after updating system_configs.
    """
    global _cached_snapshot, _cache_loaded_at
    with _cache_lock:
        _cached_snapshot = None
        _cache_loaded_at = None
