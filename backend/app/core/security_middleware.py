from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import time
from collections import defaultdict
from typing import Dict, List

# Content-Security-Policy：只对 document 生效，发在所有响应上无副作用。
# 前端已核实无 inline 脚本/eval/WebSocket/第三方 CDN；style 的 unsafe-inline
# 给 React 运行时 style 属性与预渲染正文用；img 的 data:/blob: 给 CSS 噪点背景
# 与头像预览（URL.createObjectURL）用。
CSP_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "media-src 'self' blob:; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; frame-ancestors 'none'; manifest-src 'self'"
)

class RateLimiter:
    """Simple in-memory rate limiter with per-endpoint support."""
    
    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)
        self._last_cleanup = time.time()

    def _cleanup_stale_keys(self, now: float) -> None:
        if now - self._last_cleanup < self.window_seconds:
            return
        for key in list(self.requests.keys()):
            self.requests[key] = [
                t for t in self.requests[key]
                if now - t < self.window_seconds
            ]
            if not self.requests[key]:
                del self.requests[key]
        self._last_cleanup = now

    def is_allowed(self, key: str) -> bool:
        now = time.time()
        self._cleanup_stale_keys(now)
        # Clean old requests
        self.requests[key] = [
            t for t in self.requests[key]
            if now - t < self.window_seconds
        ]
        
        if len(self.requests[key]) >= self.max_requests:
            return False
        
        self.requests[key].append(now)
        return True

from app.core.config import settings


def _get_client_ip(request: Request) -> str:
    """在显式配置了可信代理时才解析 X-Forwarded-For，避免任意客户端伪造头部绕过限流。

    取末段而非首段：XFF 链是「客户端伪造段, ..., 可信代理追加的真实来源」，
    末段是最靠近可信代理的一跳、由可信代理写入，客户端无法伪造；
    首段可被客户端任意填写，取首段等于让攻击者自选限流 key。
    """
    ip = request.client.host if request.client else "unknown"
    trusted_proxies = getattr(settings, "TRUSTED_PROXY_IPS", set())
    if ip in trusted_proxies:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip() or ip
    return ip


# In development/testing, use very lenient limits so the pytest suite is not
# throttled by the shared test client IP. Production keeps strict defaults.
# 桌面端（PSB_DESKTOP=1）是本机单用户形态：所有请求共享 127.0.0.1 一个桶，
# 通用限流放宽到 600/min——批量操作（素材池批量删除等）不会把本机用户限死
# （08-20 实锤：删 100 条素材把桌面端自己 429 到「掉线」）。云端网页保持 100。
import os as _os
_desktop = _os.environ.get("PSB_DESKTOP") == "1"
_login_max = 1000 if settings.ENV != "production" else 5
_chat_max = 1000 if settings.ENV != "production" else 30
_api_max = 10000 if settings.ENV != "production" else (600 if _desktop else 100)
_admin_max = 10000 if settings.ENV != "production" else 200

# Global rate limiter instances per endpoint category
login_limiter = RateLimiter(max_requests=_login_max, window_seconds=60)      # Auth
chat_limiter = RateLimiter(max_requests=_chat_max, window_seconds=60)         # Chat
api_limiter = RateLimiter(max_requests=_api_max, window_seconds=60)           # General API
admin_limiter = RateLimiter(max_requests=_admin_max, window_seconds=60)       # Admin

# 09-30 安全批：全局请求体大小帽。FastAPI 在鉴权拒绝前就会把 body 读进内存——
# 桌面 sidecar 前面没有 nginx，一个超大 body 直接打爆本机内存。按路径分级，
# 默认 5MB；大文件类端点各自已有的硬帽（20MB 文档/30MB 语音/50MB 快照/导入）不动。
class _BodyTooLarge(HTTPException):
    """chunked/流式 body 超帽：直接就是 HTTPException(413)——receive 包装层抛出后
    经 Starlette/FastAPI 任意一层 body 读取路径都会按 413 落到统一错误格式
    （普通 Exception 会被 FastAPI body 解析兜底成 400「parsing the body」）。"""

    def __init__(self):
        super().__init__(status_code=413, detail="Request body too large.")


