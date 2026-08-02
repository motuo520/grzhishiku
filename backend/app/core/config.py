import os
from pydantic_settings import BaseSettings
from functools import lru_cache
import secrets
import warnings

class Settings(BaseSettings):
    APP_NAME: str = "Qianji"
    DEBUG: bool = False
    
    # Environment
    ENV: str = "development"
    
    # Database
    DATABASE_URL: str = "sqlite:///./psb.db"
    # 为空时自动生成并持久化到数据目录 .secrets/（见文件末尾兜底逻辑）。
    DATABASE_ENCRYPT_KEY: str = ""
    
    # Security
    # 为空时自动生成并持久化到数据目录 .secrets/；生产环境建议显式设置。
    SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"
    
    # Admin
    ADMIN_SECRET_KEY: str = ""
    ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours
    
    # MCP server（SSE，挂载在 /api/v1/mcp，需用户 JWT）；默认关闭
    MCP_ENABLED: bool = False

    # Local LLM
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:0.5b"
    OLLAMA_FALLBACK_MODEL: str = "qwen2.5:0.5b"
    # 图谱构建（graphify）专用模型：空则回退 OLLAMA_MODEL。
    # 0.5B 模型无法稳定输出提取 JSON，建议 qwen2.5-coder:7b 或 qwen2.5:3b。
    GRAPHIFY_OLLAMA_MODEL: str = ""

    # Model routing configs
    DEFAULT_TEMPERATURE: float = 0.7
    MAX_TOKENS_DEFAULT: int = 2048
    MAX_TOKENS_LONG: int = 8192

    # Embeddings
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    EMBEDDING_DIMENSION: int = 768
    EMBEDDING_FALLBACK_DIMENSION: int = 768

    
    # URLs
    API_BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"
    
    # LLM Model Configuration
    OLLAMA_DEFAULT_MODEL: str = "qwen2.5:0.5b"
    OLLAMA_QWEN_MODEL: str = "qwen2.5:0.5b"

    # Summary Cache
    SUMMARY_CACHE_ENABLED: bool = True

    # Netdisk integrations
    BAIDU_NETDISK_CLIENT_ID: str = ""
    BAIDU_NETDISK_CLIENT_SECRET: str = ""
    BAIDU_NETDISK_REDIRECT_URI: str = ""
    ALIYUN_NETDISK_CLIENT_ID: str = ""
    ALIYUN_NETDISK_CLIENT_SECRET: str = ""
    ALIYUN_NETDISK_REDIRECT_URI: str = ""

    # Object storage (S3-compatible, e.g. MinIO)
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "psbminio"
    S3_SECRET_KEY: str = "psbminio-secret"
    S3_BUCKET: str = "psb-sync"
    S3_REGION: str = "us-east-1"
    S3_USE_SSL: bool = False
    S3_PATH_STYLE: bool = True

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # SPA hosting: directory of the built frontend (Vite dist). When set and
    # the directory exists, the API server also serves the SPA at "/" with
    # index.html fallback — the frontend then loads everything same-origin.
    SERVE_FRONTEND_DIR: str = ""

    # 上传体积上限（MB），超出返回 413
    MAX_UPLOAD_MB: int = 100
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        # 忽略 .env 中历史遗留的未知键（如已下线的云厂商/支付配置）
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()


def _data_dir_from_database_url(url: str) -> str:
    """从 DATABASE_URL 推导数据目录。

    sqlite:////data/psb.db → /data；sqlite:///./psb.db → 当前目录。
    非 sqlite 或无法解析时回退为当前目录。
    """
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return "."
    path = url[len(prefix):]
    if not path or path == ":memory:":
        return "."
    return os.path.dirname(path) or "."


def _load_or_create_secret(name: str) -> str:
    """从数据目录 .secrets/<name> 读取密钥；文件不存在则生成并写入（权限 0o600）。

    文件读写异常时回退为纯临时密钥并打 warning。
    """
    secrets_dir = os.path.join(_data_dir_from_database_url(settings.DATABASE_URL), ".secrets")
    secret_path = os.path.join(secrets_dir, name)
    try:
        if os.path.isfile(secret_path):
            with open(secret_path, "r", encoding="utf-8") as f:
                value = f.read().strip()
            if value:
                return value
        value = secrets.token_urlsafe(32)
        os.makedirs(secrets_dir, exist_ok=True)
        fd = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(value + "\n")
        return value
    except OSError as exc:
        warnings.warn(
            f"{name} could not be read from or persisted to {secret_path} ({exc}); "
            "using an ephemeral key for this run.",
            RuntimeWarning,
            stacklevel=2,
        )
        return secrets.token_urlsafe(32)


# 密钥兜底：环境变量/配置优先；为空时从数据目录 .secrets/ 读取，不存在则自动生成
# 并持久化，保证 docker compose up -d 一条命令可用且重启后密钥不丢失。
# 开发/生产同一套逻辑；生产环境未显式配置密钥时不再拒绝启动，只打 warning。
_auto_secrets = [
    name
    for name in ("SECRET_KEY", "ADMIN_SECRET_KEY", "DATABASE_ENCRYPT_KEY")
    if not getattr(settings, name)
]
for _name in _auto_secrets:
    setattr(settings, _name, _load_or_create_secret(_name))
if _auto_secrets:
    warnings.warn(
        "The following secrets were not configured; random keys have been "
        "auto-generated and persisted under the data directory's .secrets/ "
        f"subdirectory: {', '.join(_auto_secrets)}. "
        "Set them explicitly via environment variables to take full control.",
        RuntimeWarning,
        stacklevel=2,
    )
