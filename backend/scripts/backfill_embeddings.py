# -*- coding: utf-8 -*-
"""Backfill embeddings for existing content (idempotent).

Walks a user's active notes, active browser clips and knowledge units, and
stores an embedding for each item that does not have one yet.

Usage:
    python scripts/backfill_embeddings.py [--email user@example.com | --user-id ID]
                                          [--db PATH_OR_SQLITE_URL] [--force]

--db defaults to the app's configured DATABASE_URL (.env / environment).
A plain file path is converted to a sqlite:/// URL.

Idempotent: items that already have an embeddings row with the same
content_type + content_id are skipped (checked before embedding). --force
deletes the target users' stored embeddings for these content types first and
recomputes everything.
"""
import argparse
import asyncio
import os
import sys


def parse_args():
    p = argparse.ArgumentParser(description="Backfill content embeddings")
    p.add_argument("--email", default=None, help="Target user email")
    p.add_argument("--user-id", default=None, help="Target user id")
    p.add_argument("--db", default=None, help="SQLite file path or full DATABASE_URL")
    p.add_argument("--force", action="store_true", help="Recompute all embeddings (deletes existing rows first)")
    return p.parse_args()


# CLI 运行时先解析 --db 并设置 DATABASE_URL（必须在导入 app 模块之前）。
_cli_args = parse_args()
if _cli_args.db:
    db = _cli_args.db
    if "://" not in db:
        db = "sqlite:///" + os.path.abspath(db)
    os.environ["DATABASE_URL"] = db

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.database import SessionLocal  # noqa: E402
from app.models.base import User, Note, BrowserClip, KnowledgeUnit, Embedding  # noqa: E402
from app.services.embedding_service import embedding_service  # noqa: E402
from app.services.chunking import embed_document_chunks, CHUNK_ID_SEP  # noqa: E402

# content_type 取值与检索端（llm._retrieve_knowledge_sources 向量通道）及
# pipeline 写入知识单元时使用的字符串保持一致。
CONTENT_TYPES = ("note", "clip", "knowledge")
MAX_TEXT_LEN = 2000  # 与 pipeline 的 content_raw[:2000] 截断长度一致


def build_text(title: str, body: str) -> str:
    return f"{title or ''}\n{body or ''}".strip()[:MAX_TEXT_LEN]


def iter_items(session, user_id: str):
    """Yield (content_type, content_id, text) for all embeddable content."""
    for note in session.query(Note).filter(Note.user_id == user_id, Note.status == "active").all():
        yield "note", note.id, build_text(note.title, note.content)
    for clip in session.query(BrowserClip).filter(
        BrowserClip.user_id == user_id, BrowserClip.status == "active"
    ).all():
        yield "clip", clip.id, build_text(clip.title or clip.url, clip.full_text or clip.excerpt)
    for unit in session.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id).all():
        yield "knowledge", unit.id, build_text(unit.source_title or unit.content_type, unit.content_raw)


async def backfill_user(session, user, force: bool) -> dict:
    stats = {"stored": 0, "skipped": 0, "failed": 0}
    if force:
        deleted = (
            session.query(Embedding)
            .filter(Embedding.user_id == user.id, Embedding.content_type.in_(CONTENT_TYPES))
            .delete(synchronize_session=False)
        )
        session.commit()
        print(f"  --force: deleted {deleted} existing embeddings")

    # 已存在的文档集合，先查再嵌，保证幂等。
    # 块向量的 content_id 形如 "{doc_id}::chunk::{n}"，按归属的原文档 id 去重。
    existing = {
        (r.content_type, r.content_id.split(CHUNK_ID_SEP, 1)[0])
        for r in session.query(Embedding.content_type, Embedding.content_id)
        .filter(Embedding.content_type.in_(CONTENT_TYPES))
        .all()
    }

    count = 0
    for content_type, content_id, text in iter_items(session, user.id):
        count += 1
        if not text:
            stats["skipped"] += 1
            continue
        if (content_type, content_id) in existing:
            stats["skipped"] += 1
            continue
        try:
            stored = await embed_document_chunks(
                text, content_type=content_type, doc_id=content_id, user_id=user.id
            )
            if stored == 0:
                print("  !! embedding service is in mock fallback (Ollama down?), aborting")
                stats["failed"] += 1
                break
            existing.add((content_type, content_id))
            stats["stored"] += stored
        except Exception as e:
            print(f"  !! failed {content_type}/{content_id}: {e}")
            stats["failed"] += 1
        if count % 10 == 0:
            print(f"  ... {count} items processed (stored={stats['stored']}, skipped={stats['skipped']}, failed={stats['failed']})")
    return stats


async def main():
    session = SessionLocal()
    try:
        q = session.query(User).filter(User.status == "active")
        if _cli_args.email:
            q = q.filter(User.email == _cli_args.email)
        if _cli_args.user_id:
            q = q.filter(User.id == _cli_args.user_id)
        users = q.all()
        if not users:
            print("ERROR: no matching active user found")
            sys.exit(1)

        total = {"stored": 0, "skipped": 0, "failed": 0}
        for user in users:
            print(f"User: {user.email} (id={user.id})")
            stats = await backfill_user(session, user, force=_cli_args.force)
            print(f"  done: stored={stats['stored']}, skipped={stats['skipped']}, failed={stats['failed']}")
            for k in total:
                total[k] += stats[k]

        rows = session.query(Embedding).count()
        print(f"\nTotal: stored={total['stored']}, skipped={total['skipped']}, failed={total['failed']}")
        print(f"embeddings table rows now: {rows}")
    finally:
        session.close()


if __name__ == "__main__":
    asyncio.run(main())
