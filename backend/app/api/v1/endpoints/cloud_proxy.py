"""云端账号代理（桌面端/自托管实例连接官方云或自建云）。

用途：桌面端 origin 是 http://127.0.0.1:<动态端口>，云端 CORS 无法覆盖，
所以由本地后端代为转发。设计要点：
- 云端 token 只保存在本机数据目录（cloud_account.json），不上传到任何地方；
- 同步密码在浏览器端完成加解密，本代理只搬运密文，不破坏端到端加密；
- 转发路径严格白名单（同步与数据导入导出），不开放任意代理。
"""
import json
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.models.base import User

router = APIRouter()

_BINDING_FILE = "cloud_account.json"

# 允许转发的云端路径前缀（相对于 /api/v1/）
_ALLOWED_PREFIXES = ("sync/", "llm/")
_ALLOWED_EXACT = {"users/me/export", "users/me/import"}


def _binding_path() -> str:
    # 桌面 sidecar 启动时会 chdir 到 PSB_DATA_DIR，绑定文件随之落在数据目录
    return os.path.join(os.getcwd(), _BINDING_FILE)


def _load_binding() -> Optional[dict]:
    path = _binding_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _save_binding(binding: dict) -> None:
    with open(_binding_path(), "w", encoding="utf-8") as f:
        json.dump(binding, f, ensure_ascii=False)


def _validate_server_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="服务器地址必须以 http:// 或 https:// 开头")
    return url


class CloudLoginRequest(BaseModel):
    server_url: str = Field(..., max_length=200)
    email: str = Field(..., max_length=200)
    password: str = Field(..., max_length=128)


@router.post("/login")
async def cloud_login(req: CloudLoginRequest, current_user: User = Depends(get_current_user)):
    server_url = _validate_server_url(req.server_url)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{server_url}/api/v1/auth/login",
                json={"email": req.email, "password": req.password},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务器：{e}") from e
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="云端账号或密码不正确")

    token = resp.json().get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="云端响应格式不正确")
    _save_binding({"server_url": server_url, "email": req.email, "token": token})
    return {"success": True, "email": req.email, "server_url": server_url}


@router.get("/status")
async def cloud_status(current_user: User = Depends(get_current_user)):
    binding = _load_binding()
    if not binding:
        return {"bound": False}
    return {"bound": True, "account": {"server_url": binding["server_url"], "email": binding["email"]}}


@router.post("/logout")
async def cloud_logout(current_user: User = Depends(get_current_user)):
    path = _binding_path()
    if os.path.exists(path):
        os.unlink(path)
    return {"success": True}


@router.post("/login-session")
async def cloud_login_session(req: CloudLoginRequest):
    """桌面端用云端账号直接登录：云端验证通过后，在本机开通本地会话。

    无需本地账号（这本身就是登录入口）：云端验证成功 → 本地不存在该邮箱
    则自动创建本地账户（随机密码，数据完全存在本机）→ 签发本地 token。
    """
    import secrets
    import uuid
    from datetime import timedelta

    from app.core.database import SessionLocal
    from app.core.security import create_access_token, get_password_hash

    server_url = _validate_server_url(req.server_url)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{server_url}/api/v1/auth/login",
                json={"email": req.email, "password": req.password},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务器：{e}") from e
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="云端邮箱或密码错误")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"云端响应异常（{resp.status_code}）")

    cloud_token = resp.json().get("access_token")
    if not cloud_token:
        raise HTTPException(status_code=502, detail="云端响应格式不正确")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == req.email).first()
        if not user:
            user = User(
                id=str(uuid.uuid4()),
                email=req.email,
                name=req.email.split("@")[0][:50],
                password_hash=get_password_hash(secrets.token_urlsafe(24)),
                status="active",
            )
            db.add(user)
            db.commit()
        _save_binding({"server_url": server_url, "email": req.email, "token": cloud_token})
        local_token = create_access_token(
            data={"sub": user.id, "email": user.email},
            expires_delta=timedelta(days=7),
        )
        return {"access_token": local_token, "token_type": "bearer", "email": user.email}
    finally:
        db.close()


@router.api_route("/forward/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "PATCH"])
async def cloud_forward(path: str, request: Request, current_user: User = Depends(get_current_user)):
    if path not in _ALLOWED_EXACT and not any(path.startswith(p) for p in _ALLOWED_PREFIXES):
        raise HTTPException(status_code=403, detail="该路径不允许转发")

    binding = _load_binding()
    if not binding:
        raise HTTPException(status_code=400, detail="未绑定云端账号")

    body = await request.body()
    headers = {"Authorization": f"Bearer {binding['token']}"}
    content_type = request.headers.get("content-type")
    if content_type:
        headers["Content-Type"] = content_type

    from fastapi.responses import StreamingResponse

    # 流式透传：llm/chat 的 SSE 逐 chunk 下发，普通 JSON 同样兼容
    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=20.0))
    try:
        req = client.build_request(
            request.method,
            f"{binding['server_url']}/api/v1/{path}",
            params=dict(request.query_params),
            content=body if body else None,
            headers=headers,
        )
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"云端请求失败：{e}") from e

    if resp.status_code == 401:
        await resp.aclose()
        await client.aclose()
        raise HTTPException(status_code=401, detail="云端登录已过期，请重新绑定")

    async def stream_body():
        try:
            # aiter_bytes 由 httpx 完成 gzip/br 解压；aiter_raw 会把压缩字节透传给
            # 浏览器而我们又不带 content-encoding 头，会导致响应不可读
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type"),
    )
