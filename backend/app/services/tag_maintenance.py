"""标签日扫任务：回收幽灵关联行与闲置空标签。

背景（08-20 实测）：自动打标会产生大量一次性空标签（某真实库 736 标签 592 空），
历史路径还会残留「内容已删、关联行还在」的幽灵行让空标签删不掉。
每日 06:30 UTC 扫一次。
"""
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.database import SessionLocal
from app.services import tag_service

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def sweep_tags() -> int:
    """清幽灵关联 + 回收闲置 30 天以上的空标签。返回删除条数。"""
    db = SessionLocal()
    try:
        deleted = tag_service.sweep_stale_empty_tags(db)
        db.commit()
        return deleted
    except Exception as e:
        db.rollback()
        logger.warning("tag sweep failed: %s", e)
        return 0
    finally:
        db.close()


def initialize_tag_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return  # lifespan 每 TestClient 触发一次，防重复挂载
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        sweep_tags,
        CronTrigger(hour=6, minute=30),
        id="tag_sweep",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("Tag scheduler started with daily sweep job")


def shutdown_tag_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
