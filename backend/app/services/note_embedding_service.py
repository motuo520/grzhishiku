"""笔记向量化：写入事件监听 + 启动一次性回填（BUG-R02）。

修复前只有 knowledge 单元走 pipeline 才 embed，笔记从不向量化——embeddings 表
content_type='note' 的记录为 0，46k 字长文档只有开头约 400 字能进问答上下文，
尾部事实检索不到。本服务参照 autotag_service 的监听模式给笔记补向量化：

- 监听挂全局 SessionLocal：before_flush 捕获 new/dirty/deleted 的 Note，
  after_commit 投递后台线程重嵌（after_commit 里 session.new 已清空，
  必须先捕获后投递——autotag 0.2.44 冒烟踩过的坑）
- 幂等挂载：监听挂在全局类上且从不移除，lifespan 每 TestClient 重入一次，
  重复挂会叠加触发次数
- 只处理 status='active'；归档/删除时清理旧向量（含块向量）
- 重嵌 = 先算后写：新向量全部算好才在同一事务里删旧写新，Ollama 挂
  （mock fallback）时旧向量保留，不会净丢失
- 长文档分块：统一父子块口径（子块 ~600 字/重叠 80、父块 ~1800 字，见 chunking），
  短文档（<= chunking.CHUNK_SIZE_THRESHOLD）保持一文档一向量
- 嵌入走本机 Ollama（OLLAMA_EMBED_MODEL，默认 bge-m3，免费）；
  Ollama 不可用（mock fallback）时不写库、静默跳过，绝不阻塞主流程

剪藏（BrowserClip）/ 文档（Document）向量通道（08-28 补全）复用同一套
队列+worker 与「先算后写」事务化替换，只在入口处多一道前拦质量门
（纯硬信号零模型，血泪#34：禁止小模型语义裁决）：
- 有效正文（strip 后）≥ MIN_EMBED_TEXT_LEN 字；个人/团队内容都进向量
  （空间隔离由检索侧内容行 scope 口径把守，embedding 行 user_id 仍记创建者）
- clip：status='active'，正文=full_text（空则 excerpt）；门结果回写 embedded 标志
- document：doc_status='active' 且 extraction_status='success'，正文=content_text；
  图片文档（无文字层、OCR 文本常不足 200 字）下限放宽为 MIN_EMBED_TEXT_LEN_IMAGE
- 门只拦向量通道（FTS 关键词通道不加门）；被拦记 info 计数日志

知识单元（KnowledgeUnit）向量通道（09-11 补全，血泪#43）：此前只有 pipeline
_content_to_knowledge 显式嵌向量，三个主入口（文档 save_to_knowledge / 剪藏
save_clip_to_knowledge / 直建 add_knowledge）建 KU 都不向量化——文档转 KU 后
原文档 doc_status='imported_to_knowledge' 退出检索池，几万字文档的上百条
向量全废，检索退化 FTS-only。修复口径 = 把 KU 纳入本服务同一套
after_commit 监听 + embed_content 分发（一处覆盖所有入口，含未来新入口）：
- 前拦门：status='active' + 有效正文（content_raw，strip 后）≥ MIN_EMBED_TEXT_LEN
  字；个人/团队 KU 同口径过门（三索引团队口径，隔离在检索侧内容行收口，
  不加 tenant 前拦）；KU 无 embedded 回写标志，门结果只影响向量行本身
- 更新/软删经监听自动重嵌/清理（dirty 带字段级去抖：invoke_count 等检索
  回写字段不触发重嵌）；存量由 backfill_missing_knowledge_embeddings 启动回填
- pipeline 的显式嵌入保留不动：监听补的一次重嵌是幂等的「先算后写」，
  同内容重算同向量，多费一轮 Ollama 调用但不会写坏
"""

import asyncio
import json
import logging
import queue
import threading
import uuid

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.base import Note, BrowserClip, Document, KnowledgeUnit, Embedding as EmbeddingModel
from app.services.chunking import CHUNK_ID_SEP, expected_chunk_count


def is_question_chunk_id(content_id: str) -> bool:
    """判定 content_id 是否 Doc2Query 问题行（{doc_id}::chunk::q::{i}）。
    开源版无 question_gen_service（剥离面），此处内联同一口径（q:: 前缀）。"""
    if not content_id:
        return False
    parts = content_id.split(CHUNK_ID_SEP, 1)
    return len(parts) == 2 and parts[1].startswith("q::")

logger = logging.getLogger(__name__)

