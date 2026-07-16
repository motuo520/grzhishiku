from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import time
import os
import uuid
import json
import logging
from logging.handlers import RotatingFileHandler

from app.api.v1.router import api_router as v1_router
from app.api.admin.router import admin_router
from app.core.config import settings
from app.core.database import engine, Base
from app.core.exceptions import register_exception_handlers
from app.core.metrics import get_metrics
from app.services.payment_providers.factory import init_payment_factory

class StaticFilesCacheMiddleware(BaseHTTPMiddleware):
    """Add cache-control headers to static files."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/uploads/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    Base.metadata.create_all(bind=engine)

    # Ensure FTS5 virtual table and sync triggers exist for knowledge search.
    # Base.metadata.create_all does not create VIRTUAL TABLEs or triggers.
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                content_raw,
                content='knowledge_units',
                content_rowid='rowid'
            )
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge_units BEGIN
                INSERT INTO knowledge_fts(rowid, content_raw) VALUES (new.rowid, new.content_raw);
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS knowledge_fts_update AFTER UPDATE ON knowledge_units BEGIN
                UPDATE knowledge_fts SET content_raw = new.content_raw WHERE rowid = new.rowid;
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge_units BEGIN
                DELETE FROM knowledge_fts WHERE rowid = old.rowid;
            END
        """))

    # Ensure verification_history column exists in knowledge_units
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if 'knowledge_units' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('knowledge_units')]
        if 'verification_history' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE knowledge_units ADD COLUMN verification_history TEXT DEFAULT '[]'"))
    
    # Ensure active_brain column exists in users table
    if 'users' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('users')]
        if 'active_brain' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN active_brain TEXT DEFAULT 'personal'"))
    
    # Ensure graph_edges columns exist
    if 'graph_edges' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('graph_edges')]
        with engine.begin() as conn:
            if 'weight' not in columns:
                conn.execute(text("ALTER TABLE graph_edges ADD COLUMN weight REAL DEFAULT 1.0"))
            if 'auto_created' not in columns:
                conn.execute(text("ALTER TABLE graph_edges ADD COLUMN auto_created INTEGER DEFAULT 0"))
    
    # Ensure satisfaction column exists in support_tickets
    if 'support_tickets' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('support_tickets')]
        if 'satisfaction' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE support_tickets ADD COLUMN satisfaction INTEGER"))

    # Ensure details column exists in admin_audit_logs
    if 'admin_audit_logs' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('admin_audit_logs')]
        if 'details' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE admin_audit_logs ADD COLUMN details TEXT"))

    # Ensure system_configs table exists and seed default configs
    if 'system_configs' not in inspector.get_table_names():
        from app.models.base import SystemConfig
        SystemConfig.__table__.create(bind=engine, checkfirst=True)
    else:
        columns = [c['name'] for c in inspector.get_columns('system_configs')]
        if 'updated_by' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE system_configs ADD COLUMN updated_by TEXT"))

    # Seed default system configs if empty
    from sqlalchemy import select
    from app.models.base import SystemConfig as SysConfigModel
    with engine.begin() as conn:
        result = conn.execute(select(SysConfigModel)).fetchall()
        if not result:
            defaults = [
                ("registration_open", "true"),
                ("maintenance_mode", '{"enabled": false}'),
                ("max_upload_size", str(10 * 1024 * 1024)),
                ("allowed_file_types", '[".jpg", ".png", ".pdf", ".md"]'),
                ("default_llm_provider", '"ollama"'),
                ("enable_signup_bonus", "true"),
                ("announcement", '{"title": "", "content": ""}'),
                ("default_plan", '"free"'),
                ("feature_flags", json.dumps({
                    "beta_features": False,
                    "ai_summary": True,
                    "web_clipper": True,
                    "public_sharing": False,
                    "module_pipeline_enabled": True,
                    "module_social_brain_enabled": True,
                    "module_embodied_cognition_enabled": True,
                    "module_cognitive_enabled": True,
                    "module_emergence_enabled": True,
                    "module_plugins_enabled": True,
                })),
            ]
            for key, val in defaults:
                conn.execute(text(
                    "INSERT INTO system_configs (id, key, value_json, updated_at) VALUES (:id, :key, :val, datetime('now'))"
                ), {"id": str(uuid.uuid4()), "key": key, "val": val})

    # Seed / update default subscription plans
    from app.models.billing import Plan
    from sqlalchemy import select as sa_select
    with engine.begin() as conn:
        from datetime import datetime as _dt
        now = _dt.utcnow()

        free_features = json.dumps({
            "ai_summary": True,
            "web_clipper": True,
            "public_sharing": False,
            "cloud_backup": False,
        })
        free_limits = json.dumps({
            "notes": 100,
            "clips_per_month": 50,
            "knowledge_units": 200,
            "documents": 20,
            "storage_bytes": 1073741824,
            "llm_calls_per_day": 50,
        })
        free_exists = conn.execute(sa_select(Plan).where(Plan.slug == 'free')).first()
        if free_exists:
            conn.execute(text("""
                UPDATE plans
                SET name='免费版', description='适合个人入门：笔记、剪藏、知识库与基础 AI 功能，零成本开启第二大脑。', price_monthly=0, price_yearly=0,
                    currency='CNY', billing_cycle='monthly', is_active=1, sort_order=0,
                    features=:features, limits=:limits, updated_at=:now
                WHERE slug='free'
            """), {"features": free_features, "limits": free_limits, "now": now})
        else:
            conn.execute(text("""
                INSERT INTO plans (id, name, slug, description, price_monthly, price_yearly, currency, billing_cycle, is_active, sort_order, features, limits, created_at, updated_at)
                VALUES (:id, '免费版', 'free', '适合个人入门：笔记、剪藏、知识库与基础 AI 功能，零成本开启第二大脑。', 0, 0, 'CNY', 'monthly', 1, 0, :features, :limits, :now, :now)
            """), {"id": str(uuid.uuid4()), "features": free_features, "limits": free_limits, "now": now})

        storage_features = json.dumps({
            "cloud_backup": True,
            "priority_support": True,
            "ai_summary": True,
            "web_clipper": True,
            "public_sharing": True,
        })
        storage_limits = json.dumps({
            "notes": -1,
            "clips_per_month": -1,
            "knowledge_units": -1,
            "documents": -1,
            "storage_bytes": 10737418240,
            "llm_calls_per_day": -1,
        })
        storage_exists = conn.execute(sa_select(Plan).where(Plan.slug == 'storage')).first()
        if storage_exists:
            conn.execute(text("""
                UPDATE plans
                SET name='存储会员', description='云端备份、更大额度与优先支持，为认真沉淀知识的你而设。',
                    price_monthly=990, price_yearly=9900, currency='CNY', billing_cycle='monthly',
                    is_active=1, sort_order=1, features=:features, limits=:limits, updated_at=:now
                WHERE slug='storage'
            """), {"features": storage_features, "limits": storage_limits, "now": now})
        else:
            conn.execute(text("""
                INSERT INTO plans (id, name, slug, description, price_monthly, price_yearly, currency, billing_cycle, is_active, sort_order, features, limits, created_at, updated_at)
                VALUES (:id, '存储会员', 'storage', '云端备份、更大额度与优先支持，为认真沉淀知识的你而设。', 990, 9900, 'CNY', 'monthly', 1, 1, :features, :limits, :now, :now)
            """), {"id": str(uuid.uuid4()), "features": storage_features, "limits": storage_limits, "now": now})

    # Load and initialize plugins, then mount the MCP SSE server
    from app.mcp.server import mcp, mount_mcp
    from app.plugins.manager import plugin_manager
    plugin_manager.load_all()
    plugin_manager.initialize(app, mcp)
    mount_mcp(app)

    # Initialize background scheduler for plugin auto-sync
    from app.services.plugin_scheduler import initialize_scheduler
    await initialize_scheduler()

    # Initialize billing scheduler for subscription expiry and auto-renewal
    from app.core.billing_scheduler import initialize_billing_scheduler
    await initialize_billing_scheduler()

    # 初始化支付工厂（从 system_configs 读取，支持后台动态配置）
    from app.core.config_loader import get_system_config
    from app.core.database import SessionLocal
    payment_config = {"alipay": {}, "wechat": {}, "stripe": {}, "xorpay": {}}
    try:
        with SessionLocal() as db:
            sys_cfg = get_system_config(db)
            payment_config = sys_cfg.payment_config
    except Exception:
        pass

    # 兜底/补全：若系统配置未设置 notify_url/return_url，使用环境变量默认值
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
    for provider in payment_config:
        if provider in defaults:
            for key, val in defaults[provider].items():
                payment_config[provider].setdefault(key, val)

    init_payment_factory(payment_config)
    yield
    # Shutdown
    from app.services.plugin_scheduler import shutdown_scheduler
    await shutdown_scheduler()

    from app.core.billing_scheduler import shutdown_billing_scheduler
    await shutdown_billing_scheduler()

