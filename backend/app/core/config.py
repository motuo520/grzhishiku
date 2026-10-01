from pydantic_settings import BaseSettings
from pydantic import model_validator
from functools import lru_cache
import os
import secrets
import warnings

class Settings(BaseSettings):
    APP_NAME: str = "Molore"
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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 天（免频繁重登）
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"
    
    # Admin
    ADMIN_SECRET_KEY: str = ""
    ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours

    # MCP server（SSE，挂载在 /api/v1/mcp，需用户 JWT）；默认关闭
    MCP_ENABLED: bool = False

    # 可信反向代理 IP 集合；命中时才解析 X-Forwarded-For 做真实客户端限流
    TRUSTED_PROXY_IPS: set = set()

    # Content-Security-Policy 响应头开关（应急逃生用；策略串见 security_middleware.py）
    CSP_ENABLED: bool = True
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # 游客演示模式：未登录的只读请求注入该账号的演示数据
    GUEST_DEMO_ENABLED: bool = True
    GUEST_DEMO_EMAIL: str = "demo@wenmo.local"
    
    # Local LLM
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen3.5:0.8b"
    OLLAMA_FALLBACK_MODEL: str = "qwen3.5:0.8b"
    
    # Model routing configs
    DEFAULT_TEMPERATURE: float = 0.7
    MAX_TOKENS_DEFAULT: int = 2048
    MAX_TOKENS_LONG: int = 8192
    
    # Provider-specific endpoints (allow override)
    # 仅保留 DeepSeek / Kimi / OpenCode 三家云厂商；OpenCode 为 OpenAI 兼容聚合接口，
    # 负责 GLM / MiMo / MiniMax / Qwen 等模型。
    KIMI_BASE_URL: str = "https://api.moonshot.cn"
    GLM_BASE_URL: str = "https://open.bigmodel.cn/api/paas/v4"
    # 联网搜索（agent web_search 工具，智谱内置 web_search，与 agent 大脑解耦固定走
    # 平台 GLM key 按次计费）：search_pro=付费引擎按次（质量高），search_std=免费档
    GLM_SEARCH_MODEL: str = "glm-4.5-flash"
    GLM_SEARCH_ENGINE: str = "search_pro"
    DASHSCOPE_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com/v1"
    GOOGLE_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    OPENCODE_BASE_URL: str = "https://opencode.ai/zen"

    # API Keys
    DEEPSEEK_API_KEY: str = ""
    KIMI_API_KEY: str = ""
    OPENCODE_API_KEY: str = ""
    GLM_API_KEY: str = ""
    DASHSCOPE_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    
    # Embeddings
    # 默认用专用嵌入模型（桌面 onboarding 会引导拉取）；qwen3.5:0.8b 是聊天模型，
    # Ollama 未以 --embeddings 启动时对它会直接 500，向量通道静默退 mock。
    # 08-28 换代 bge-m3（中文语义分离度 margin 0.001→0.106 实测碾压 nomic）；
    # 未安装时 embedding_service 启动探测自动降级旧版嵌入模型过渡。
    OLLAMA_EMBED_MODEL: str = "bge-m3"
    CHROMADB_PERSIST_DIR: str = "./chroma_db"
    EMBEDDING_DIMENSION: int = 896
    EMBEDDING_FALLBACK_DIMENSION: int = 896

    # RAG 数字 grounding 校验（09-11 立项）：回答关键数字/编号必须在当轮检索资料
    # content_raw 找得到；未命中收紧 prompt 重答一次，仍不收敛末尾追加警示标注。
    # 血泪#24：新配置项必须在此声明，否则被 model_dump 静默丢
    RAG_GROUNDING_CHECK: bool = True

    # RAG 推测标注（09-17 P2-3）：模型自认「通用知识」段/未落地数字所在句，
    # 流末追加「未在库内资料找到直接证据」标注（纯规则零模型，标注随正文落库）。
    RAG_SPECULATION_CHECK: bool = True

    # 文档 OCR（扫描件兜底：文字层优先，缺文字页后台线程 OCR）
    # 血泪#24：新配置项必须在此声明，否则被 model_dump 静默丢
    # pymupdf / rapidocr-onnxruntime 为可选依赖，缺失时降级只抽文字层
    DOCUMENT_OCR_ENABLED: bool = True
    DOCUMENT_OCR_MAX_PAGES: int = 50  # 单文档超出部分跳过 + warning（小机保命）
    DOCUMENT_OCR_DPI: int = 200  # fitz 渲染分辨率，越高越准越吃内存
    DOCUMENT_OCR_MIN_PAGE_CHARS: int = 10  # 一页文字少于此数判定缺文字层
    # Docling 文档解析实验后端（spike，默认关）：docling=启用（依赖不随
    # requirements 安装，torch 一家磁盘 ~1.5GB、转换峰值内存 GB 级，
    # 云端小机/桌面 sidecar 勿开）；auto=现链（pypdf 文字层 + RapidOCR 兜底）
    DOC_PARSER_BACKEND: str = "auto"

    
    # URLs
    API_BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:3000"
    
    # LLM Model Configuration
    OLLAMA_DEFAULT_MODEL: str = "qwen3.5:0.8b"
    OLLAMA_QWEN_MODEL: str = "qwen3.5:0.8b"
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
    
    # Object storage (S3-compatible, e.g. MinIO)
    # 凭证默认置空：本地/自托管经 .env 或 docker-compose 显式注入（见 .env.example）。
    # 注意：桌面 frozen 端同样以 ENV=production 运行且不配置 S3（云端同步走
    # 服务端 MinIO，本地无消费者），故生产校验只告警不强制——强制会让桌面端
    # 启动即崩（0.2.53 冒烟实测）。
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_BUCKET: str = "psb-sync"
    S3_REGION: str = "us-east-1"
    S3_USE_SSL: bool = False
    S3_PATH_STYLE: bool = True

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Desktop mode: directory of the built frontend (Vite dist). When set and
    # the directory exists, the API server also serves the SPA at "/" with
    # index.html fallback — the desktop app then loads everything same-origin.
    SERVE_FRONTEND_DIR: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = True

    @model_validator(mode="after")
    def _enforce_production_debug(self):
        env = str(self.ENV or "").strip().lower()
        if env in {"production", "prod"} and self.DEBUG:
            warnings.warn("DEBUG is forcibly disabled in production environment")
            self.DEBUG = False
        return self

    @model_validator(mode='after')
    def validate_production(self):
        if self.ENV == "production":
            if not self.SECRET_KEY:
                raise ValueError("SECRET_KEY must be set in production")
            if not self.ADMIN_SECRET_KEY:
                raise ValueError("ADMIN_SECRET_KEY must be set in production")
            if not self.DATABASE_ENCRYPT_KEY:
                raise ValueError("DATABASE_ENCRYPT_KEY must be set in production")
            if not self.S3_ACCESS_KEY or not self.S3_SECRET_KEY:
                # 桌面 frozen 端无 S3 配置是正常形态（本地无消费者），只告警；
                # 云端若真启用对象存储，缺失凭证会在使用处显式失败
                warnings.warn("S3 credentials are not set in production; object storage features will fail if used")
        return self

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()

# 密钥兜底：环境变量/配置优先；为空时从数据目录 .secrets/ 读取，不存在则自动生成
# 并持久化，保证 docker compose up -d 一条命令可用且重启后密钥不丢失。
# 开发/生产同一套逻辑；生产环境未显式配置密钥时不再拒绝启动，只打 warning。
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
