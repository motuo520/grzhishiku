"""RSS 定时自动刷新扫班。

设计：单 sweeper job（15 分钟一拍），不建 per-feed job——
配置在 user.settings["rss_auto"]（rss_service 管），到期判定用
RssFeed.last_fetched_at + interval，重启自然恢复。
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.database import SessionLocal
from app.services import rss_service

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None
_sweep_lock = asyncio.Lock()

SWEEP_INTERVAL_MINUTES = 15


async def sweep_due_feeds() -> dict:
    """拉取所有到期的自动刷新源，返回统计。供调度 job 与测试直接调用。"""
    if _sweep_lock.locked():
        logger.info("Skip overlapping RSS sweep")
        return {"skipped": True}
    async with _sweep_lock:
        stats = {"feeds_due": 0, "entries_added": 0, "failures": 0}
        db = SessionLocal()
        try:
            now = datetime.now()
            for feed, user_id, interval in rss_service.iter_auto_fetch_feeds(db):
                if feed.last_fetched_at and feed.last_fetched_at + timedelta(minutes=interval) > now:
                    continue
                stats["feeds_due"] += 1
                try:
                    # refresh_feed 内是同步阻塞网络 I/O，丢到线程池避免卡住事件循环
                    result = await asyncio.to_thread(rss_service.refresh_feed, db, feed, user_id)
                    stats["entries_added"] += result["added"]
                    logger.info("RSS auto-fetch ok feed=%s added=%s", feed.id, result["added"])
                except Exception as e:
                    stats["failures"] += 1
                    logger.warning("RSS auto-fetch failed feed=%s: %s", feed.id, e)
                    try:
                        db.rollback()
                    except Exception:
                        pass
        finally:
            db.close()
        return stats


def initialize_rss_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()
    _scheduler.add_job(
        sweep_due_feeds,
        trigger=IntervalTrigger(minutes=SWEEP_INTERVAL_MINUTES),
        id="rss:sweep",
        replace_existing=True,
    )
    logger.info("RSS auto-fetch sweeper scheduled every %s min", SWEEP_INTERVAL_MINUTES)


def shutdown_rss_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
