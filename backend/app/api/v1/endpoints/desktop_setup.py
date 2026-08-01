"""桌面端首次启动环境向导：Ollama 检测、一键安装、启动、拉模型。

仅在桌面端（PSB_DESKTOP=1）可用——网页端/自托管不需要这些能力。
拉模型与安装过程以 SSE 流式下发进度，前端向导实时渲染。
"""
import json
import os
import shutil
import subprocess
import sys

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.core.security import get_current_user
from app.models.base import User

router = APIRouter()

REQUIRED_MODELS = {
    "chat": "qwen2.5:0.5b",
    "embed": "nomic-embed-text",
}


def _desktop_only():
    if os.environ.get("PSB_DESKTOP") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


def _ollama_url() -> str:
    return (settings.OLLAMA_BASE_URL or "http://localhost:11434").rstrip("/")


async def _running_models() -> list:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{_ollama_url()}/api/tags")
            if resp.status_code == 200:
                return [m.get("name", "") for m in resp.json().get("models", [])]
    except Exception:
        pass
    return []


@router.get("/ollama-status")
async def ollama_status(current_user: User = Depends(get_current_user)):
    """向导总状态：二进制是否存在、服务是否在跑、所需模型是否齐全。"""
    _desktop_only()
    binary = shutil.which("ollama") is not None
    models = await _running_models()
    running = bool(models) or await _ping()
    model_status = {
        key: any(m.startswith(name) for m in models)
        for key, name in REQUIRED_MODELS.items()
    }
    return {
        "binary": binary,
        "running": running,
        "models": models,
        "required": model_status,
        "ready": binary and running and all(model_status.values()),
    }


async def _ping() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{_ollama_url()}/api/version")
            return resp.status_code == 200
    except Exception:
        return False


@router.post("/ollama-start")
async def ollama_start(current_user: User = Depends(get_current_user)):
    """后台拉起 ollama serve（ detached，不阻塞、不留控制台窗口）。"""
    _desktop_only()
    if not shutil.which("ollama"):
        raise HTTPException(status_code=400, detail="未安装 Ollama")
    if await _ping():
        return {"started": True, "already": True}
    try:
        if sys.platform == "win32":
            subprocess.Popen(
                ["ollama", "serve"],
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
                close_fds=True,
            )
        else:
            subprocess.Popen(["ollama", "serve"], start_new_session=True, close_fds=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"启动失败：{e}") from e
    return {"started": True, "already": False}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/ollama-pull")
async def ollama_pull(model: str, current_user: User = Depends(get_current_user)):
    """拉取模型，SSE 透传 Ollama 拉取进度。"""
    _desktop_only()
    if model not in REQUIRED_MODELS.values():
        raise HTTPException(status_code=400, detail="不在向导模型清单内")
    if not await _ping():
        raise HTTPException(status_code=400, detail="Ollama 服务未启动")

    async def gen():
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(3600.0, connect=10.0)) as client:
                async with client.stream(
                    "POST", f"{_ollama_url()}/api/pull", json={"name": model, "stream": True}
                ) as resp:
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        yield _sse(data)
                        if data.get("status") == "success":
                            break
            yield _sse({"status": "done", "model": model})
        except Exception as e:  # noqa: BLE001
            yield _sse({"status": "error", "message": str(e)[:200]})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/ollama-install")
async def ollama_install(current_user: User = Depends(get_current_user)):
    """Windows 下用 winget 一键安装 Ollama，SSE 透传输出。"""
    _desktop_only()
    if sys.platform != "win32":
        raise HTTPException(status_code=400, detail="当前仅支持 Windows 一键安装，请前往 ollama.com 下载")
    if shutil.which("ollama"):
        return {"installed": True, "already": True}
    if not shutil.which("winget"):
        raise HTTPException(status_code=400, detail="未检测到 winget，请前往 ollama.com 手动下载安装")

    async def gen():
        yield _sse({"status": "installing", "message": "正在通过 winget 安装 Ollama…"})
        try:
            proc = subprocess.Popen(
                ["winget", "install", "-e", "--id", "Ollama.Ollama", "--silent",
                 "--accept-package-agreements", "--accept-source-agreements"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                yield _sse({"status": "installing", "message": line.rstrip()[:200]})
            rc = proc.wait()
            # winget 安装后 PATH 要刷新进程环境
            for cand in (
                os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe"),
                r"C:\Program Files\Ollama\ollama.exe",
            ):
                if os.path.exists(cand):
                    os.environ["PATH"] = os.path.dirname(cand) + os.pathsep + os.environ.get("PATH", "")
                    break
            ok = rc == 0 and (shutil.which("ollama") is not None)
            yield _sse({"status": "done" if ok else "error",
                        "message": "安装完成" if ok else f"安装可能失败（退出码 {rc}），请前往 ollama.com 手动安装"})
        except Exception as e:  # noqa: BLE001
            yield _sse({"status": "error", "message": str(e)[:200]})

    return StreamingResponse(gen(), media_type="text/event-stream")