_BODY_CAP_DEFAULT = 5 * 1024 * 1024
_BODY_CAP_BY_PREFIX = (
    ("/api/v1/documents", 21 * 1024 * 1024),   # 上传 20MB 帽 + 少许表单余量
    ("/api/v1/social", 55 * 1024 * 1024),      # 社交导入（服务端另有 50MB 帽）
    ("/api/v1/sync", 55 * 1024 * 1024),        # E2EE 快照 50MB 帽
    ("/api/v1/speech", 32 * 1024 * 1024),      # 语音 30MB 帽
    ("/api/v1/users/me/import", 105 * 1024 * 1024),  # 整包导入（行数有帽，字节按包体）
)


class BodyLimitMiddleware:
    """纯 ASGI 请求体帽（09-30 安全批 deferred⑥）：在应用栈最外层包装 receive/send——
    Content-Length 超帽直接 413 短路；chunked/流式超帽后吞下剩余 body 并把下游
    生成的响应改写为 413（在 receive 里抛异常会被 FastAPI body 解析兜底成 400，
    血泪实证——所以才用 send 改写而不是 raise）。
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        headers = {k.decode("latin1"): v.decode("latin1") for k, v in scope.get("headers", [])}
        try:
            content_length = int(headers.get("content-length") or 0)
        except ValueError:
            content_length = 0
        cap = _BODY_CAP_DEFAULT
        for prefix, c in _BODY_CAP_BY_PREFIX:
            if path.startswith(prefix):
                cap = c
                break
        if content_length > cap:
            response = JSONResponse(status_code=413, content={"detail": "Request body too large."})
            await response(scope, receive, send)
            return

        received = 0
        exceeded = False
        body_written = False

        async def capped_receive():
            nonlocal received, exceeded
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body") or b"")
                if received > cap:
                    exceeded = True
                    # 吞掉剩余：告诉下游「body 到此为止」，别 raise（见类 docstring）
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def capped_send(message):
            nonlocal body_written
            if exceeded and message["type"] == "http.response.start":
                message = {"type": "http.response.start", "status": 413,
                           "headers": [(b"content-type", b"application/json")]}
            elif exceeded and message["type"] == "http.response.body":
                if not body_written:
                    body_written = True
                    message = {"type": "http.response.body",
                               "body": b'{"detail":"Request body too large."}',
                               "more_body": False}
                else:
                    return  # 后续 body 段整体丢弃（已 more_body=False 收尾，再发即协议违规）
            await send(message)

        await self.app(scope, capped_receive, capped_send)


class SecurityMiddleware(BaseHTTPMiddleware):
    """Security middleware: rate limiting, security headers, XSS protection."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        client_ip = _get_client_ip(request)

        # Auth endpoints: 5 requests/minute
        if path.startswith("/api/v1/auth/login") or path.startswith("/api/admin/auth/login") or path.startswith("/api/v1/auth/register") \
                or path.startswith("/api/v1/cloud/login") or path.startswith("/api/v1/cloud-proxy/login") \
                or path.startswith("/api/v1/auth/forgot-password") or path.startswith("/api/v1/auth/reset-password"):  # 09-30 安全批：换 token 入口并入登录限流；密码找回同组（凭证类入口）
            if not login_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": "60"},
                    content={"detail": "Too many authentication attempts. Please try again later."}
                )
        
        # LLM chat endpoints: 30 requests/minute
        if path.startswith("/api/v1/llm/chat") or path.startswith("/api/v1/llm/summarize") or path.startswith("/api/v1/llm/extract-tags"):
            if not chat_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": "60"},
                    content={"detail": "LLM rate limit exceeded. Please slow down."}
                )
        
        # Admin endpoints: 200 requests/minute
        if path.startswith("/api/admin/"):
            if not admin_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": "60"},
                    content={"detail": "Admin API rate limit exceeded."}
                )
        
        # All other API endpoints: 100 requests/minute（admin 已走专属限流，跳过通用限流）
        if path.startswith("/api/") and not path.startswith("/api/admin/"):
            if not api_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": "60"},
                    content={"detail": "Rate limit exceeded. Please slow down."}
                )
        
        try:
            response = await call_next(request)
        except _BodyTooLarge:  # chunked 流式超帽（09-30 安全批 deferred⑥）
            return JSONResponse(status_code=413, content={"detail": "Request body too large."})
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if settings.CSP_ENABLED:
            response.headers["Content-Security-Policy"] = CSP_POLICY
        
        # HSTS for production (HTTPS only)
        if settings.ENV == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        return response
