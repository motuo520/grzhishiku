from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from datetime import datetime
import shutil
import platform
import time
import json
import uuid

from app.core.database import get_db, engine
from app.core.config_loader import invalidate_system_config_cache
from app.core.admin_permissions import Permission, require_permission
from app.models.base import AdminUser, SystemConfig as SysConfigModel
from app.api.admin.endpoints.auth import get_current_admin
from app.services.email_sender import EmailConfig
from app.services.payment_providers.factory import init_payment_factory

router = APIRouter()

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False


class DatabaseHealth(BaseModel):
    status: str
    latencyMs: float


class DiskHealth(BaseModel):
    total: int
    used: int
    free: int
    percent: float


class MemoryHealth(BaseModel):
    total: int
    available: int
    percent: float


class OllamaHealth(BaseModel):
    running: bool
    latencyMs: Optional[float] = None
    models: Optional[int] = None


class SystemHealthResponse(BaseModel):
    database: DatabaseHealth
    disk: DiskHealth
    memory: MemoryHealth
    ollama: OllamaHealth
    uptime: Optional[float] = None
    pythonVersion: str
    fastapiVersion: str
    timestamp: str


class FeatureFlags(BaseModel):
    beta_features: bool = False
    ai_summary: bool = True
    web_clipper: bool = True
    public_sharing: bool = False


class FeatureFlagItem(BaseModel):
    key: str
    name: str
    description: str
    enabled: bool
    scope: str = "global"


class Announcement(BaseModel):
    title: str = ""
    content: str = ""
    effective_at: Optional[str] = None


class MaintenanceMode(BaseModel):
    enabled: bool = False
    estimated_recovery: Optional[str] = None
    resume_at: Optional[str] = None  # alias for frontend compatibility


class PaymentProviderConfig(BaseModel):
    enabled: bool = False
    # Alipay
    app_id: str = ""
    private_key: str = ""
    public_key: str = ""
    sandbox: bool = True
    # WeChat
    mchid: str = ""
    appid: str = ""
    api_key: str = ""
    cert_serial_no: str = ""
    cert_private_key: str = ""
    # Stripe
    secret_key: str = ""
    webhook_secret: str = ""
    # Xorpay
    aid: str = ""
    app_secret: str = ""


class PaymentConfig(BaseModel):
    alipay: PaymentProviderConfig = Field(default_factory=PaymentProviderConfig)
    wechat: PaymentProviderConfig = Field(default_factory=PaymentProviderConfig)
    stripe: PaymentProviderConfig = Field(default_factory=PaymentProviderConfig)
    xorpay: PaymentProviderConfig = Field(default_factory=PaymentProviderConfig)


class SystemConfigUpdate(BaseModel):
    feature_flags: Optional[Any] = None
    announcement: Optional[Announcement] = None
    maintenance_mode: Optional[MaintenanceMode] = None
    registration_open: Optional[bool] = None
    max_upload_size: Optional[int] = None
    allowed_file_types: Optional[list] = None
    default_llm_provider: Optional[str] = None
    enable_signup_bonus: Optional[bool] = None
    email_config: Optional[EmailConfig] = None
    payment_config: Optional[PaymentConfig] = None


class SystemConfig(BaseModel):
    feature_flags: List[FeatureFlagItem] = Field(default_factory=list)
    announcement: Announcement = Field(default_factory=Announcement)
    maintenance_mode: MaintenanceMode = Field(default_factory=MaintenanceMode)
    registration_open: bool = True
    max_upload_size: int = 10 * 1024 * 1024
    allowed_file_types: list = [".jpg", ".png", ".pdf", ".md"]
    default_llm_provider: str = "ollama"
    enable_signup_bonus: bool = False
    default_plan: str = "free"
    email_config: EmailConfig = Field(default_factory=EmailConfig)
    payment_config: PaymentConfig = Field(default_factory=PaymentConfig)


def _load_config_from_db(db: Session) -> Dict[str, Any]:
    """Load all system configs from database into a dict."""
    configs = db.query(SysConfigModel).all()
    result = {}
    for c in configs:
        try:
            result[c.key] = json.loads(c.value_json)
        except json.JSONDecodeError:
            result[c.key] = c.value_json
    return result


