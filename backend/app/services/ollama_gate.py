"""本地模型并发闸（09-05 内存事故后拍板：网页本地档限并发 2-4 路）。

云端 3.8G 小机上 ollama 每个本地调用都烧 CPU/内存（一次对话暗藏 2 次 0.8b
生成（改写/变体）+ 1 次 bge-m3 嵌入），不设闸 10 并发即排队躺刀尖。
所有本地 ollama 工作负载调用（生成/嵌入）统一过这一道闸：
- 默认 2 路（取下限保守，OLLAMA_CONCURRENCY 可调 2-4）；
- 桌面端（PSB_DESKTOP=1）不限——本机单用户自己烧自己的机器；
- 排队超 120s 视为过载，生成路 yield [Error:]、嵌入路返回 []（沿用既有降级语义）。

注意别嵌套获取：检索先嵌入（取放）后生成（取住整条流），顺序获取无死锁。
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

_LIMIT = int(os.getenv("OLLAMA_CONCURRENCY", "2"))
_ACQUIRE_TIMEOUT = 120.0
_enabled = os.environ.get("PSB_DESKTOP") != "1"

# 按事件循环惰性建信号量：uvicorn 单循环即全局限额；测试每用例新循环互不串扰
# （模块级 Semaphore 跨循环有待者时会 RuntimeError）。
_semaphores: dict = {}


def _get_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _semaphores.get(loop)
    if sem is None:
        sem = asyncio.Semaphore(_LIMIT)
        _semaphores[loop] = sem
    return sem


@asynccontextmanager
async def ollama_slot(kind: str = "gen"):
    """获取一个本地模型执行槽。kind 仅用于日志（gen/embed）。"""
    if not _enabled:
        yield True
        return
    sem = _get_semaphore()
    try:
        await asyncio.wait_for(sem.acquire(), timeout=_ACQUIRE_TIMEOUT)
    except asyncio.TimeoutError:
        logger.warning("本地模型并发闸排队超时（%ss，%s 路）：%s 请求按过载处理", _ACQUIRE_TIMEOUT, _LIMIT, kind)
        yield False
        return
    try:
        yield True
    finally:
        sem.release()
