from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import time
from collections import defaultdict
from typing import Dict, List

class RateLimiter:
    """Simple in-memory rate limiter with per-endpoint support."""
    
    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)
    
    def is_allowed(self, key: str) -> bool:
        now = time.time()
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

# In development/testing, use very lenient limits so the pytest suite is not
# throttled by the shared test client IP. Production keeps strict defaults.
_login_max = 1000 if settings.ENV != "production" else 5
_chat_max = 1000 if settings.ENV != "production" else 30
_api_max = 10000 if settings.ENV != "production" else 100
_admin_max = 10000 if settings.ENV != "production" else 200

# Global rate limiter instances per endpoint category
login_limiter = RateLimiter(max_requests=_login_max, window_seconds=60)      # Auth
chat_limiter = RateLimiter(max_requests=_chat_max, window_seconds=60)         # Chat
api_limiter = RateLimiter(max_requests=_api_max, window_seconds=60)           # General API
admin_limiter = RateLimiter(max_requests=_admin_max, window_seconds=60)       # Admin

class SecurityMiddleware(BaseHTTPMiddleware):
    """Security middleware: rate limiting, security headers, XSS protection."""
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        client_ip = request.client.host if request.client else "unknown"
        
        # Auth endpoints: 5 requests/minute
        if path.startswith("/api/v1/auth/login") or path.startswith("/api/admin/auth/login") or path.startswith("/api/v1/auth/register"):
            if not login_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many authentication attempts. Please try again later."}
                )
        
        # LLM chat endpoints: 30 requests/minute
        if path.startswith("/api/v1/llm/chat") or path.startswith("/api/v1/llm/summarize") or path.startswith("/api/v1/llm/extract-tags"):
            if not chat_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "LLM rate limit exceeded. Please slow down."}
                )
        
        # Admin endpoints: 200 requests/minute
        if path.startswith("/api/admin/"):
            if not admin_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Admin API rate limit exceeded."}
                )
        
        # All other API endpoints: 100 requests/minute
        if path.startswith("/api/"):
            if not api_limiter.is_allowed(client_ip):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Please slow down."}
                )
        
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        # HSTS for production (HTTPS only)
        if settings.ENV == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        return response
