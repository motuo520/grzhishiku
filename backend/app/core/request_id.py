"""X-Request-ID 中间件（10-01）：请求级关联 id 基础设施。

进站有 X-Request-ID 则沿用（字符白名单+截断，防日志注入/CRLF），无则生成 uuid.hex；
挂 request.state.request_id 供审计落库（core/audit.py）与排障日志取，回写响应头
便于「用户报错截图 → 按 id 捞日志/审计行」对单。
"""
import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware

_RID_CLEAN = re.compile(r"[^A-Za-z0-9\-]")
_RID_MAX = 64


def sanitize_request_id(raw: str) -> str:
    """入站 X-Request-ID 净化：白名单外字符剥除 + 截断；净化后为空返回 ''（调用方生成新 id）。

    注：合规 HTTP 客户端本来就发不出 CRLF/非拉丁字符的 header（httpx 层即拒），
    这层防的是裸 socket/非标客户端直打，单元测试直接测本函数。
    """
    return _RID_CLEAN.sub("", raw or "")[:_RID_MAX]


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = sanitize_request_id(request.headers.get("x-request-id", ""))
        if not rid:
            rid = uuid.uuid4().hex
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response
