# -*- coding: utf-8 -*-
"""Seed guided demo data for a user (idempotent).

Usage:
    python scripts/seed_demo_data.py --email user@example.com [--db PATH_OR_SQLITE_URL]

--db defaults to the app's configured DATABASE_URL (.env / environment).
A plain file path is converted to a sqlite:/// URL; relative paths resolve
against the current working directory (run from the backend root).

Only inserts rows; never updates or deletes existing data. Re-running is safe:
each item is looked up by a natural key (title / url / content prefix) first.
"""
import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta


def parse_args():
    p = argparse.ArgumentParser(description="Seed guided demo data for a user")
    p.add_argument("--email", required=True, help="Target user email (must already exist)")
    p.add_argument("--db", default=None, help="SQLite file path or full DATABASE_URL")
    return p.parse_args()


ARGS = parse_args()

if ARGS.db:
    db = ARGS.db
    if "://" not in db:
        db = "sqlite:///" + os.path.abspath(db)
    os.environ["DATABASE_URL"] = db

# Import app modules only after DATABASE_URL is set.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.database import SessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.content import Note, BrowserClip, ReadLaterItem, Tag, content_tags  # noqa: E402
from app.models.sticky_note import StickyNote  # noqa: E402
from app.models.capsule import Capsule  # noqa: E402
from app.models.knowledge import KnowledgeUnit, PracticeRecord  # noqa: E402
from app.models.messaging import RssFeed  # noqa: E402
from app.models.attention import DeepWorkSession  # noqa: E402

NOW = datetime.utcnow()


def uid() -> str:
    return str(uuid.uuid4())


def days_ago(n, hour=10):
    return (NOW - timedelta(days=n)).replace(hour=hour, minute=0, second=0, microsecond=0)


