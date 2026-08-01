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

class StaticFilesCacheMiddleware(BaseHTTPMiddleware):
    """Add cache-control headers to static files.

    /assets/ 与 /uploads/ 的文件名带内容哈希，可永久缓存；
    HTML（含 SPA 回退页）必须每次向服务器校验，否则部署后浏览器里的旧
    index.html 会引用已删除的 chunk 文件，整站白屏打不开。
    """
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/uploads/") or path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif "text/html" in response.headers.get("content-type", ""):
            response.headers["Cache-Control"] = "no-cache"
        return response

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    Base.metadata.create_all(bind=engine)

    # 游客演示模式：为演示账号铸长效 token（账号不存在时自动关闭）
    from app.core.guest_demo import init_guest_demo_token
    init_guest_demo_token(app)

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
                ("announcement", '{"title": "", "content": ""}'),
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

    # Load and initialize plugins, then mount the MCP SSE server
    from app.mcp.server import mcp, mount_mcp
    from app.plugins.manager import plugin_manager
    plugin_manager.load_all()
    plugin_manager.initialize(app, mcp)
    mount_mcp(app)

    # Initialize background scheduler for plugin auto-sync
    from app.services.plugin_scheduler import initialize_scheduler
    await initialize_scheduler()

    yield
    # Shutdown
    from app.services.plugin_scheduler import shutdown_scheduler
    await shutdown_scheduler()

app = FastAPI(
    title="Wenmo API",
    description="AI-enhanced personal knowledge management system",
    version="0.1.0",
    lifespan=lifespan,
)

register_exception_handlers(app)

# SPA hosting: when SERVE_FRONTEND_DIR points to an existing Vite dist, the API
# server also hosts the SPA at "/" (mounted last, after API routes) and the
# JSON root route is skipped so "/" serves index.html.
_serve_frontend_dir = (
    settings.SERVE_FRONTEND_DIR
    if settings.SERVE_FRONTEND_DIR and os.path.isdir(settings.SERVE_FRONTEND_DIR)
    else None
)

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
from app.core.guest_demo import GuestDemoMiddleware, init_guest_demo_token

app.add_middleware(SecurityMiddleware)
app.add_middleware(GuestDemoMiddleware)
app.add_middleware(MaintenanceMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(StaticFilesCacheMiddleware)

# TrustedHostMiddleware: restrict allowed hosts in production
if settings.ENV == "production":
    _allowed_hosts = ["localhost", "127.0.0.1", "*.localhost"]
    _api_host = settings.API_BASE_URL.replace("https://", "").replace("http://", "").split(":")[0]
    if _api_host and _api_host not in _allowed_hosts:
        _allowed_hosts.append(_api_host)
    # 同时允许前端域名和 CORS 来源域名（支持反向代理/多域名访问）
    _frontend_host = settings.FRONTEND_URL.replace("https://", "").replace("http://", "").split(":")[0]
    if _frontend_host and _frontend_host not in _allowed_hosts:
        _allowed_hosts.append(_frontend_host)
    for origin in settings.ALLOWED_ORIGINS.split(","):
        host = origin.replace("https://", "").replace("http://", "").split(":")[0]
        if host and host not in _allowed_hosts:
            _allowed_hosts.append(host)
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


if not _serve_frontend_dir:
    @app.get("/", tags=["Health"])
    async def root():
        return {"message": "Wenmo API", "version": "0.1.0"}

@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "timestamp": time.time()}

@app.get("/metrics", tags=["Monitoring"], include_in_schema=False)
async def metrics():
    return get_metrics()


class SPAStaticFiles(StaticFiles):
    """StaticFiles with index.html fallback for SPA client-side routing."""

    async def get_response(self, path: str, scope):
        from starlette.exceptions import HTTPException as StarletteHTTPException
        from starlette.responses import JSONResponse

        # 未匹配的 /api 路径一律返回 JSON 404，绝不能回退成 index.html——
        # 否则前端拿到的"数据"是 HTML 字符串，在调用方手里炸成莫名错误
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


# SPA hosting: serve the built SPA from "/". Mounted last so API routes,
# /uploads and /health always win.
if _serve_frontend_dir:
    app.mount("/", SPAStaticFiles(directory=_serve_frontend_dir, html=True), name="spa")
