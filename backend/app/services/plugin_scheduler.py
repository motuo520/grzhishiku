import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.database import SessionLocal
from app.models.base import User
from app.plugins.manager import plugin_manager

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None
_locks: dict[str, asyncio.Lock] = {}

SYNCABLE_PLUGIN_IDS = {"notion-import", "pocket-sync", "readwise-sync"}


def _job_id(user_id: str, plugin_id: str) -> str:
    return f"sync:{user_id}:{plugin_id}"


def _get_or_create_lock(key: str) -> asyncio.Lock:
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]


def _has_credentials(plugin_id: str, cfg: dict) -> bool:
    if plugin_id == "notion-import":
        return bool(cfg.get("integration_token"))
    if plugin_id == "pocket-sync":
        return bool(cfg.get("consumer_key") and cfg.get("access_token"))
    if plugin_id == "readwise-sync":
        return bool(cfg.get("api_token"))
    return False


async def _run_sync_job(user_id: str, plugin_id: str) -> None:
    """APScheduler job body: fetch user, run sync, update config."""
    lock = _get_or_create_lock(f"{user_id}:{plugin_id}")
    if lock.locked():
        logger.info("Skip overlapping sync job for user=%s plugin=%s", user_id, plugin_id)
        return

    async with lock:
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                logger.warning("Scheduled sync user not found: %s", user_id)
                return
            if not plugin_manager.is_enabled(user, plugin_id):
                logger.info("Plugin disabled for user=%s plugin=%s, skipping", user_id, plugin_id)
                return
            result = await plugin_manager.run_sync_for_user(user, plugin_id, db)
            logger.info("Scheduled sync success user=%s plugin=%s result=%s", user_id, plugin_id, result)
        except Exception as e:
            logger.exception("Scheduled sync failed user=%s plugin=%s: %s", user_id, plugin_id, e)
            # Roll back any failed transaction before reusing the session.
            try:
                db.rollback()
            except Exception:
                pass
            # Record failure in config so the UI can surface it.
            try:
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    cfg = plugin_manager.get_config(user, plugin_id)
                    auto = cfg.get("auto_sync") or {}
                    auto["last_sync_error"] = str(e)
                    auto["last_sync_at"] = datetime.now(timezone.utc).isoformat()
                    cfg["auto_sync"] = auto
                    plugin_manager.set_config(user, plugin_id, cfg, db)
            except Exception:
                logger.exception("Failed to record sync error for user=%s plugin=%s", user_id, plugin_id)
        finally:
            db.close()


def get_scheduler() -> Optional[AsyncIOScheduler]:
    return _scheduler


def schedule_user_plugin_sync(user: User, plugin_id: str) -> None:
    """Add or reschedule an interval job for a user's plugin."""
    if _scheduler is None:
        return
    if plugin_id not in SYNCABLE_PLUGIN_IDS:
        return

    cfg = plugin_manager.get_config(user, plugin_id)
    auto = cfg.get("auto_sync") or {}
    if not auto.get("enabled") or not plugin_manager.is_enabled(user, plugin_id) or not _has_credentials(plugin_id, cfg):
        remove_user_plugin_sync(user.id, plugin_id)
        return

    interval = int(auto.get("interval_minutes") or 60)
    if interval <= 0:
        interval = 60

    job_id = _job_id(user.id, plugin_id)
    trigger = IntervalTrigger(minutes=interval)
    existing = _scheduler.get_job(job_id)
    if existing:
        existing.reschedule(trigger=trigger)
        logger.info("Rescheduled sync job %s every %s min", job_id, interval)
    else:
        _scheduler.add_job(
            _run_sync_job,
            trigger=trigger,
            id=job_id,
            args=[user.id, plugin_id],
            replace_existing=True,
        )
        logger.info("Scheduled sync job %s every %s min", job_id, interval)


def remove_user_plugin_sync(user_id: str, plugin_id: str) -> None:
    """Remove a scheduled sync job if it exists."""
    if _scheduler is None:
        return
    job_id = _job_id(user_id, plugin_id)
    job = _scheduler.get_job(job_id)
    if job:
        _scheduler.remove_job(job_id)
        logger.info("Removed sync job %s", job_id)


def get_next_run_time(user_id: str, plugin_id: str) -> Optional[datetime]:
    if _scheduler is None:
        return None
    job = _scheduler.get_job(_job_id(user_id, plugin_id))
    return job.next_run_time if job else None


async def initialize_scheduler() -> None:
    """Start scheduler and rebuild jobs for all users with auto-sync enabled."""
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()

    db = SessionLocal()
    try:
        users = db.query(User).all()
        for user in users:
            for plugin_id in SYNCABLE_PLUGIN_IDS:
                if not plugin_manager.is_enabled(user, plugin_id):
                    continue
                cfg = plugin_manager.get_config(user, plugin_id)
                auto = cfg.get("auto_sync") or {}
                if not auto.get("enabled"):
                    continue
                if not _has_credentials(plugin_id, cfg):
                    continue
                schedule_user_plugin_sync(user, plugin_id)
    finally:
        db.close()


async def shutdown_scheduler() -> None:
    """Gracefully shutdown the scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
