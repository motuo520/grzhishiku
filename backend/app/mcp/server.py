from typing import Optional

from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.database import SessionLocal
from app.core.security import decode_token
from app.models.base import User

# Shared FastMCP instance used by the core system and all plugins.
mcp = FastMCP(
    "personal-second-brain",
    instructions=(
        "You are an agent connected to Molore, a local-first AI knowledge base. "
        "You can search knowledge, create notes and knowledge units, "
        "and inspect the cognitive production pipeline. "
        "Tools act as the user identified by the Bearer token; never ask for user_id."
    ),
)

# streamable-http 传输自带 DNS rebinding 防护（默认只放 localhost，云端 Host 被 421
# 实捕 09-24）：显式放行本机与正式域；真正的门是上面的 Bearer JWT 鉴权中间件
mcp.settings.transport_security.allowed_hosts = [
    "localhost",
    "127.0.0.1",
    "testserver",
    "grzhishiku.com",
    "*.grzhishiku.com",
]


def authenticate_request(request: Request) -> Optional[str]:
    """Validate the Bearer JWT on an MCP HTTP request; return user_id or None.

    与 get_current_user 同一口径：仅 decode 不够——refresh token 不得当 access 用，
    改密/登出（token_version 递增）与账号禁用必须对 MCP 同样生效。
    """
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    payload = decode_token(auth[7:].strip())
    if not payload or payload.get("type") != "user":
        return None
    if payload.get("token_use") == "refresh":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.status != "active":
            return None
        if int(payload.get("token_version") or 0) != int(getattr(user, "token_version", None) or 0):
            return None
        return user.id
    finally:
        db.close()


class MCPAuthMiddleware:
    """ASGI middleware requiring a valid user JWT for all MCP traffic."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            if not authenticate_request(Request(scope)):
                response = JSONResponse({"detail": "Not authenticated"}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def _mcp_root_app():
    """单挂载点双传输分发：/sse + /messages/ 走 SSE（旧客户端/UI 文档口径），
    其余路径走 streamable-http（现代 MCP 客户端/Hermes 默认传输，09-24）。"""
    sse_app = mcp.sse_app()
    http_app = mcp.streamable_http_app()

    async def dispatcher(scope, receive, send):
        # Starlette 1.6 的 Mount 不改写 scope["path"]（只设 root_path）——
        # 先剥 root_path 拿到挂载内路径再分发（09-24 实捕：全路径进来 /sse 与 / 全 404）
        root = scope.get("root_path", "")
        path = scope.get("path", "") or "/"
        if root and path.startswith(root):
            path = path[len(root):] or "/"
        if path == "/sse" or path.startswith("/messages/"):
            await sse_app(scope, receive, send)
        else:
            # streamable_http_app 的路由挂在 /mcp（不是 /）：挂载内任意路径都归一到它，
            # path 必须补回 root_path（子应用按 root_path 剥离后匹配 /mcp）
            scope = dict(scope)
            scope["path"] = f"{root}/mcp"
            await http_app(scope, receive, send)

    return dispatcher


def mount_mcp(app: FastAPI) -> None:
    """Mount the MCP server under /api/v1/mcp（SSE + streamable-http 双传输）。

    幂等：lifespan 可能多次进入（测试里每个 TestClient 都跑一遍），
    重复 mount 只会在路由表里堆积无人命中的重复 Mount。
    """
    if any(getattr(route, "path", None) == "/api/v1/mcp" for route in app.routes):
        return
    app.mount("/api/v1/mcp", MCPAuthMiddleware(_mcp_root_app()))


_mcp_session_cm = None
_mcp_session_lock = None


async def mcp_session_startup() -> None:
    """streamable session manager 任务组随主 lifespan 启动（进程级一次）。

    两个硬约束（09-24 实捕）：① Starlette 不把 lifespan 传给挂载子应用，
    session manager 必须挂进主 lifespan；② run() 每个实例只允许调一次——
    只进不退，退出由事件循环收尾取消任务组（测试里 TestClient 反复进出
    lifespan 也不会撞 already-run）。"""
    global _mcp_session_cm, _mcp_session_lock
    import asyncio

    if _mcp_session_lock is None:
        _mcp_session_lock = asyncio.Lock()
    async with _mcp_session_lock:
        if _mcp_session_cm is None:
            _mcp_session_cm = mcp.session_manager.run()
            await _mcp_session_cm.__aenter__()