# 前拦质量门：有效正文下限（strip 后字符数）
MIN_EMBED_TEXT_LEN = 200
# 图片文档（OCR 文本）单独放宽：截图/照片 OCR 经常只有几十字，
# 200 字门会把绝大多数图片文档永远拦在向量通道外（进不了 RAG），
# 上传了等于没上传——与扫描件 PDF 血泪同源，故图片文档放宽到 20 字
MIN_EMBED_TEXT_LEN_IMAGE = 20

# 被门拦下的计数（info 日志留痕用，进程内累计）
_gated_counts = {"clip": 0, "document": 0, "knowledge": 0}

# 笔记切块口径与 knowledge 一致：父子块默认参数（子 600/父 1800/overlap 80），
# 不再单独特例——note 与 knowledge 同一套写入结构

_listener_registered = False  # 同 autotag：监听挂全局 SessionLocal 类，重复注册会叠加触发
_backfill_started = False     # 启动回填只跑一次（lifespan 重入不重复扫库）

# BUG-P06：批量导入（500 条/批）一次 commit 触发 after_commit 逐条 spawn 线程，
# 瞬时数百线程各自建事件循环 + httpx 客户端 + 打满本机 Ollama，资源耗尽致进程
# 无日志退出。改为有界队列 + 固定 2 个 daemon worker 串行消费，并去重排队中的笔记。
_EMBED_WORKERS = 2
_embed_queue: "queue.Queue[tuple]" = queue.Queue()
_embed_queued: set = set()          # 已入队 note_id 去重（重复提交只重嵌一次）
_embed_lock = threading.Lock()
_embed_workers_started = False


def _embed_worker() -> None:
    while True:
        content_type, content_id, user_id = _embed_queue.get()
        try:
            embed_content(content_type, content_id, user_id)
        except Exception as e:  # embed_* 自身已吞异常，这里双保险护住 worker 循环
            logger.info("embedding worker error for %s/%s: %s", content_type, content_id, e)
        finally:
            # 出队标记保留到 embed 完成才移除（完成/失败都移除）：执行期间同一
            # 内容的重复入队被拒，避免同一内容并发重嵌互踩「删旧写新」事务
            with _embed_lock:
                _embed_queued.discard((content_type, content_id))
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


def _enqueue_embed(content_type: str, content_id: str, user_id: str) -> None:
    with _embed_lock:
        if (content_type, content_id) in _embed_queued:
            return
        _embed_queued.add((content_type, content_id))
    _start_embed_workers()  # 兜底：未走 register 的单测直调路径
    _embed_queue.put((content_type, content_id, user_id))


def embed_content(content_type: str, content_id: str, user_id: str = "") -> int:
    """worker 统一入口：按内容类型分发到各 embed_*（模块级分发，单测可打桩）。"""
    if content_type == "note":
        return embed_note(content_id, user_id)
    if content_type == "clip":
        return embed_clip(content_id, user_id)
    if content_type == "document":
        return embed_document(content_id, user_id)
    if content_type == "knowledge":
        return embed_knowledge(content_id, user_id)
    if content_type == "wiki":
        return embed_wiki(content_id, user_id)
    return 0


def _delete_embeddings(db: Session, content_type: str, content_id: str) -> None:
    """删掉指定内容的全部向量（整文档向量 + 块向量），并同步清影子索引。"""
    q = db.query(EmbeddingModel).filter(
        EmbeddingModel.content_type == content_type,
        (EmbeddingModel.content_id == content_id)
        | (EmbeddingModel.content_id.like(f"{content_id}{CHUNK_ID_SEP}%")),
    )
    # 开源版无 vec_index 影子索引（剥离面）：embeddings 表即唯一事实源
    q.delete(synchronize_session=False)


def _delete_note_embeddings(db: Session, note_id: str) -> None:
    """删掉笔记的全部向量（整文档向量 + 块向量），并同步清影子索引。"""
    _delete_embeddings(db, "note", note_id)


def _write_embeddings(db: Session, content_type: str, doc_id: str, uid: str, computed: list) -> None:
    """同一事务删旧写新（不含 commit）：要么整体生效，要么整体回滚，不留半截覆盖。"""
    _delete_embeddings(db, content_type, doc_id)
    for item in computed:
        emb_id = str(uuid.uuid4())
        db.add(EmbeddingModel(
            id=emb_id,
            user_id=uid,
            content_type=content_type,
            content_id=item["content_id"],
            text_preview=item["text"][:200],
            embedding_json=json.dumps(item["vec"]),
            dimensions=len(item["vec"]),
            model=item["model"],
            # 父子块元数据：短文档整文档向量的父块列为空（单父单子）
            parent_content_id=item["parent_content_id"],
            chunk_index=item["chunk_index"],
            chunk_text=item["chunk_text"],
            parent_text=item["parent_text"],
        ))
        # 开源版无 vec_index 影子索引（剥离面）：检索走 embeddings 表暴力余弦


