from typing import Optional

from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

from app.core.security import decode_token

# Shared FastMCP instance used by the core system and all plugins.
mcp = FastMCP(
    "personal-second-brain",
    instructions=(
        "You are an agent connected to Qianji, a local-first AI knowledge base. "
        "You can search knowledge, create notes and knowledge units, "
        "and inspect the cognitive production pipeline. "
        "Tools act as the user identified by the Bearer token; never ask for user_id."
    ),
)


def authenticate_token(token: str) -> Optional[str]:
    """校验用户 JWT，合法返回 user_id，否则返回 None。"""
    payload = decode_token(token) if token else None
    if not payload or payload.get("type") != "user":
        return None
    return payload.get("sub")


class JWTAuthMiddleware:
    """Require a valid user JWT (Authorization: Bearer) on every HTTP request.

    mount() 的子应用不走 FastAPI 路由与 Depends，因此认证必须用纯 ASGI
    中间件实现。无 token 或 token 非法时直接返回 401。
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            auth = headers.get(b"authorization", b"").decode("latin-1")
            token = auth[len("bearer "):] if auth.lower().startswith("bearer ") else ""
            if not authenticate_token(token):
                response = JSONResponse({"detail": "Not authenticated"}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def mount_mcp(app: FastAPI) -> None:
    """Mount the MCP SSE server under /api/v1/mcp (JWT-authenticated).

    幂等：lifespan 可能多次进入（测试里每个 TestClient 都跑一遍），
    重复 mount 只会在路由表里堆积无人命中的重复 Mount。
    """
    if any(getattr(route, "path", None) == "/api/v1/mcp" for route in app.routes):
        return
    sse_app = JWTAuthMiddleware(mcp.sse_app())
    app.mount("/api/v1/mcp", sse_app)