def main():
    session = SessionLocal()
    stats = {}
    try:
        user = session.query(User).filter(User.email == ARGS.email).first()
        if not user:
            print(f"ERROR: user not found: {ARGS.email}")
            sys.exit(1)
        u = user.id
        print(f"Target user: {ARGS.email} (id={u})")

        # ── Tags ──────────────────────────────────────────────
        tag_ids = {}
        tag_defs = [
            ("工作", "#3b82f6", "工作相关的任务、会议与项目资料"),
            ("学习", "#22c55e", "读书、课程与方法论学习笔记"),
            ("灵感", "#a855f7", "随手记录的灵感与想法"),
            ("待办", "#f59e0b", "需要跟进处理的事项"),
        ]
        for name, color, desc in tag_defs:
            t = session.query(Tag).filter(Tag.user_id == u, Tag.name == name).first()
            if not t:
                t = Tag(id=uid(), user_id=u, name=name, color=color, description=desc)
                session.add(t)
                session.flush()
                stats["tags"] = stats.get("tags", 0) + 1
            tag_ids[name] = t.id

        # ── Notes ─────────────────────────────────────────────
        notes_def = [
            {
                "title": "三个动作上手第二大脑",
                "content": (
                    "# 三个动作上手第二大脑\n\n"
                    "这个应用的核心循环只有三步：\n\n"
                    "1. **收集** —— 看到的文章用浏览器剪藏存进来，想法写成笔记或便签。\n"
                    "2. **整理** —— 给内容打标签，把有价值的剪藏/笔记沉淀为「知识单元」。\n"
                    "3. **回顾** —— 用知识图谱看内容之间的关联，定期用深度工作时段消化「稍后读」。\n\n"
                    "建议先点左侧每个菜单看一遍演示数据，就知道每个功能是干什么的了。"
                ),
                "tags": ["学习"],
                "days": 4,
            },
            {
                "title": "会议记录模板",
                "content": (
                    "# 会议记录模板\n\n"
                    "- **时间**：\n- **参会人**：\n- **议题**：\n\n"
                    "## 结论\n\n（每条结论一行，写明负责人）\n\n"
                    "## 行动项\n\n- [ ] 事项 1 @负责人 截止日\n- [ ] 事项 2 @负责人 截止日\n\n"
                    "## 待澄清\n\n（没聊清楚、需要会后确认的问题）\n\n"
                    "> 用法：开会前复制本模板新建一条笔记，会后把行动项打上「待办」标签。"
                ),
                "tags": ["工作"],
                "days": 3,
            },
            {
                "title": "读书卡片：如何阅读一本书",
                "content": (
                    "# 读书卡片：《如何阅读一本书》\n\n"
                    "**核心观点**：阅读分四个层次——基础阅读、检视阅读、分析阅读、主题阅读。"
                    "大多数人停留在前两层。\n\n"
                    "**我的理解**：检视阅读（有目的地快速翻完全书）性价比最高，"
                    "能 30 分钟判断一本书值不值得深读。\n\n"
                    "**下一步**：对「稍后读」里的长文也先用检视阅读的思路扫一遍再决定精读。"
                ),
                "tags": ["学习", "灵感"],
                "days": 2,
            },
            {
                "title": "本周想尝试的一件事",
                "content": (
                    "把每天上午 9:00-10:30 设为不看消息的「深度工作」时段，"
                    "用注意力管家记录专注情况，周五回看一周的专注分数变化。\n\n"
                    "触发这个想法的是知识单元里的「二八定律」——如果 20% 的时间产出 80% 的成果，"
                    "那最该保护的就是这 20%。"
                ),
                "tags": ["灵感", "待办"],
                "days": 1,
            },
        ]
        note_id_map = {}
        for nd in notes_def:
            n = session.query(Note).filter(Note.user_id == u, Note.title == nd["title"]).first()
            if not n:
                n = Note(
                    id=uid(), user_id=u, brain_side="personal",
                    title=nd["title"], content=nd["content"],
                    content_format="markdown", status="active",
                    created_at=days_ago(nd["days"]), updated_at=days_ago(nd["days"]),
                )
                session.add(n)
                session.flush()
                stats["notes"] = stats.get("notes", 0) + 1
            note_id_map[nd["title"]] = n.id
            for tname in nd["tags"]:
                exists = session.execute(
                    content_tags.select().where(
                        content_tags.c.content_id == n.id,
                        content_tags.c.content_type == "note",
                        content_tags.c.tag_id == tag_ids[tname],
                    )
                ).first()
                if not exists:
                    session.execute(
                        content_tags.insert().values(
                            content_id=n.id, content_type="note", tag_id=tag_ids[tname]
                        )
                    )

        # ── Sticky notes ──────────────────────────────────────
        stickies_def = [
            ("便签墙用法：双击空白处新建便签，用完左键拖动归类，右键归档。", "#f59e0b", 40, 40),
            ("今天下午 3 点前回复客户邮件（演示提醒，可删除）", "#ef4444", 320, 60),
            ("灵感：把「稍后读」里读完的文章一键转成知识单元，别囤着。", "#22c55e", 600, 100),
        ]
        for content, color, x, y in stickies_def:
            if not session.query(StickyNote).filter(StickyNote.user_id == u, StickyNote.content == content).first():
                session.add(StickyNote(
                    id=uid(), user_id=u, content=content, color=color,
                    position_x=x, position_y=y,
                    created_at=days_ago(1, hour=9), updated_at=days_ago(1, hour=9),
                ))
                stats["sticky_notes"] = stats.get("sticky_notes", 0) + 1

        # ── Browser clips ─────────────────────────────────────
        clips_def = [
            {
                "title": "Local-First Software: You Own Your Data, in spite of the Cloud",
                "url": "https://www.inkandswitch.com/local-first/",
                "domain": "inkandswitch.com",
                "excerpt": "本地优先软件的七个理想：数据属于用户、离线可用、多方协作、长久保存……本文是本地优先运动的奠基论文。",
                "author": "Martin Kleppmann et al.",
            },
            {
                "title": "费曼技巧：用教会别人来检验自己是否真懂",
                "url": "https://fs.blog/feynman-technique/",
                "domain": "fs.blog",
                "excerpt": "费曼学习法四步：选定概念、讲给外行听、发现讲不清的地方回去补、用类比简化。能讲清楚才算真正理解。",
                "author": "Farnam Street",
            },
            {
                "title": "Building a Second Brain: The PARA Method",
                "url": "https://fortelabs.com/blog/para/",
                "domain": "fortelabs.com",
                "excerpt": "PARA 整理法：Projects（项目）、Areas（领域）、Resources（资源）、Archives（归档），按「可行动性」而非主题组织信息。",
                "author": "Tiago Forte",
            },
        ]
        for cd in clips_def:
            if not session.query(BrowserClip).filter(BrowserClip.user_id == u, BrowserClip.url == cd["url"]).first():
                session.add(BrowserClip(
                    id=uid(), user_id=u, brain_side="network",
                    title=cd["title"], url=cd["url"], domain=cd["domain"],
                    excerpt=cd["excerpt"], author=cd["author"],
                    capture_method="extension", extracted=True, summarized=True,
                    verification_status="unverified", status="active",
                    created_at=days_ago(2), updated_at=days_ago(2),
                ))
                stats["browser_clips"] = stats.get("browser_clips", 0) + 1

        # ── Read later ────────────────────────────────────────
        rl_def = [
            {
                "title": "The Graph Index: How Graph Databases Power Knowledge Tools",
                "url": "https://neo4j.com/developer/graph-database/",
                "domain": "neo4j.com",
                "excerpt": "图数据库入门：节点、关系、属性如何表达知识网络——正好对应本应用的「知识图谱」功能。",
                "status": "unread",
            },
            {
                "title": "深度工作：如何在碎片化时代保持专注",
                "url": "https://www.calnewport.com/writing/",
                "domain": "calnewport.com",
                "excerpt": "Cal Newport 的《深度工作》核心思想：无干扰的专注时段是知识工作者最稀缺的资源。",
                "status": "reading",
                "progress": 40,
            },
            {
                "title": "Zettelkasten 卡片盒笔记法实战指南",
                "url": "https://zettelkasten.de/introduction/",
                "domain": "zettelkasten.de",
                "excerpt": "卢曼的卡片盒方法：每张卡片一个想法，卡片之间显式建立链接，知识网络自然生长。",
                "status": "unread",
            },
        ]
        for rd in rl_def:
            if not session.query(ReadLaterItem).filter(ReadLaterItem.user_id == u, ReadLaterItem.url == rd["url"]).first():
                session.add(ReadLaterItem(
                    id=uid(), user_id=u, title=rd["title"], url=rd["url"],
                    domain=rd["domain"], excerpt=rd["excerpt"],
                    status=rd["status"], read_progress=rd.get("progress", 0),
                    source="manual", item_status="active",
                    created_at=days_ago(3), updated_at=days_ago(3),
                ))
                stats["read_later_items"] = stats.get("read_later_items", 0) + 1

        # ── RSS feeds ─────────────────────────────────────────
        rss_def = [
            {
                "title": "Hacker News (Best)",
                "url": "https://hnrss.org/best",
                "site_url": "https://news.ycombinator.com/",
                "description": "Hacker News 高分帖——技术与创业社区的风向标。",
            },
            {
                "title": "阮一峰的网络日志",
                "url": "https://www.ruanyifeng.com/blog/atom.xml",
                "site_url": "https://www.ruanyifeng.com/blog/",
                "description": "中文技术博客，每周五发布《科技爱好者周刊》。",
            },
        ]
        for fd in rss_def:
            if not session.query(RssFeed).filter(RssFeed.user_id == u, RssFeed.url == fd["url"]).first():
                session.add(RssFeed(
                    id=uid(), user_id=u, title=fd["title"], url=fd["url"],
                    site_url=fd["site_url"], description=fd["description"],
                    language="zh" if "ruanyifeng" in fd["url"] else "en",
                    fetch_status="pending", status="active",
                    created_at=days_ago(2), updated_at=days_ago(2),
                ))
                stats["rss_feeds"] = stats.get("rss_feeds", 0) + 1

        # ── Knowledge units ───────────────────────────────────
        ku_def = [
            {
                "source_title": "费曼学习法",
                "brain_side": "personal",
                "verification_status": "confirmed",
                "content_raw": "费曼学习法：学一个概念后，假装把它讲给完全不懂的人听。讲不清楚的地方就是没真正理解的地方，回去补，再用更简单的类比重讲，直到能流畅讲出。",
                "content_processed": "检验理解的最佳方式是输出：能教会别人，才算真正学会。",
                "trust_level": "established",
                "days": 5,
            },
            {
                "source_title": "二八定律（帕累托法则）",
                "brain_side": "personal",
                "verification_status": "confirmed",
                "content_raw": "二八定律：在许多场景中，约 80% 的结果来自 20% 的原因。应用于时间管理：找出产出最高的 20% 活动并优先保障它们，例如每天的一段深度工作时间。",
                "content_processed": "少数关键投入决定大部分产出；保护高杠杆时间比延长工时更重要。",
                "trust_level": "established",
                "days": 5,
            },
            {
                "source_title": "本地优先软件（Local-First）",
                "brain_side": "network",
                "verification_status": "confirmed",
                "content_raw": "本地优先软件：数据默认存储在用户自己的设备上，离线可用，云端只做同步与协作。代表原则来自 Ink & Switch 的论文：快、多设备、离线、协作、长久、隐私、用户掌控。",
                "content_processed": "数据主权归用户的软件架构取向，本应用的设计哲学之一。",
                "source_url": "https://www.inkandswitch.com/local-first/",
                "trust_level": "established",
                "days": 3,
            },
            {
                "source_title": "PARA 信息整理法",
                "brain_side": "network",
                "verification_status": "unverified",
                "content_raw": "PARA 法（Tiago Forte 提出）：把所有信息按可行动性分为项目 Projects、领域 Areas、资源 Resources、归档 Archives 四类，而不是按主题分类。",
                "source_url": "https://fortelabs.com/blog/para/",
                "trust_level": "tentative",
                "days": 2,
            },
            {
                "source_title": "每天走一万步最健康的说法来源存疑",
                "brain_side": "network",
                "verification_status": "disputed",
                "content_raw": "「每天一万步」的健康标准广为流传，但研究显示它源自 1964 年日本一款计步器的营销口号（万步计），并非医学结论。后续研究表明天天 7000-8000 步已能获得大部分健康收益。此条标记为「有争议」，演示知识单元的验证状态机制。",
                "trust_level": "tentative",
                "days": 1,
            },
            {
                "source_title": "间隔重复记忆法",
                "brain_side": "personal",
                "verification_status": "unverified",
                "content_raw": "间隔重复：在遗忘曲线的临界点（1 天、3 天、1 周、2 周……）安排复习，用最少次数把知识写入长期记忆。Anki 等工具即基于此原理。",
                "trust_level": "tentative",
                "days": 1,
            },
        ]
        ku_ids = {}
        for kd in ku_def:
            k = session.query(KnowledgeUnit).filter(
                KnowledgeUnit.user_id == u, KnowledgeUnit.source_title == kd["source_title"]
            ).first()
            if not k:
                k = KnowledgeUnit(
                    id=uid(), user_id=u,
                    brain_side=kd["brain_side"],
                    content_raw=kd["content_raw"],
                    content_processed=kd.get("content_processed"),
                    content_type="concept",
                    source_title=kd["source_title"],
                    source_url=kd.get("source_url"),
                    source_type="manual" if not kd.get("source_url") else "web",
                    verification_status=kd["verification_status"],
                    trust_level=kd["trust_level"],
                    last_verified=days_ago(kd["days"]) if kd["verification_status"] == "confirmed" else None,
                    status="active",
                    created_at=days_ago(kd["days"]), updated_at=days_ago(kd["days"]),
                )
                session.add(k)
                session.flush()
                stats["knowledge_units"] = stats.get("knowledge_units", 0) + 1
            ku_ids[kd["source_title"]] = k.id

        # ── Capsules ──────────────────────────────────────────
        capsules_def = [
            {
                "content_body": (
                    "三个月前的我：如果你看到这条，说明「第二大脑」已经陪你走过一个季度了。\n\n"
                    "当时的目标：攒够 50 条知识单元、每周至少 3 次深度工作。\n"
                    "现在回头看看——做到了吗？哪些收集的内容真的用上了？"
                ),
                "unlock_offset_days": -1,  # 已到解锁时间，打开列表时会自动解锁
                "sealed_days": 90,
                "note": "写给三个月后的自己（已可开启）",
            },
            {
                "content_body": (
                    "给半年后的自己：希望这时的你，已经把「稍后读」清空过至少一次，"
                    "并且知识图谱里长出了几个意想不到的主题社区。\n"
                    "别忘了：工具只是容器，思考和连接才是目的。"
                ),
                "unlock_offset_days": 90,  # 未来解锁
                "sealed_days": 0,
                "note": "写给半年后的自己（90 天后解锁）",
            },
        ]
        for cd in capsules_def:
            if not session.query(Capsule).filter(
                Capsule.user_id == u, Capsule.content_body == cd["content_body"]
            ).first():
                unlock_date = NOW + timedelta(days=cd["unlock_offset_days"])
                session.add(Capsule(
                    id=uid(), user_id=u, brain_side="personal",
                    content_type="text", content_body=cd["content_body"],
                    sealed_at=days_ago(cd["sealed_days"]),
                    sealed_fingerprint=uid(),
                    unlock_type="temporal",
                    unlock_config=json.dumps({"unlock_date": unlock_date.isoformat()}),
                    unlock_status="locked",
                    privacy_level="private",
                    created_at=days_ago(cd["sealed_days"]),
                    updated_at=days_ago(cd["sealed_days"]),
                ))
                stats["capsules"] = stats.get("capsules", 0) + 1

        # ── Deep work sessions ────────────────────────────────
        dw_def = [
            ("整理「稍后读」并提炼 2 条知识单元", 90, 88, 1, 8.6, 0),
            ("写完读书卡片：如何阅读一本书", 60, 65, 2, 7.9, 1),
            ("梳理本周会议纪要并拆解行动项", 45, 45, 3, 8.2, 0),
        ]
        for task, planned, actual, dback, score, interrupts in dw_def:
            started = days_ago(dback, hour=9)
            if not session.query(DeepWorkSession).filter(
                DeepWorkSession.user_id == u, DeepWorkSession.task == task
            ).first():
                session.add(DeepWorkSession(
                    id=uid(), user_id=u, brain_side="personal",
                    task=task, planned_duration=planned, actual_duration=actual,
                    started_at=started, ended_at=started + timedelta(minutes=actual),
                    rules_block_notifications=True,
                    focus_score_avg=score, interruptions=interrupts,
                    blocked_attempts=interrupts,
                    completion_status="completed", end_reason="completed",
                ))
                stats["deep_work_sessions"] = stats.get("deep_work_sessions", 0) + 1

        # ── Practice records ──────────────────────────────────
        pr_def = [
            {
                "target_title": "费曼学习法",
                "practice_type": "taught",
                "description": "向同事用 5 分钟讲清「本地优先软件」的概念，中间在「冲突-free 复制数据（CRDT）」一处卡壳。",
                "result": "对方听懂了 80%，CRDT 部分没讲明白。",
                "learned_lesson": "回去补了 CRDT 的资料后才算真正掌握——验证了「讲不清就是没懂」。",
                "days": 2,
            },
            {
                "target_title": "二八定律（帕累托法则）",
                "practice_type": "applied",
                "description": "盘点上周时间开销，发现上午 9-11 点产出约占全天的 60%，于是把这两个小时设为不受打扰的深度工作时段。",
                "result": "连续 3 天执行，专注分数 7.9-8.6，产出明显提升。",
                "learned_lesson": "找到高杠杆的 20% 时间后，关键是制度化地保护它。",
                "days": 1,
            },
        ]
        for pd in pr_def:
            if not session.query(PracticeRecord).filter(
                PracticeRecord.user_id == u, PracticeRecord.description == pd["description"]
            ).first():
                session.add(PracticeRecord(
                    id=uid(), user_id=u,
                    target_type="knowledge_unit",
                    target_id=ku_ids[pd["target_title"]],
                    practice_type=pd["practice_type"],
                    description=pd["description"],
                    result=pd["result"],
                    learned_lesson=pd["learned_lesson"],
                    created_at=days_ago(pd["days"], hour=17),
                    updated_at=days_ago(pd["days"], hour=17),
                ))
                stats["practice_records"] = stats.get("practice_records", 0) + 1

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    print("\n=== Inserted (new rows only; existing skipped) ===")
    order = [
        "tags", "notes", "sticky_notes", "browser_clips", "read_later_items",
        "rss_feeds", "knowledge_units", "capsules", "deep_work_sessions",
        "practice_records",
    ]
    for key in order:
        print(f"  {key}: {stats.get(key, 0)}")
    print("Done.")


if __name__ == "__main__":
    main()