app = FastAPI(
    title="Personal Second Brain API",
    description="AI-enhanced personal knowledge management system",
    version="0.1.0",
    lifespan=lifespan,
)

register_exception_handlers(app)

# Logging configuration: file rotation in production only to avoid Windows file locks during dev
log_handlers: list[logging.Handler] = [logging.StreamHandler()]
if settings.ENV == "production":
    os.makedirs("logs", exist_ok=True)
    log_handlers.append(
        RotatingFileHandler(
            "logs/app.log",
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding='utf-8',
        )
    )
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=log_handlers,
)
# SQLAlchemy engine logs at INFO are extremely verbose; keep them at WARNING
# unless explicitly debugging DB queries.
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.dialects").setLevel(logging.WARNING)

from app.core.security_middleware import SecurityMiddleware
from app.core.maintenance_middleware import MaintenanceMiddleware

app.add_middleware(SecurityMiddleware)
app.add_middleware(MaintenanceMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(StaticFilesCacheMiddleware)

# TrustedHostMiddleware: restrict allowed hosts in production
if settings.ENV == "production":
    _allowed_hosts = ["localhost", "127.0.0.1", "*.localhost"]
    _api_host = settings.API_BASE_URL.replace("https://", "").replace("http://", "").split(":")[0]
    if _api_host and _api_host not in _allowed_hosts:
        _allowed_hosts.append(_api_host)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts)