def get_system_config(db: Session) -> SystemConfig:
    """Get system config from DB (with cache)."""
    global _cached_config, _cache_loaded_at
    raw = _load_config_from_db(db)
    _cached_config = raw
    _cache_loaded_at = time.time()

    def get(key, default):
        val = raw.get(key)
        if val is None:
            return default
        if isinstance(val, str) and val.lower() in ("true", "false"):
            return val.lower() == "true"
        return val

    feature_flags_raw = raw.get("feature_flags", {})
    if isinstance(feature_flags_raw, str):
        try:
            feature_flags_raw = json.loads(feature_flags_raw)
        except json.JSONDecodeError:
            feature_flags_raw = {}

    # Build feature flags array for frontend
    feature_flag_items = []
    flag_definitions = {
        "beta_features": ("Beta 功能", "启用实验性功能", "global"),
        "ai_summary": ("AI 摘要", "自动生成内容摘要", "global"),
        "web_clipper": ("网页剪藏", "浏览器扩展剪藏功能", "global"),
        "public_sharing": ("公开分享", "允许用户公开分享内容", "global"),
        "module_pipeline_enabled": ("认知生产管线", "显示并启用认知生产管线模块", "module"),
        "module_social_brain_enabled": ("社会大脑", "显示并启用社会大脑模块", "module"),
        "module_embodied_cognition_enabled": ("具身认知", "显示并启用具身认知模块", "module"),
        "module_cognitive_enabled": ("认知镜像", "显示并启用认知镜像模块", "module"),
        "module_emergence_enabled": ("涌现工作室", "显示并启用涌现工作室模块", "module"),
        "module_plugins_enabled": ("插件系统", "显示并启用插件系统", "module"),
    }
    for key, (name, desc, scope) in flag_definitions.items():
        feature_flag_items.append(FeatureFlagItem(
            key=key,
            name=name,
            description=desc,
            enabled=feature_flags_raw.get(key, False) if isinstance(feature_flags_raw, dict) else False,
            scope=scope,
        ))

    announcement = raw.get("announcement", {})
    if isinstance(announcement, str):
        try:
            announcement = json.loads(announcement)
        except json.JSONDecodeError:
            announcement = {}

    maintenance = raw.get("maintenance_mode", {})
    if isinstance(maintenance, str):
        try:
            maintenance = json.loads(maintenance)
        except json.JSONDecodeError:
            maintenance = {}

    maintenance_mode = MaintenanceMode(**{**MaintenanceMode().dict(), **maintenance})
    if maintenance_mode.estimated_recovery and not maintenance_mode.resume_at:
        maintenance_mode.resume_at = maintenance_mode.estimated_recovery

    payment_raw = raw.get("payment_config", {})
    if isinstance(payment_raw, str):
        try:
            payment_raw = json.loads(payment_raw)
        except json.JSONDecodeError:
            payment_raw = {}
    if not isinstance(payment_raw, dict):
        payment_raw = {}

    return SystemConfig(
        feature_flags=feature_flag_items,
        announcement=Announcement(**{**Announcement().dict(), **announcement}),
        maintenance_mode=maintenance_mode,
        registration_open=get("registration_open", True),
        max_upload_size=get("max_upload_size", 10 * 1024 * 1024),
        allowed_file_types=get("allowed_file_types", [".jpg", ".png", ".pdf", ".md"]),
        default_llm_provider=get("default_llm_provider", "ollama"),
        enable_signup_bonus=get("enable_signup_bonus", False),
        default_plan=get("default_plan", "free"),
        email_config=EmailConfig(**raw.get("email_config", {})) if isinstance(raw.get("email_config"), dict) else EmailConfig(),
        payment_config=PaymentConfig(**payment_raw) if isinstance(payment_raw, dict) else PaymentConfig(),
    )


def _set_config(db: Session, key: str, value: Any, updated_by: str):
    """Set or update a single config key in DB."""
    record = db.query(SysConfigModel).filter(SysConfigModel.key == key).first()
    val_str = json.dumps(value, default=str) if not isinstance(value, str) else value
    if record:
        record.value_json = val_str
        record.updated_by = updated_by
        record.updated_at = datetime.utcnow()
    else:
        record = SysConfigModel(
            id=str(uuid.uuid4()),
            key=key,
            value_json=val_str,
            updated_by=updated_by,
        )
        db.add(record)
    db.commit()


def invalidate_config_cache():
    """Invalidate in-memory config cache."""
    global _cache_loaded_at
    _cache_loaded_at = None
    invalidate_system_config_cache()


