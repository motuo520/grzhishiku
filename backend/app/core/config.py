from pydantic_settings import BaseSettings
from pydantic import model_validator
from functools import lru_cache

class Settings(BaseSettings):
    APP_NAME: str = "Personal Second Brain"
    DEBUG: bool = True
    
    # Environment
    ENV: str = "development"
    
    # Database
    DATABASE_URL: str = "sqlite:///./psb.db"
    DATABASE_ENCRYPT_KEY: str = "REPLACE_DATABASE_ENCRYPT_KEY"
    
    # Security
    SECRET_KEY: str = "REPLACE_SECRET_KEY"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"
    
    # Admin
    ADMIN_SECRET_KEY: str = "admin-REPLACE_SECRET_KEY"
    ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # Local LLM
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:0.5b"
    OLLAMA_FALLBACK_MODEL: str = "qwen2.5:0.5b"
    
    # Model routing configs
    DEFAULT_TEMPERATURE: float = 0.7
    MAX_TOKENS_DEFAULT: int = 2048
    MAX_TOKENS_LONG: int = 8192
    
    # Provider-specific endpoints (allow override)
    # 仅保留 DeepSeek / Kimi / OpenCode 三家云厂商；OpenCode 为 OpenAI 兼容聚合接口，
    # 负责 GLM / MiMo / MiniMax / Qwen 等模型。
    KIMI_BASE_URL: str = "https://api.moonshot.cn"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    OPENCODE_BASE_URL: str = "https://api.opencode.ai"

    # API Keys
    DEEPSEEK_API_KEY: str = ""
    KIMI_API_KEY: str = ""
    OPENCODE_API_KEY: str = ""
    
    # Embeddings
    OLLAMA_EMBED_MODEL: str = "qwen2.5:0.5b"
    CHROMADB_PERSIST_DIR: str = "./chroma_db"
    EMBEDDING_DIMENSION: int = 896
    EMBEDDING_FALLBACK_DIMENSION: int = 896

    
    # URLs
    API_BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"
    
    # LLM Model Configuration
    OLLAMA_DEFAULT_MODEL: str = "qwen2.5:0.5b"
    OLLAMA_QWEN_MODEL: str = "qwen2.5:0.5b"
    KIMI_MODEL: str = "kimi-k2-7-code"
    DEEPSEEK_MODEL: str = "deepseek-v4-pro"
    
    # Summary Cache
    SUMMARY_CACHE_ENABLED: bool = True
    
    # Payment - Alipay
    ALIPAY_APP_ID: str = ""
    ALIPAY_PRIVATE_KEY: str = ""
    ALIPAY_PUBLIC_KEY: str = ""
    
    # Payment - WeChat
    WECHAT_MCHID: str = ""
    WECHAT_APPID: str = ""
    WECHAT_API_KEY: str = ""
    WECHAT_CERT_SERIAL: str = ""
    WECHAT_PRIVATE_KEY: str = ""
    
    # Payment - Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # Netdisk integrations
    BAIDU_NETDISK_CLIENT_ID: str = ""
    BAIDU_NETDISK_CLIENT_SECRET: str = ""
    BAIDU_NETDISK_REDIRECT_URI: str = ""
    ALIYUN_NETDISK_CLIENT_ID: str = ""
    ALIYUN_NETDISK_CLIENT_SECRET: str = ""
    ALIYUN_NETDISK_REDIRECT_URI: str = ""

    # 迅虎支付（虎皮椒）
    XUNHUPAY_APP_ID: str = ""
    XUNHUPAY_APP_SECRET: str = ""
    
    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Desktop mode: directory of the built frontend (Vite dist). When set and
    # the directory exists, the API server also serves the SPA at "/" with
    # index.html fallback — the desktop app then loads everything same-origin.
    SERVE_FRONTEND_DIR: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = True
    
    @model_validator(mode='after')
    def validate_production(self):
        if self.ENV == "production":
            if self.SECRET_KEY in ("REPLACE_SECRET_KEY", "REPLACE_SECRET_KEY", "changeme"):
                raise ValueError("SECRET_KEY must be changed in production")
            if self.ADMIN_SECRET_KEY in ("admin-REPLACE_SECRET_KEY", "REPLACE_ADMIN_SECRET_KEY", "adminchangeme"):
                raise ValueError("ADMIN_SECRET_KEY must be changed in production")
            if not self.DATABASE_ENCRYPT_KEY or self.DATABASE_ENCRYPT_KEY == "REPLACE_DATABASE_ENCRYPT_KEY":
                raise ValueError("DATABASE_ENCRYPT_KEY must be set in production")
        return self

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
