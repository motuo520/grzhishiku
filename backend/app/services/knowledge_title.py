# -*- coding: utf-8 -*-
"""知识单元 title（09-16）：生成时填标题 + 存量回填，不动 LLM 抽取 prompt（概念名现成）。

- first_line_title：非 LLM 创建点/回填共用的「首行剥 markdown 截 30 字」口径
  （与 retrieval/assembly.py 的 _knowledge_title 兜底同规则，但这里是数据层一次写好）。
- backfill_ku_titles：存量回填，零成本优先——概念卡解 content_raw 冒号前、
  碰撞卡解 collision_parents 双亲、source_title 非空直用；都不沾的才走本地模型
  （自动链路本地通道，同 autotag 口径：ollama 原始名直连、免费不进计费、
  本地不可用整轮跳过不报错）。
"""
import asyncio
import json
import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.core.database import SessionLocal  # 调度器自建会话（测试 monkeypatch 此名，同 autotag 口径）
from app.models.base import KnowledgeUnit

logger = logging.getLogger(__name__)

# LLM 路每轮批次帽（本地 0.8b 一条约 0.7s，50 条封顶约半分钟，整点轮询慢慢消化）
LLM_BATCH_CAP = 50

# 回填主批次帽（零成本解析 + LLM 路合计一轮处理的行数）
BATCH_SIZE = 200


def first_line_title(text: str) -> str:
    """正文首行剥 markdown 井号/列表符/引用符，截 30 字（数据层标题兜底）。"""
    raw = (text or "").strip()
    first = raw.split("\n", 1)[0].lstrip("#>*- ").strip() if raw else ""
    return first[:30]


def _concept_label_from_raw(raw: str) -> str:
    """概念卡 content_raw（'概念名: 定义' 形态）取概念名：冒号（中/英）前；无冒号截 20 字。"""
    raw = (raw or "").strip()
    if not raw:
        return ""
    head = raw.split(":", 1)[0].split("：", 1)[0].strip()
    return head or raw[:20]


def _collision_title(unit) -> str:
    """碰撞卡标题：「碰撞：A×B」，A/B=双亲概念名（collision_parents JSON 里是双亲）。"""
    try:
        parents = json.loads(unit.collision_parents or "[]")
    except Exception:
        return ""
    names = []
    for p in parents[:2]:
        # 双亲行里的 title 字段存的是 content_raw 截 80 字，同样走冒号前口径
        label = _concept_label_from_raw((p or {}).get("title") or "")
        if label:
            names.append(label)
    if len(names) == 2:
        return f"碰撞：{names[0]}×{names[1]}"
    if names:
        return f"碰撞：{names[0]}×?"
    return ""


async def _gen_title_llm(db: Session, user_id: str, content: str) -> str:
    """本地模型产标题（自动链路本地通道）：ollama 原始名直连，免费不进计费。
    失败/不可用向上抛，由回填循环按「整轮跳过」处理。"""
    from app.services.llm_service import chat_completion
    prompt = (
        "给以下知识内容起一个简短标题（不超过 20 字，只输出标题本身，不要引号不要解释）：\n\n"
        + content[:800]
    )
    # 开源版无 autotag 独立通道：直走本地默认模型（本地调用免费，无计费概念）
    return await chat_completion(prompt=prompt, task_type="knowledge_title")


def backfill_ku_titles(db: Session, batch: int = BATCH_SIZE) -> Dict[str, int]:
    """存量回填 title（幂等：只处理 title IS NULL 或 '' 的行；可断点——每轮 batch 行，
    下轮接着来）。返回 {parsed, llm, skipped}：parsed=零成本解析命中数，
    llm=本地模型产标数，skipped=本轮跳过数（空内容/LLM 路超限或不可用/输出无效）。"""
    rows = db.query(KnowledgeUnit).filter(
        (KnowledgeUnit.title.is_(None)) | (KnowledgeUnit.title == ""),
    ).order_by(KnowledgeUnit.first_seen).limit(batch).all()

    stats = {"parsed": 0, "llm": 0, "skipped": 0}
    llm_used = 0
    llm_available = True  # 首条 LLM 路失败（本地不可用）→ 整轮 LLM 路跳过不报错
    for u in rows:
        title: Optional[str] = None
        raw = (u.content_raw or "").strip()
        if u.content_subtype == "concept":
            title = _concept_label_from_raw(raw) or None
        elif u.content_subtype == "collision_result":
            title = _collision_title(u) or None
        if title is None and (u.source_title or "").strip():
            title = u.source_title.strip()
        if title:
            u.title = title[:100]
            stats["parsed"] += 1
            continue
        if not raw:
            stats["skipped"] += 1
            continue
        # LLM 路（批次帽 + 本地不可用整轮跳过）
        if llm_used >= LLM_BATCH_CAP or not llm_available:
            stats["skipped"] += 1
            continue
        try:
            out = asyncio.run(_gen_title_llm(db, u.user_id, raw))
        except Exception as e:
            llm_available = False
            stats["skipped"] += 1
            logger.info("ku title backfill: local LLM unavailable, skip LLM path this round (%s)", e)
            continue
        llm_used += 1
        cleaned = first_line_title(out)
        if not cleaned or (out or "").lstrip().startswith("[Error"):
            stats["skipped"] += 1
            continue
        u.title = cleaned
        stats["llm"] += 1
    db.commit()
    if rows:
        logger.info("ku title backfill: %d rows, %s", len(rows), stats)
    return stats


def run_ku_title_sweep() -> Dict[str, int]:
    """调度器入口：自建会话跑一轮回填（同步 DB 操作，BackgroundScheduler 直接可调）。"""
    db = SessionLocal()
    try:
        return backfill_ku_titles(db)
    except Exception as e:
        logger.warning("ku title sweep failed (skip this round): %s", e)
        db.rollback()
        return {"parsed": 0, "llm": 0, "skipped": 0}
    finally:
        db.close()


_scheduler = None  # 哨兵：TestClient 每实例触发 lifespan，防重复挂载


def initialize_ku_title_scheduler() -> None:
    """boot 180s 首扫（DateTrigger）+ 每小时一轮（IntervalTrigger）。幂等。"""
    global _scheduler
    if _scheduler is not None:
        return  # lifespan 每 TestClient 触发一次，防重复挂载
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.date import DateTrigger
    from apscheduler.triggers.interval import IntervalTrigger
    from datetime import datetime, timedelta

    # 同步 DB 函数（LLM 路内部自行 asyncio.run）——BackgroundScheduler 即可，
    # 不依赖运行中的事件循环（同 autotag/wiki lint 口径）
    _scheduler = BackgroundScheduler(timezone="UTC", job_defaults={"misfire_grace_time": 1800}, )
    _scheduler.add_job(
        run_ku_title_sweep,
        DateTrigger(run_date=datetime.now() + timedelta(seconds=180)),
        id="ku_title_backfill_boot",
        replace_existing=True,
    )
    _scheduler.add_job(
        run_ku_title_sweep,
        IntervalTrigger(hours=1),
        id="ku_title_backfill_hourly",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("KU title backfill scheduler started (boot 180s + hourly)")


def shutdown_ku_title_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("KU title backfill scheduler stopped")
