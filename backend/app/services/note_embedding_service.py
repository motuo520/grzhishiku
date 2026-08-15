"""笔记向量化：写入事件监听 + 启动一次性回填（BUG-R02）。

修复前只有 knowledge 单元走 pipeline 才 embed，笔记从不向量化——embeddings 表
content_type='note' 的记录为 0，46k 字长文档只有开头约 400 字能进问答上下文，
尾部事实检索不到。本服务参照 graphify_service 的监听模式给笔记补向量化：

- 监听挂全局 SessionLocal：before_commit 捕获 new/dirty/deleted 的 Note，
  after_commit 投递后台重嵌（after_commit 里 session.new 已清空，
  必须先捕获后投递）
- 幂等挂载：监听挂在全局类上且从不移除，lifespan 每 TestClient 重入一次，
  重复挂会叠加触发次数
- 只处理 status='active'；归档/删除时清理旧向量（含块向量）
- 重嵌 = 先删后写：内容更新后旧块向量不留残渣，同一入口天然幂等
- 长文档分块：chunk ~1000 字、重叠 100（NOTE_CHUNK_TARGET/OVERLAP），
  短文档（<= chunking.CHUNK_SIZE_THRESHOLD）保持一文档一向量
- 嵌入走本机 Ollama（OLLAMA_EMBED_MODEL，默认 nomic-embed-text，免费）；
  Ollama 不可用（mock fallback）时不写库、静默跳过，绝不阻塞主流程
- BUG-P06：批量导入（500 条/批）一次 commit 触发 after_commit 逐条 spawn 线程，
  瞬时数百线程各自建事件循环 + httpx 客户端 + 打满本机 Ollama，资源耗尽致进程
  无日志退出。改为有界队列 + 固定 2 个 daemon worker 串行消费，并去重排队中的笔记。
"""

import logging
import queue
import threading

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.base import Note, Embedding as EmbeddingModel
from app.services.chunking import CHUNK_ID_SEP

logger = logging.getLogger(__name__)

# 笔记切块口径：QA 实锤的 46k 长文档要覆盖尾部事实，块比 chunking 默认（600/80）更大
NOTE_CHUNK_TARGET = 1000
NOTE_CHUNK_OVERLAP = 100

_listener_registered = False  # 监听挂全局 SessionLocal 类，重复注册会叠加触发
_backfill_started = False     # 启动回填只跑一次（lifespan 重入不重复扫库）

_EMBED_WORKERS = 2
_embed_queue: "queue.Queue[tuple]" = queue.Queue()
_embed_queued: set = set()          # 已入队 note_id 去重（重复提交只重嵌一次）
_embed_lock = threading.Lock()
_embed_workers_started = False


def _embed_worker() -> None:
    while True:
        note_id, user_id = _embed_queue.get()
        # 先出队标记再执行：执行期间同一笔记的新提交允许再排一次（重嵌幂等），
        # 去重只挡「还没开始跑」的重复排队
        with _embed_lock:
            _embed_queued.discard(note_id)
        try:
            embed_note(note_id, user_id)
        except Exception as e:  # embed_note 自身已吞异常，这里双保险护住 worker 循环
            logger.info("note embedding worker error for %s: %s", note_id, e)
        finally:
            _embed_queue.task_done()


def _start_embed_workers() -> None:
    """启动固定数量的消费 worker（幂等）。

    在 register_note_embedding_listener 时随真实 threading 环境启动，
    而不是等到首次入队——测试里有用例会把 threading.Thread 换成同步执行的
    FakeThread，若在入队路径上惰性启动，无限循环的 worker 会被同步执行卡死。
    """
    global _embed_workers_started
    with _embed_lock:
        if _embed_workers_started:
            return
        _embed_workers_started = True
        for i in range(_EMBED_WORKERS):
            threading.Thread(target=_embed_worker, daemon=True, name=f"note-embed-{i}").start()


def _enqueue_embed(note_id: str, user_id: str) -> None:
    with _embed_lock:
        if note_id in _embed_queued:
            return
        _embed_queued.add(note_id)
    _start_embed_workers()  # 兜底：未走 register 的单测直调路径
    _embed_queue.put((note_id, user_id))


def _delete_note_embeddings(db: Session, note_id: str) -> None:
    """删掉笔记的全部向量（整文档向量 + 块向量）。"""
    db.query(EmbeddingModel).filter(
        EmbeddingModel.content_type == "note",
        (EmbeddingModel.content_id == note_id)
        | (EmbeddingModel.content_id.like(f"{note_id}{CHUNK_ID_SEP}%")),
    ).delete(synchronize_session=False)


