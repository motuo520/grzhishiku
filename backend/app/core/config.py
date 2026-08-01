from pydantic_settings import BaseSettings
from pydantic import model_validator
from functools import lru_cache
import secrets
import warnings

class Settings(BaseSettings):
    APP_NAME: str = "Wenmo"
    DEBUG: bool = True
    
    # Environment
    ENV: str = "development"
    
    # Database
    DATABASE_URL: str = "sqlite:///./psb.db"
    # 生产环境必须设置强密钥；开发环境若为空则跳过数据库加密层。
    DATABASE_ENCRYPT_KEY: str = ""
    
    # Security
    # 生产环境必须设置强随机密钥；开发环境为空时使用临时密钥并发出警告。
    SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"
    
    # Admin
    ADMIN_SECRET_KEY: str = ""
    ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # 游客演示模式：未登录的只读请求注入该账号的演示数据
    GUEST_DEMO_ENABLED: bool = True
    GUEST_DEMO_EMAIL: str = "demo@wenmo.local"
    
    # Local LLM
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:0.5b"
    OLLAMA_FALLBACK_MODEL: str = "qwen2.5:0.5b"

    # Model routing configs
    DEFAULT_TEMPERATURE: float = 0.7
    MAX_TOKENS_DEFAULT: int = 2048
    MAX_TOKENS_LONG: int = 8192

    # Embeddings
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    CHROMADB_PERSIST_DIR: str = "./chroma_db"
    EMBEDDING_DIMENSION: int = 896
    EMBEDDING_FALLBACK_DIMENSION: int = 896

    
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
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        # 忽略 .env 中历史遗留的未知键（如已下线的云厂商/支付配置）
        extra = "ignore"
    
    @model_validator(mode='after')
    def validate_production(self):
        if self.ENV == "production":
            if not self.SECRET_KEY:
                raise ValueError("SECRET_KEY must be set in production")
            if not self.ADMIN_SECRET_KEY:
                raise ValueError("ADMIN_SECRET_KEY must be set in production")
            if not self.DATABASE_ENCRYPT_KEY:
                raise ValueError("DATABASE_ENCRYPT_KEY must be set in production")
        return self

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()

# Development safety net: if secrets are left empty, generate ephemeral keys and
# warn loudly. Production must set real keys before startup.
if settings.ENV != "production":
    if not settings.SECRET_KEY:
        warnings.warn(
            "SECRET_KEY is empty in development; using an ephemeral key. "
            "Set a strong SECRET_KEY before deploying to production.",
            RuntimeWarning,
            stacklevel=2,
        )
        settings.SECRET_KEY = secrets.token_urlsafe(32)
    if not settings.ADMIN_SECRET_KEY:
        warnings.warn(
            "ADMIN_SECRET_KEY is empty in development; using an ephemeral key. "
            "Set a strong ADMIN_SECRET_KEY before deploying to production.",
            RuntimeWarning,
            stacklevel=2,
        )
        settings.ADMIN_SECRET_KEY = secrets.token_urlsafe(32)
    if not settings.DATABASE_ENCRYPT_KEY:
        warnings.warn(
            "DATABASE_ENCRYPT_KEY is empty; database encryption is disabled. "
            "Set a strong key before deploying to production.",
            RuntimeWarning,
            stacklevel=2,
        )