@router.get("/health", response_model=SystemHealthResponse, summary="System health", description="Get system health status including DB, disk, memory, Ollama.")
async def get_system_health(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SYSTEM_CONFIG))
):
    now = datetime.utcnow()

    # Database health
    db_status = "connected"
    db_latency = 0.0
    try:
        start = time.perf_counter()
        db.execute(text("SELECT 1"))
        db.commit()
        db_latency = (time.perf_counter() - start) * 1000
    except Exception:
        db_status = "disconnected"
        db_latency = 0.0

    # Disk health
    try:
        disk = shutil.disk_usage('/')
        disk_total = disk.total
        disk_used = disk.used
        disk_free = disk.free
        disk_percent = (disk_used / disk_total * 100) if disk_total > 0 else 0.0
    except Exception:
        disk_total = 0
        disk_used = 0
        disk_free = 0
        disk_percent = 0.0

    # Memory health
    if PSUTIL_AVAILABLE:
        try:
            mem = psutil.virtual_memory()
            mem_total = mem.total
            mem_available = mem.available
            mem_percent = mem.percent
        except Exception:
            mem_total = 0
            mem_available = 0
            mem_percent = 0.0
    else:
        mem_total = 16 * 1024 * 1024 * 1024
        mem_available = 8 * 1024 * 1024 * 1024
        mem_percent = 50.0

    # Ollama health
    ollama_running = False
    ollama_latency = None
    ollama_models = None
    try:
        import httpx
        ollama_url = "http://localhost:11434/api/tags"
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(ollama_url)
            ollama_latency = (time.perf_counter() - start) * 1000
            if resp.status_code == 200:
                ollama_running = True
                data = resp.json()
                ollama_models = len(data.get("models", []))
    except Exception:
        ollama_running = False
        ollama_latency = None

    # Uptime (process)
    process_uptime = None
    if PSUTIL_AVAILABLE:
        try:
            proc = psutil.Process()
            process_uptime = round(time.time() - proc.create_time())
        except Exception:
            pass

    # Versions
    import fastapi
    fastapi_version = fastapi.__version__

    return SystemHealthResponse(
        database=DatabaseHealth(
            status=db_status,
            latencyMs=round(db_latency, 2)
        ),
        disk=DiskHealth(
            total=disk_total,
            used=disk_used,
            free=disk_free,
            percent=round(disk_percent, 1)
        ),
        memory=MemoryHealth(
            total=mem_total,
            available=mem_available,
            percent=round(mem_percent, 1)
        ),
        ollama=OllamaHealth(
            running=ollama_running,
            latencyMs=round(ollama_latency, 2) if ollama_latency else None,
            models=ollama_models
        ),
        uptime=process_uptime,
        pythonVersion=platform.python_version(),
        fastapiVersion=fastapi_version,
        timestamp=now.isoformat()
    )


@router.get("/config", response_model=SystemConfig, summary="Get system config", description="Get current system configuration from database.")
async def get_system_config_api(
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SYSTEM_CONFIG))
):
    return get_system_config(db)


@router.put("/config", summary="Update system config", description="Update system configuration (partial update, merges with existing).")
async def update_system_config(
    data: SystemConfigUpdate,
    db: Session = Depends(get_db),
    current_admin: AdminUser = Depends(require_permission(Permission.SYSTEM_CONFIG))
):
    updates = data.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    for key, value in updates.items():
        # Convert feature_flags array to object if needed
        if key == "feature_flags" and isinstance(value, list):
            obj = {}
            for item in value:
                if isinstance(item, dict) and "key" in item:
                    obj[item["key"]] = item.get("enabled", False)
            value = obj
        # Sync resume_at to estimated_recovery
        if key == "maintenance_mode" and isinstance(value, dict):
            if value.get("resume_at") and not value.get("estimated_recovery"):
                value["estimated_recovery"] = value["resume_at"]
        _set_config(db, key, value, current_admin.id)

    invalidate_config_cache()

    # Re-initialize payment factory when payment config changes so changes take effect immediately
    if "payment_config" in updates:
        from app.core.config_loader import get_system_config as _get_fresh_config
        from app.core.config import settings
        fresh_cfg = _get_fresh_config(db, force_refresh=True)
        payment_config = fresh_cfg.payment_config
        api_base = settings.API_BASE_URL
        frontend_base = settings.FRONTEND_URL
        defaults = {
            "alipay": {
                "sandbox": settings.ENV != "production",
                "notify_url": f"{api_base}/api/v1/billing/webhook/alipay",
                "return_url": f"{frontend_base}/payment/success",
            },
            "wechat": {
                "notify_url": f"{api_base}/api/v1/billing/webhook/wechat",
            },
            "stripe": {
                "success_url": f"{frontend_base}/payment/success",
                "cancel_url": f"{frontend_base}/payment",
            },
            "xorpay": {
                "notify_url": f"{api_base}/api/v1/billing/webhook/xorpay",
                "return_url": f"{frontend_base}/payment/success",
            },
        }
        for provider in list(payment_config.keys()):
            if provider in defaults:
                for k, v in defaults[provider].items():
                    payment_config[provider].setdefault(k, v)
        try:
            init_payment_factory(payment_config)
        except Exception:
            pass

    # Reload cache
    config = get_system_config(db)
    return {"message": "Configuration updated", "config": config.dict()}