def embed_note(note_id: str, user_id: str = "") -> int:
    """重嵌单篇笔记：先清旧向量再按当前内容重算。新增/更新/归档/删除同一入口，幂等。

    返回写入的向量条数；笔记不存在、非 active、内容为空、嵌入服务不可用
    （mock fallback）均为 0。任何异常静默，绝不影响主流程。
    """
    db = SessionLocal()
    try:
        # 先取数据再提交：commit 后 ORM 属性过期，访问会隐式开新事务，
        # 与调用方共享连接时（测试 savepoint 模式）close 的回滚会吞掉后续写入
        note = db.query(Note).filter(Note.id == note_id).first()
        is_active = bool(note and note.status == "active")
        text = f"{note.title or ''}\n{note.content or ''}".strip() if note else ""
        uid = (note.user_id if note else "") or user_id
        _delete_note_embeddings(db, note_id)
        db.commit()
        if not is_active or not text:
            return 0
        import asyncio
        from app.services.chunking import embed_document_chunks
        return asyncio.run(embed_document_chunks(
            text,
            content_type="note",
            doc_id=note_id,
            user_id=uid,
            target=NOTE_CHUNK_TARGET,
            overlap=NOTE_CHUNK_OVERLAP,
        ))
    except Exception as e:
        logger.info("note embedding skipped for %s: %s", note_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        db.close()


def backfill_missing_note_embeddings(batch_limit: int = 200) -> int:
    """一次性回填：给缺少向量覆盖的 active 笔记补 embed，返回处理条数。

    幂等：按 (content_id, content_type) 判存（块向量归属回 {doc_id} 基 id），
    已覆盖的笔记跳过；单次最多 batch_limit 条防大库启动雪崩，未补完的下轮启动继续。
    """
    db = SessionLocal()
    try:
        covered = {
            (row[0] or "").split(CHUNK_ID_SEP, 1)[0]
            for row in db.query(EmbeddingModel.content_id)
            .filter(EmbeddingModel.content_type == "note")
            .all()
        }
        missing = [
            (row.id, row.user_id)
            for row in db.query(Note.id, Note.user_id).filter(Note.status == "active").all()
            if row.id not in covered
        ][:batch_limit]
    except Exception as e:
        logger.info("note embedding backfill scan failed: %s", e)
        return 0
    finally:
        db.close()

    for note_id, user_id in missing:
        embed_note(note_id, user_id)
    if missing:
        logger.info("note embedding backfill: %d notes processed", len(missing))
    return len(missing)


def start_backfill_once() -> None:
    """监听就绪后启动时后台跑一次存量回填（幂等守卫：lifespan 重入不重复跑）。"""
    global _backfill_started
    if _backfill_started:
        return
    _backfill_started = True
    threading.Thread(target=backfill_missing_note_embeddings, daemon=True).start()


def register_note_embedding_listener() -> None:
    """挂写入监听：笔记新增/更新/删除提交后后台重嵌向量。

    幂等：注册在全局 SessionLocal 类上且从不移除，lifespan 重入
    （测试里每个 TestClient 一次）不得重复挂，否则一次提交触发 N 次重嵌。
    与 graphify 自进化监听互不干扰（各自独立会话）。
    """
    global _listener_registered
    if _listener_registered:
        return
    _listener_registered = True

    # worker 随注册启动（真实 threading 环境），见 _start_embed_workers 注释
    _start_embed_workers()

    from sqlalchemy import event

    _pending: dict = {}

    @event.listens_for(SessionLocal, "before_commit")
    def _capture(session) -> None:
        # after_commit 里 session.new/dirty/deleted 已清空，必须在这里捕获
        ids = {}
        for obj in list(session.new) + list(session.dirty) + list(session.deleted):
            if isinstance(obj, Note) and getattr(obj, "id", None):
                ids[obj.id] = getattr(obj, "user_id", "") or ""
        if ids:
            _pending.setdefault(id(session), {}).update(ids)

    @event.listens_for(SessionLocal, "after_commit")
    def _on_commit(session) -> None:
        ids = _pending.pop(id(session), None)
        if not ids:
            return
        for note_id, user_id in ids.items():
            _enqueue_embed(note_id, user_id)

    @event.listens_for(SessionLocal, "after_rollback")
    def _on_rollback(session) -> None:
        # 回滚同样消费 pending，否则 before_commit 捕获的条目泄漏到下次提交
        _pending.pop(id(session), None)