# CORS configuration: strict in production, permissive in development
if settings.ENV == "development":
    # Allow common Vite dev server ports so frontend reconnects work even when 3000 is taken
    _cors_origins = [
        f"http://{host}:{port}"
        for host in ("localhost", "127.0.0.1")
        for port in range(3000, 3051)
    ]
else:
    _cors_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
if not _cors_origins:
    _cors_origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-CSRF-Token"],
    max_age=600,
)

app.include_router(v1_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/admin")

# Static files for uploads
os.makedirs("uploads/avatars", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

class ClientErrorReport(BaseModel):
    message: str
    stack: str | None = None
    componentStack: str | None = Field(default=None, alias="componentStack")
    url: str = ""
    userAgent: str = Field(default="", alias="userAgent")
    timestamp: str = ""

    model_config = ConfigDict(populate_by_name=True)


@app.post("/api/v1/client-errors", tags=["Diagnostics"])
async def receive_client_error(report: ClientErrorReport):
    """Receive frontend error reports for diagnostics."""
    logger = logging.getLogger("client_errors")
    logger.warning(
        "Frontend error: %s | URL: %s | UA: %s | Time: %s",
        report.message,
        report.url,
        report.userAgent,
        report.timestamp,
    )
    if report.stack:
        logger.debug("Stack:\n%s", report.stack)
    if report.componentStack:
        logger.debug("Component stack:\n%s", report.componentStack)
    return {"received": True}


@app.get("/", tags=["Health"])
async def root():
    return {"message": "Personal Second Brain API", "version": "0.1.0"}

@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "timestamp": time.time()}

@app.get("/metrics", tags=["Monitoring"], include_in_schema=False)
async def metrics():
    return get_metrics()