def embed_note(note_id: str, user_id: str = "") -> int:
    """重嵌单篇笔记：先算新向量，再在同一事务里删旧写新。新增/更新/归档/删除同一入口，幂等。

    返回写入的向量条数；笔记不存在、非 active、内容为空为 0（此时仅清旧向量）。
    嵌入服务不可用（mock fallback / Ollama 挂）时不动库、旧向量原样保留——
    修复前的「先删后写」在 Ollama 挂时会删旧后写不进，向量净丢失。
    任何异常静默，绝不影响主流程。
    """
    db = SessionLocal()
    try:
        # 先取数据再提交：commit 后 ORM 属性过期，访问会隐式开新事务，
        # 与调用方共享连接时（测试 savepoint 模式）close 的回滚会吞掉后续写入
        note = db.query(Note).filter(Note.id == note_id).first()
        is_active = bool(note and note.status == "active")
        text = f"{note.title or ''}\n{note.content or ''}".strip() if note else ""
        uid = (note.user_id if note else "") or user_id
        if not is_active or not text:
            _delete_note_embeddings(db, note_id)
            db.commit()
            return 0
        # 先算后写：向量全部算好才动库；mock fallback/空向量时 computed 为空，
        # 直接返回，旧向量保留
        from app.services.chunking import compute_document_chunk_embeddings
        computed = asyncio.run(compute_document_chunk_embeddings(
            text,
            doc_id=note_id,
        ))
        if not computed:
            return 0
        # 同一事务删旧写新：要么整体生效，要么整体回滚，不留半截覆盖
        _write_embeddings(db, "note", note_id, uid, computed)
        db.commit()
        return len(computed)
    except Exception as e:
        logger.info("note embedding skipped for %s: %s", note_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        db.close()


def _clip_gate(clip) -> tuple:
    """剪藏前拦质量门（纯硬信号零模型，血泪#34）：active + 有效正文
    ≥ MIN_EMBED_TEXT_LEN 字。正文口径 = full_text（空则 excerpt），与检索端一致。
    团队内容同口径过门（09-10 起三索引支持团队空间，隔离在检索侧内容行收口）。
    返回 (是否过门, 正文)。"""
    if clip is None or clip.status != "active":
        return False, ""
    text = (clip.full_text or "").strip() or (clip.excerpt or "").strip()
    return len(text) >= MIN_EMBED_TEXT_LEN, text


def _document_gate(doc) -> tuple:
    """文档前拦质量门：doc_status='active' 且 extraction_status='success' +
    有效正文 ≥ MIN_EMBED_TEXT_LEN 字；图片文档（OCR 文本常不足 200 字）放宽到
    ≥ MIN_EMBED_TEXT_LEN_IMAGE 字。团队内容同口径过门（同 _clip_gate）。
    返回 (是否过门, 正文)。"""
    if (doc is None or doc.doc_status != "active"
            or doc.extraction_status != "success"):
        return False, ""
    text = (doc.content_text or "").strip()
    from app.services.document_service import is_image_document
    threshold = (MIN_EMBED_TEXT_LEN_IMAGE
                 if is_image_document(doc.file_path, doc.file_type)
                 else MIN_EMBED_TEXT_LEN)
    return len(text) >= threshold, text


def _log_gated(content_type: str, content_id: str) -> None:
    """被门拦下：info 计数日志留痕（前拦不告警，但要可观测）。"""
    _gated_counts[content_type] = _gated_counts.get(content_type, 0) + 1
    logger.info(
        "%s embedding 质量门前拦（累计 %d 条）: %s",
        content_type, _gated_counts[content_type], content_id,
    )


def embed_clip(clip_id: str, user_id: str = "") -> int:
    """重嵌单条剪藏：前拦质量门 → 先算后写（同 embed_note 口径），幂等。

    门结果回写 BrowserClip.embedded 标志（过门 True / 被拦或不可嵌 False）。
    返回写入的向量条数；被拦/不存在为 0（此时清旧向量）。任何异常静默。
    """
    db = SessionLocal()
    try:
        # 先取数据再提交：commit 后 ORM 属性过期（同 embed_note 注释口径）
        clip = db.query(BrowserClip).filter(BrowserClip.id == clip_id).first()
        uid = (clip.user_id if clip else "") or user_id
        ok, text = _clip_gate(clip)
        if not ok:
            _delete_embeddings(db, "clip", clip_id)
            if clip is not None and clip.embedded:
                clip.embedded = False
            db.commit()
            if clip is not None:
                _log_gated("clip", clip_id)
            return 0
        from app.services.chunking import compute_document_chunk_embeddings
        computed = asyncio.run(compute_document_chunk_embeddings(text, doc_id=clip_id))
        if not computed:
            return 0  # mock fallback：不动库，旧向量与标志保留
        _write_embeddings(db, "clip", clip_id, uid, computed)
        if not clip.embedded:
            clip.embedded = True  # 与向量同事务落库
        db.commit()
        return len(computed)
    except Exception as e:
        logger.info("clip embedding skipped for %s: %s", clip_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        db.close()


def embed_document(document_id: str, user_id: str = "") -> int:
    """重嵌单篇文档：前拦质量门（extraction success + active + 正文≥200 字，
    图片文档放宽为 ≥20 字）→ 先算后写，幂等。返回写入的向量条数；
    被拦/不存在为 0（此时清旧向量）。"""
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == document_id).first()
        uid = (doc.user_id if doc else "") or user_id
        ok, text = _document_gate(doc)
        if not ok:
            _delete_embeddings(db, "document", document_id)
            db.commit()
            if doc is not None:
                _log_gated("document", document_id)
            return 0
        from app.services.chunking import compute_document_chunk_embeddings
        computed = asyncio.run(compute_document_chunk_embeddings(text, doc_id=document_id))
        if not computed:
            return 0  # mock fallback：不动库，旧向量保留
        _write_embeddings(db, "document", document_id, uid, computed)
        db.commit()
        return len(computed)
    except Exception as e:
        logger.info("document embedding skipped for %s: %s", document_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        db.close()


def _wiki_gate(entry) -> tuple:
    """Wiki 条目前拦质量门（LLM Wiki 四期进检索基座，与各类型同口径纯硬信号）：
    status 为 fresh/stale（review 待审/orphaned 不进向量）+ 有效正文
    （标题+别名+摘要+正文）≥ MIN_EMBED_TEXT_LEN 字。返回 (是否过门, 正文)。"""
    if entry is None or entry.status not in ("fresh", "stale"):
        return False, ""
    text = f"{entry.title or ''}\n{entry.aliases or ''}\n{entry.summary or ''}\n{entry.content_md or ''}".strip()
    return len(text) >= MIN_EMBED_TEXT_LEN, text


def embed_wiki(entry_id: str, user_id: str = "") -> int:
    """重嵌单条 wiki 条目：前拦质量门 → 先算后写（同 embed_clip 口径），幂等。
    返回写入的向量条数；被拦/不存在为 0（此时清旧向量）。任何异常静默留痕。"""
    db = SessionLocal()
    try:
        from app.models.knowledge import WikiEntry
        entry = db.query(WikiEntry).filter(WikiEntry.id == entry_id).first()
        uid = (entry.user_id if entry else "") or user_id
        ok, text = _wiki_gate(entry)
        if not ok:
            _delete_embeddings(db, "wiki", entry_id)
            db.commit()
            if entry is not None:
                _log_gated("wiki", entry_id)
            return 0
        from app.services.chunking import compute_document_chunk_embeddings
        computed = asyncio.run(compute_document_chunk_embeddings(text, doc_id=entry_id))
        if not computed:
            return 0  # mock fallback：不动库，旧向量保留
        _write_embeddings(db, "wiki", entry_id, uid, computed)
        db.commit()
        return len(computed)
    except Exception as e:
        logger.info("wiki embedding skipped for %s: %s", entry_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        db.close()


def _knowledge_gate(ku) -> tuple:
    """知识单元前拦质量门（与剪藏同口径，纯硬信号零模型，血泪#34）：
    status='active' + 有效正文（content_raw，strip 后）≥ MIN_EMBED_TEXT_LEN 字。
    团队 KU 同口径过门（09-10 起三索引支持团队空间，隔离在检索侧内容行收口，
    不加 tenant 前拦）。正文口径 = content_raw（与 pipeline 嵌入/检索端一致，
    source_title 不入向量）。返回 (是否过门, 正文)。"""
    if ku is None or ku.status != "active":
        return False, ""
    text = (ku.content_raw or "").strip()
    return len(text) >= MIN_EMBED_TEXT_LEN, text


def embed_knowledge(ku_id: str, user_id: str = "") -> int:
    """重嵌单个知识单元：前拦质量门 → 先算后写（同 embed_note/embed_clip 口径），幂等。

    KU 无 embedded 回写标志（与 clip 不同，不为其加列），门结果只影响向量行本身。
    返回写入的向量条数；被拦/不存在/非 active 为 0（此时清旧向量，覆盖软删清理）。
    嵌入服务不可用（mock fallback）时不动库、旧向量保留。任何异常 warning 留痕，
    绝不影响主流程。
    """
    db = SessionLocal()
    try:
        # 先取数据再提交：commit 后 ORM 属性过期（同 embed_note 注释口径）
        ku = db.query(KnowledgeUnit).filter(KnowledgeUnit.id == ku_id).first()
        uid = (ku.user_id if ku else "") or user_id
        ok, text = _knowledge_gate(ku)
        if not ok:
            _delete_embeddings(db, "knowledge", ku_id)
            db.commit()
            if ku is not None:
                _log_gated("knowledge", ku_id)
            return 0
        from app.services.chunking import compute_document_chunk_embeddings
        computed = asyncio.run(compute_document_chunk_embeddings(text, doc_id=ku_id))
        if not computed:
            return 0  # mock fallback：不动库，旧向量保留
        _write_embeddings(db, "knowledge", ku_id, uid, computed)
        db.commit()
        return len(computed)
    except Exception as e:
        logger.warning("knowledge embedding skipped for %s: %s", ku_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
    finally:
        db.close()


def backfill_missing_note_embeddings(batch_limit: int = 200) -> int:
    """一次性回填：给缺少向量覆盖的 active 笔记补 embed，返回处理条数。

    幂等：判存口径 = 该笔记实际嵌入块数 == 预期分块数（块向量归属回 {doc_id}
    基 id，预期数由 chunking.expected_chunk_count 按统一父子块口径算）。
    逐块嵌入中断留下的部分覆盖会被判为未覆盖并重嵌——只看基 id 存在
    （第 0 块在就跳过）会把半截文档判成已覆盖、永远不再回填。
    单次最多 batch_limit 条防大库启动雪崩，未补完的下轮启动继续。
    """
    db = SessionLocal()
    try:
        actual: dict = {}
        for row in db.query(EmbeddingModel.content_id).filter(
            EmbeddingModel.content_type == "note"
        ).all():
            if is_question_chunk_id(row[0] or ""):
                continue  # Doc2Query 问题行不计入向量覆盖判存（独立命名空间附属行）
            base = (row[0] or "").split(CHUNK_ID_SEP, 1)[0]
            actual[base] = actual.get(base, 0) + 1
        # 会话关闭前取纯值，避免 DetachedInstanceError；text 口径与 embed_note 一致
        notes = [
            (n.id, n.user_id, f"{n.title or ''}\n{n.content or ''}".strip())
            for n in db.query(Note).filter(Note.status == "active").all()
        ]
    except Exception as e:
        logger.info("note embedding backfill scan failed: %s", e)
        return 0
    finally:
        db.close()

    missing = []
    for note_id, user_id, text in notes:
        expected = expected_chunk_count(text)
        if expected > 0 and actual.get(note_id, 0) != expected:
            missing.append((note_id, user_id))
        if len(missing) >= batch_limit:
            break

    for note_id, user_id in missing:
        embed_note(note_id, user_id)
    if missing:
        logger.info("note embedding backfill: %d notes processed", len(missing))
    return len(missing)


def backfill_missing_clip_doc_embeddings(batch_limit: int = 2000) -> int:
    """启动一次性回填：给缺向量覆盖的存量剪藏/文档补 embed，返回处理条数。

    幂等判存口径与笔记一致（实际嵌入块数 == expected_chunk_count 预期分块数，
    部分覆盖判未覆盖重嵌）；候选即过门集合（active + 正文≥200 字、图片文档
    ≥20 字，个人/团队同口径——团队内容也进向量，document 另要
    extraction_status='success'）——
    过不了门的存量不算缺失，其 embedded 标志维持默认 False。单次最多
    batch_limit 条防大库启动雪崩。
    """
    db = SessionLocal()
    try:
        actual = {"clip": {}, "document": {}}
        for ctype, cid in db.query(
            EmbeddingModel.content_type, EmbeddingModel.content_id
        ).filter(EmbeddingModel.content_type.in_(("clip", "document"))).all():
            if is_question_chunk_id(cid or ""):
                continue  # Doc2Query 问题行不计入向量覆盖判存
            base = (cid or "").split(CHUNK_ID_SEP, 1)[0]
            actual[ctype][base] = actual[ctype].get(base, 0) + 1
        # 会话关闭前取纯值（DetachedInstanceError 防）；text 口径与门一致
        clips = [
            (c.id, c.user_id, (c.full_text or "").strip() or (c.excerpt or "").strip())
            for c in db.query(BrowserClip).filter(
                BrowserClip.status == "active"
            ).all()
        ]
        docs = [
            (d.id, d.user_id, (d.content_text or "").strip(), d.file_path, d.file_type)
            for d in db.query(Document).filter(
                Document.doc_status == "active",
                Document.extraction_status == "success",
            ).all()
        ]
    except Exception as e:
        logger.info("clip/document embedding backfill scan failed: %s", e)
        return 0
    finally:
        db.close()

    missing = []
    from app.services.document_service import is_image_document
    for ctype, rows in (("clip", clips), ("document", docs)):
        for row in rows:
            if len(missing) >= batch_limit:
                break
            content_id, uid, text = row[0], row[1], row[2]
            # 门内才算「应有向量」；图片文档与 _document_gate 同口径放宽到 20 字
            threshold = MIN_EMBED_TEXT_LEN
            if ctype == "document" and is_image_document(row[3], row[4]):
                threshold = MIN_EMBED_TEXT_LEN_IMAGE
            if len(text) < threshold:
                continue
            expected = expected_chunk_count(text)
            if expected > 0 and actual[ctype].get(content_id, 0) != expected:
                missing.append((ctype, content_id, uid))

    for ctype, content_id, uid in missing:
        embed_content(ctype, content_id, uid)
    if missing:
        logger.info("clip/document embedding backfill: %d rows processed", len(missing))
    return len(missing)


def backfill_missing_knowledge_embeddings(batch_limit: int = 200) -> int:
    """启动一次性回填：给缺向量覆盖的存量知识单元补 embed，返回处理条数（血泪#43）。

    幂等判存口径与笔记/剪藏一致（实际嵌入块数 == expected_chunk_count 预期
    分块数，逐块中断留下的部分覆盖判未覆盖重嵌）；候选即过门集合
    （status='active' + 正文 ≥ MIN_EMBED_TEXT_LEN 字，个人/团队同口径）——
    过不了门的存量不算缺失。pipeline 时代已嵌向量的 KU 块结构与本服务一致，
    判存兼容不会重复补。单次最多 batch_limit 条防大库启动雪崩，未补完的
    下轮启动继续。
    """
    db = SessionLocal()
    try:
        actual: dict = {}
        for row in db.query(EmbeddingModel.content_id).filter(
            EmbeddingModel.content_type == "knowledge"
        ).all():
            if is_question_chunk_id(row[0] or ""):
                continue  # Doc2Query 问题行不计入向量覆盖判存
            base = (row[0] or "").split(CHUNK_ID_SEP, 1)[0]
            actual[base] = actual.get(base, 0) + 1
        # 会话关闭前取纯值，避免 DetachedInstanceError；text 口径与 _knowledge_gate 一致
        units = [
            (u.id, u.user_id, (u.content_raw or "").strip())
            for u in db.query(KnowledgeUnit).filter(KnowledgeUnit.status == "active").all()
        ]
    except Exception as e:
        logger.warning("knowledge embedding backfill scan failed: %s", e)
        return 0
    finally:
        db.close()

    missing = []
    for ku_id, uid, text in units:
        if len(text) < MIN_EMBED_TEXT_LEN:
            continue  # 门外的存量不算缺失（与 clip/document 回填同口径）
        expected = expected_chunk_count(text)
        if expected > 0 and actual.get(ku_id, 0) != expected:
            missing.append((ku_id, uid))
        if len(missing) >= batch_limit:
            break

    for ku_id, uid in missing:
        embed_knowledge(ku_id, uid)
    if missing:
        logger.info("knowledge embedding backfill: %d units processed", len(missing))
    return len(missing)


def backfill_missing_wiki_embeddings(batch_limit: int = 200) -> int:
    """启动一次性回填：给缺向量覆盖的存量 wiki 条目（fresh/stale）补 embed
    （LLM Wiki 四期进检索基座）。幂等判存口径与其余类型一致（实际嵌入块数
    == expected_chunk_count）；候选即过门集合（_wiki_gate 同口径正文）。
    单次最多 batch_limit 条防大库启动雪崩。"""
    from app.models.knowledge import WikiEntry
    db = SessionLocal()
    try:
        actual: dict = {}
        for row in db.query(EmbeddingModel.content_id).filter(
            EmbeddingModel.content_type == "wiki"
        ).all():
            if is_question_chunk_id(row[0] or ""):
                continue  # Doc2Query 问题行不计入向量覆盖判存
            base = (row[0] or "").split(CHUNK_ID_SEP, 1)[0]
            actual[base] = actual.get(base, 0) + 1
        # 会话关闭前取纯值，避免 DetachedInstanceError；text 口径与 _wiki_gate 一致
        entries = [
            (e.id, e.user_id,
             f"{e.title or ''}\n{e.aliases or ''}\n{e.summary or ''}\n{e.content_md or ''}".strip())
            for e in db.query(WikiEntry).filter(WikiEntry.status.in_(("fresh", "stale"))).all()
        ]
    except Exception as e:
        logger.warning("wiki embedding backfill scan failed: %s", e)
        return 0
    finally:
        db.close()

    missing = []
    for entry_id, uid, text in entries:
        if len(text) < MIN_EMBED_TEXT_LEN:
            continue
        expected = expected_chunk_count(text)
        if expected > 0 and actual.get(entry_id, 0) != expected:
            missing.append((entry_id, uid))
        if len(missing) >= batch_limit:
            break

    for entry_id, uid in missing:
        embed_wiki(entry_id, uid)
    if missing:
        logger.info("wiki embedding backfill: %d entries processed", len(missing))
    return len(missing)


def start_backfill_once() -> None:
    """监听就绪后启动时后台跑一次存量回填（幂等守卫：lifespan 重入不重复跑）。"""
    global _backfill_started
    if _backfill_started:
        return
    _backfill_started = True

    def _run() -> None:
        backfill_missing_note_embeddings()
        backfill_missing_clip_doc_embeddings()
        backfill_missing_knowledge_embeddings()
        backfill_missing_wiki_embeddings()

    threading.Thread(target=_run, daemon=True).start()


_dim_migration_started = False  # 启动迁移只跑一次（lifespan 重入不重复）


def start_dimension_migration_once() -> None:
    """嵌入模型换代迁移：存量向量维度与当前模型维度不一致时后台全量重嵌。

    触发场景：bge-m3（1024d）替换旧版 768d 嵌入模型后首次启动。
    混杂期检索端有混维守卫（暴力路异维返 0、物理图只留多数维），
    迁移走现有「先算后写、删旧写新」单条路径，逐条天然幂等；
    模型不可用（mock）时不迁——防 mock 维度（896）污染整库。
    """
    global _dim_migration_started
    if _dim_migration_started:
        return
    _dim_migration_started = True

    def _run() -> None:
        from sqlalchemy import func as _func
        db = SessionLocal()
        try:
            top = (
                db.query(EmbeddingModel.dimensions, _func.count())
                .group_by(EmbeddingModel.dimensions)
                .order_by(_func.count().desc())
                .first()
            )
            if not top:
                return  # 空库无迁移
            majority_dim = int(top[0])
            from app.services.embedding_service import embedding_service
            probe = asyncio.run(embedding_service.embed("维度探测"))
            if probe.get("model_used", "").startswith("mock"):
                logger.warning("嵌入模型不可用（mock），跳过维度迁移（存量 %sd 保留）", majority_dim)
                return
            current_dim = int(probe["dimensions"])
            if current_dim == majority_dim:
                return
            logger.warning(
                "嵌入模型换代迁移启动：存量 %sd → 当前 %sd（模型 %s），后台全量重嵌",
                majority_dim, current_dim, embedding_service.model,
            )
        finally:
            db.close()

        from app.models.base import KnowledgeUnit as _KU
        from app.services.knowledge_dedup import reembed_unit
        db = SessionLocal()
        try:
            migrated = 0
            for ctype, model in (("note", Note), ("clip", BrowserClip), ("document", Document)):
                for (cid,) in db.query(model.id).all():
                    try:
                        embed_content(ctype, cid)
                        migrated += 1
                    except Exception as e:
                        logger.info("维度迁移跳过 %s/%s: %s", ctype, cid, e)
            for ku in db.query(_KU).filter(_KU.status == "active").all():
                try:
                    asyncio.run(reembed_unit(ku))
                    migrated += 1
                except Exception as e:
                    logger.info("维度迁移跳过 knowledge/%s: %s", ku.id, e)
            logger.warning("嵌入模型换代迁移完成：处理 %d 条", migrated)
        finally:
            db.close()

    threading.Thread(target=_run, daemon=True, name="embed-dim-migration").start()


def register_note_embedding_listener() -> None:
    """挂写入监听：笔记/剪藏/文档/知识单元新增、更新、删除提交后后台重嵌向量。

    幂等：注册在全局 SessionLocal 类上且从不移除，lifespan 重入
    （测试里每个 TestClient 一次）不得重复挂，否则一次提交触发 N 次重嵌。
    与 autotag / graphify 自进化监听互不干扰（各自独立线程、独立会话）。
    剪藏/文档/知识单元的 dirty 捕获带字段级去抖：只有影响向量口径的字段
    （正文/状态/租户）变了才重嵌——worker 回写 clip.embedded 标志本身也是
    一次 dirty 提交，不去抖会无限自我触发；KU 侧同理，检索命中回写
    invoke_count/last_invoked_at、核验流水改 verification_* 都是高频 dirty，
    不去抖会把每次检索命中都变成一次全量重嵌（血泪#43）。
    """
    global _listener_registered
    if _listener_registered:
        return
    _listener_registered = True

    # worker 随注册启动（真实 threading 环境），见 _start_embed_workers 注释
    _start_embed_workers()

    from sqlalchemy import event, inspect as _sa_inspect

    from app.models.knowledge import WikiEntry

    _type_of = {Note: "note", BrowserClip: "clip", Document: "document",
                KnowledgeUnit: "knowledge", WikiEntry: "wiki"}
    # 影响向量口径的字段：dirty 时这些字段没变就不重嵌（notes 无自反馈字段，
    # 维持原口径任何 dirty 都重嵌）
    _watched_fields = {
        "clip": ("full_text", "excerpt", "status", "tenant_id"),
        "document": ("content_text", "doc_status", "extraction_status", "tenant_id"),
        # KU：检索命中回写 invoke_count/last_invoked_at、核验流水等都是高频
        # dirty，只有正文/状态/租户变化才值得重嵌
        "knowledge": ("content_raw", "status", "tenant_id"),
        # wiki 条目：验证流水（verification_*）与 compile_cost 等高频回写不触发，
        # 只有内容口径字段变才重嵌
        "wiki": ("title", "aliases", "summary", "content_md", "status", "tenant_id"),
    }

    _pending: dict = {}

    @event.listens_for(SessionLocal, "before_flush")
    def _capture(session, flush_context, instances) -> None:
        # 捕获点必须在 before_flush 不能是 before_commit（10-01 实捕）：删除端点
        # 提交前经 recycle 快照 db.flush()，flush 后对象变 clean、session.dirty
        # 清空——before_commit 捕获不到 → 软删残留向量/索引。before_flush 时
        # new/dirty/deleted 齐全（这正是 flush 的依据），一事务多次 flush 幂等
        # 累计（pending 按 (ctype,id) 键去重），回滚由 after_rollback 丢弃。
        # 先认 session.new（全局 autoflush=False，此刻还没落库）
        ids = {}
        for obj in list(session.new) + list(session.dirty) + list(session.deleted):
            ctype = _type_of.get(obj.__class__)
            if not ctype or not getattr(obj, "id", None):
                continue
            watched = _watched_fields.get(ctype)
            if watched and obj in session.dirty and obj not in session.new:
                # 字段级去抖：dirty 但向量口径字段未变（如 worker 回写 embedded
                # 标志、改标题/标签）不重嵌；history 不触发 lazy load（已加载属性）
                insp = _sa_inspect(obj)
                if not any(insp.attrs[f].history.has_changes() for f in watched):
                    continue
            ids[(ctype, obj.id)] = getattr(obj, "user_id", "") or ""
        if ids:
            _pending.setdefault(id(session), {}).update(ids)

    @event.listens_for(SessionLocal, "after_commit")
    def _on_commit(session) -> None:
        ids = _pending.pop(id(session), None)
        if not ids:
            return
        for (ctype, content_id), user_id in ids.items():
            _enqueue_embed(ctype, content_id, user_id)

    @event.listens_for(SessionLocal, "after_rollback")
    def _on_rollback(session) -> None:
        # 回滚同样消费 pending，否则 before_flush 捕获的条目泄漏到下次提交
        _pending.pop(id(session), None)


def start(app) -> None:
    """启动钩子：笔记向量化监听 + 存量回填 + 维度迁移。

    从 app.main 的 lifespan 抽出（零行为变化搬运，注释随代码走）。
    """
    # 笔记向量化（BUG-R02）：事件驱动（笔记新增/更新/删除 after_commit → 后台重嵌）
    register_note_embedding_listener()
    # 存量回填：监听就绪后后台补嵌缺向量覆盖的 active 笔记（幂等，每次启动只跑一轮）
    start_backfill_once()
    # 嵌入模型换代迁移：存量向量维度与当前模型不一致（如旧版 768d → bge-m3 1024d）
    # 时后台全量重嵌；一致时零成本空转。嵌入模型状态行（含未安装自动降级的过渡提示）
    from app.services.embedding_service import embedding_service as _es
    logging.getLogger(__name__).info("嵌入模型状态：%s（%s）", _es.model, {
        True: "已安装", False: "未安装，将落 mock 兜底", None: "可用性未探测",
    }.get(_es.model_available))
    start_dimension_migration_once()
