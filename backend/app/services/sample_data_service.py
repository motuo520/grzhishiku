"""轻量示例数据播种：让新账号的每个功能页都有 1-2 条示例可看。

注册时自动调用，也可通过 POST /users/me/seed-samples 手动触发。
幂等：某个实体类型只要用户已有内容就跳过，不会重复播种。
示例内容均为引导性质，用户可随时编辑或删除。
"""
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict

from sqlalchemy.orm import Session

from app.models.base import Note, BrowserClip, ReadLaterItem, KnowledgeUnit, Capsule
from app.models.sticky_note import StickyNote

logger = logging.getLogger(__name__)


def _has(db: Session, model, user_id: str) -> bool:
    return db.query(model).filter(model.user_id == user_id).first() is not None


def seed_sample_data(db: Session, user_id: str) -> Dict[str, int]:
    """为账号补齐各功能 1-2 条示例内容，返回各类型实际新增数量。"""
    now = datetime.now(timezone.utc)
    seeded: Dict[str, int] = {}

    if not _has(db, Note, user_id):
        db.add_all([
            Note(
                id=str(uuid.uuid4()), user_id=user_id,
                title="👋 欢迎使用钤记",
                content=(
                    "这是你的第一条笔记。\n\n"
                    "钤记的用法就三步：\n\n"
                    "1. **存进来**——笔记、剪藏、文件、RSS，什么都往里放\n"
                    "2. **自动理好**——AI 帮你提炼、打标、连成知识网络\n"
                    "3. **一句话问出来**——右下角 AI 助手，随时向你的知识库提问\n\n"
                    "这条示例可以随时编辑或删除。"
                ),
            ),
            Note(
                id=str(uuid.uuid4()), user_id=user_id,
                title="示例：读书笔记《原子习惯》",
                content=(
                    "「你不会上升到你目标的高度，只会跌落到你系统的水平。」\n\n"
                    "我的理解：与其立 flag，不如改造日常环境——"
                    "把想读的书放在床头，把手机放到另一个房间。\n\n"
                    "#读书笔记 #习惯"
                ),
            ),
        ])
        seeded["notes"] = 2

    if not _has(db, StickyNote, user_id):
        db.add_all([
            StickyNote(
                id=str(uuid.uuid4()), user_id=user_id,
                content="这是便签墙：随手记、提醒、灵感，双击就能编辑 📌",
                color="#f59e0b", is_pinned=True,
            ),
            StickyNote(
                id=str(uuid.uuid4()), user_id=user_id,
                content="示例提醒：本周找个时间整理剪藏里的文章",
                color="#22c55e", position_x=280,
                remind_at=now + timedelta(days=3),
            ),
        ])
        seeded["sticky_notes"] = 2

    if not _has(db, BrowserClip, user_id):
        db.add_all([
            BrowserClip(
                id=str(uuid.uuid4()), user_id=user_id,
                title="示例剪藏：钤记 GitHub 仓库",
                url="https://github.com/motuo520/grzhishiku",
                domain="github.com",
                excerpt="钤记开源主页：一键 docker compose 自托管的个人第二大脑。装上浏览器扩展后，任何网页都能一键剪藏到这里。",
            ),
            BrowserClip(
                id=str(uuid.uuid4()), user_id=user_id,
                title="示例剪藏：Personal knowledge management - Wikipedia",
                url="https://en.wikipedia.org/wiki/Personal_knowledge_management",
                domain="en.wikipedia.org",
                excerpt="个人知识管理（PKM）是收集、组织、存储和检索知识的过程——这正是「第二大脑」要解决的问题。",
            ),
        ])
        seeded["clips"] = 2

    if not _has(db, ReadLaterItem, user_id):
        db.add(ReadLaterItem(
            id=str(uuid.uuid4()), user_id=user_id,
            title="稍后读示例：Building a Second Brain（方法论概览）",
            url="https://fortelabs.com/blog/basboverview/",
            domain="fortelabs.com",
            excerpt="Tiago Forte 的 BASB 方法：Capture、Organize、Distill、Express——存进来、理好、提炼、表达。",
        ))
        seeded["read_later"] = 1

    if not _has(db, KnowledgeUnit, user_id):
        db.add_all([
            KnowledgeUnit(
                id=str(uuid.uuid4()), user_id=user_id, brain_side="network",
                content_raw="间隔重复能显著提升长期记忆保持率。核心原理是在遗忘曲线的临界点安排复习，让大脑反复提取。",
                source_url="https://en.wikipedia.org/wiki/Spaced_repetition",
                source_title="Spaced repetition - Wikipedia",
                source_type="article",
                verification_status="verified", verification_consensus=0.9,
            ),
            KnowledgeUnit(
                id=str(uuid.uuid4()), user_id=user_id, brain_side="personal",
                content_raw="我发现自己在通勤路上思考效率最高——重要的复盘和决策，可以刻意安排在这个时间段。",
                verification_status="unverified",
            ),
        ])
        seeded["knowledge_units"] = 2

    if not _has(db, Capsule, user_id):
        unlock_date = (now + timedelta(days=365)).strftime("%Y-%m-%d")
        db.add(Capsule(
            id=str(uuid.uuid4()), user_id=user_id,
            content_type="text",
            content_body=(
                "给一年后的自己：\n\n"
                "希望这时的你，已经在钤记里沉淀了真正属于自己的知识体系。\n\n"
                "—— 来自刚注册钤记的你"
            ),
            mood_emotion="hopeful",
            sealed_at=now,
            unlock_type="date",
            unlock_config=json.dumps({"date": unlock_date}),
        ))
        seeded["capsules"] = 1

    db.commit()
    logger.info("sample data seeded for user %s: %s", user_id, seeded)
    return seeded
