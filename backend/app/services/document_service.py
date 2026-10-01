import logging
import os
import shutil
import threading
import uuid
import re
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.base import Document, User, KnowledgeUnit
from app.services import tag_service
from app.core.xss_sanitizer import sanitize_knowledge_input
from app.core.tenant_scope import get_active_tenant, scope_condition

logger = logging.getLogger(__name__)


def _get_safe_filename(filename: str) -> str:
    """Remove path components and sanitize filename."""
    base = os.path.basename(filename)
    base = re.sub(r"[^\w\-\.\u4e00-\u9fa5]", "_", base)
    return base


def _extract_text_from_txt(file_path: str) -> str:
    encodings = ["utf-8", "gbk", "gb2312", "latin-1"]
    for enc in encodings:
        try:
            # strict 探测，避免 errors=replace 让 utf-8 假成功导致 GBK 中文乱码
            with open(file_path, "r", encoding=enc, errors="strict") as f:
                return f.read()
        except UnicodeDecodeError:
            continue
        except Exception:
            continue
    # 最终兜底：损坏文件用 replace 避免崩溃
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _extract_text_from_pdf(file_path: str) -> str:
    # 开源版无 document_ocr（Docling/表格结构还原属剥离面）：直走 pypdf 文字层
    try:
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        parts = []
        for page in reader.pages:
            try:
                text = page.extract_text()
                if text:
                    parts.append(text)
            except Exception:
                continue
        return "\n".join(parts)
    except Exception as e:
        raise RuntimeError(f"PDF 提取失败: {e}") from e


def _norm_cell_text(value) -> str:
    """表格单元格文本归一：换行→空格、竖线→／（全角），防冲破 Markdown 管道表结构。

    数值不做任何格式化/四舍五入——str() 原样保留浮点存储痕迹（46.09999），保真优先。
    """
    text = str(value)
    text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    return text.replace("|", "／").strip()


def _docx_table_to_md(table) -> List[str]:
    """DOCX 表格 → Markdown 管道表：第一行作表头，单元格文本 = 各段落 join 后 strip。"""
    rows = table.rows
    if not rows:
        return []
    header = [_norm_cell_text(c.text) for c in rows[0].cells]
    width = len(header)
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * width]
    for row in rows[1:]:
        cells = [_norm_cell_text(c.text) for c in row.cells]
        # 宽度对齐表头（合并单元格会缺列/重复，缺补空、多截断）
        cells = (cells + [""] * width)[:width]
        lines.append("| " + " | ".join(cells) + " |")
    return lines


def _zip_uncompressed_size(file_path: str) -> int:
    """zip 容器（xlsx/docx）解压后总大小（infolist 元数据，不解压本体）。"""
    import zipfile
    try:
        with zipfile.ZipFile(file_path) as zf:
            return sum(i.file_size for i in zf.infolist())
    except zipfile.BadZipFile:
        return 0


# 09-30 安全批：xlsx/docx 是 zip——高重复 XML 可压到 20MB 解压出 GB 级，
# DOM 展开再打爆进程内存（崩溃-重启循环=持久 DoS）。解析前用元数据估解压尺寸
_OFFICE_MAX_UNCOMPRESSED = 200 * 1024 * 1024  # 200MB


def _extract_text_from_docx(file_path: str) -> str:
    try:
        if _zip_uncompressed_size(file_path) > _OFFICE_MAX_UNCOMPRESSED:
            raise RuntimeError("DOCX 解压后体积过大（疑似压缩炸弹），已拒绝解析")
        from docx import Document
        from docx.oxml.ns import qn
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        doc = Document(file_path)
        parts = []
        # 按 body 子元素顺序遍历：段落与表格混排保持原文顺序。旧口径只取
        # doc.paragraphs，表格整个丢弃——RAG 召回缺陷的根修
        for child in doc.element.body.iterchildren():
            if child.tag == qn("w:p"):
                text = Paragraph(child, doc).text.strip()
                if text:
                    parts.append(text)
            elif child.tag == qn("w:tbl"):
                parts.extend(_docx_table_to_md(Table(child, doc)))
        return "\n".join(parts)
    except Exception as e:
        raise RuntimeError(f"DOCX 提取失败: {e}") from e


def _extract_text_from_xlsx(file_path: str) -> str:
    try:
        if _zip_uncompressed_size(file_path) > _OFFICE_MAX_UNCOMPRESSED:
            raise RuntimeError("XLSX 解压后体积过大（疑似压缩炸弹），已拒绝解析")
        from contextlib import closing
        from openpyxl import load_workbook
        # 血泪实证：read_only 模式的 cell 拿不到 comment（批注整个丢失），
        # 必须用普通模式；closing 保证 workbook 句柄关闭，防批量解析泄漏
        with closing(load_workbook(file_path, data_only=True)) as wb:
            parts = []
            for sheet in wb.worksheets:
                rows = []  # 非空行的单元格文本列表（尾部全空单元格已修剪）
                for row in sheet.iter_rows():
                    cells = []
                    for cell in row:
                        if cell.value is None:
                            cells.append("")
                            continue
                        text = _norm_cell_text(cell.value)
                        if cell.comment is not None:
                            comment = _norm_cell_text(cell.comment.text or "")
                            if comment:
                                text = f"{text}（批注：{comment}）"
                        cells.append(text)
                    while cells and not cells[-1]:
                        cells.pop()
                    if cells:
                        rows.append(cells)
                if not rows:
                    continue  # 空工作表整个跳过
                # 章节标题：让下游 row:: 条目带上工作表前缀
                parts.append(f"## 工作表：{sheet.title}")
                # 表头判定：第一个「≥2 个非空单元格」的行；之前的标题/说明行按纯文本原样输出
                header_idx = next(
                    (i for i, r in enumerate(rows) if sum(1 for c in r if c) >= 2), None)
                if header_idx is None:
                    # 没有够格的表头行（如单列清单）：不硬造管道表，按纯文本行输出
                    parts.extend(" ".join(c for c in r if c) for r in rows)
                    continue
                for r in rows[:header_idx]:
                    parts.append(" ".join(c for c in r if c))
                header = rows[header_idx]
                width = len(header)
                parts.append("| " + " | ".join(header) + " |")
                parts.append("|" + "---|" * width)
                for r in rows[header_idx + 1:]:
                    r = (r + [""] * width)[:width]
                    parts.append("| " + " | ".join(r) + " |")
            return "\n".join(parts)
    except Exception as e:
        raise RuntimeError(f"XLSX 提取失败: {e}") from e


def _extract_text_from_pptx(file_path: str) -> str:
    try:
        from pptx import Presentation
        prs = Presentation(file_path)
        parts = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text:
                    parts.append(shape.text)
        return "\n".join(parts)
    except Exception as e:
        raise RuntimeError(f"PPTX 提取失败: {e}") from e


def _extract_text_from_html(file_path: str) -> str:
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            html = f.read()
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text
    except Exception as e:
        raise RuntimeError(f"HTML 提取失败: {e}") from e


def extract_text(file_path: str, file_type: Optional[str] = None) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    if file_type:
        file_type = file_type.lower()

    if ext in (".txt",) or file_type in ("text/plain",):
        return _extract_text_from_txt(file_path)
    if ext in (".md", ".markdown") or file_type in ("text/markdown",):
        return _extract_text_from_txt(file_path)
    # csv/log/json 无独立解析器：本质都是文本，复用 txt 路径原样读出
    if ext in (".csv", ".log", ".json"):
        return _extract_text_from_txt(file_path)
    if ext == ".pdf" or file_type in ("application/pdf",):
        return _extract_text_from_pdf(file_path)
    if ext == ".docx" or file_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ):
        return _extract_text_from_docx(file_path)
    if ext in (".xlsx", ".xls") or file_type in (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ):
        return _extract_text_from_xlsx(file_path)
    if ext == ".pptx" or file_type in (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ):
        return _extract_text_from_pptx(file_path)
    if ext in (".html", ".htm") or file_type in ("text/html",):
        return _extract_text_from_html(file_path)

    raise ValueError(f"不支持的文件格式: {ext}")


# ── 扫描件 PDF / 图片后台 OCR ────────────────────────────────────
# 口径：文字层优先（请求内同步抽完秒回）；存在缺文字页的 PDF 状态保持
# pending，后台线程跑 OCR 合并进 content_text 后翻 success——after_commit
# 嵌入监听自然触发，向量前拦门（success + 正文≥200 字）无需任何改动。
# 上传不等待 OCR，小扫描件也一律走后台，不做同步快路径（口径统一）。
# 图片文件（jpg/png/webp/bmp）没有文字层，OCR 是唯一提取手段：一律走
# 「pending + 后台 OCR」；OCR 未启用时落 error「OCR 未启用」——不能像 PDF
# 那样降级成 success 空文本（没有文字层兜底，空 success 是假装成功）。

_ocr_inflight: set = set()  # 正在 OCR 的文档 id（幂等闸门）
_ocr_inflight_lock = threading.Lock()


def _trigger_autotag(user_id: Optional[str]) -> None:
    """开源版无 autotag_service（剥离面）：保留接口形态的空操作。"""
    return


def _prepare_pdf_ocr(doc: Document) -> bool:
    """开源版无 document_ocr（剥离面）：PDF 只走文字层提取，缺文字页不做 OCR。"""
    return False


def _prepare_image_ocr(doc: Document) -> bool:
    """开源版无 document_ocr（剥离面）：图片文档无 OCR 提取手段，落 error 不假装成功。"""
    doc.extraction_status = "error"
    doc.extraction_error = "图片文档需要 OCR 提取文字，开源本地版未包含 OCR 组件"
    return False


def _schedule_ocr_background(document_id: str, file_path: str) -> bool:
    """开源版无 document_ocr（剥离面）：永不拉起后台 OCR。"""
    return False


def _md_tables_marker_done(db: Session) -> bool:
    from app.models.base import SystemConfig
    row = db.query(SystemConfig).filter(SystemConfig.key == _MD_TABLES_MARKER_KEY).first()
    return bool(row and row.value_json)


def backfill_md_table_documents(session_factory=None) -> bool:
    """存量 xlsx/docx 重抽取回填（同步可直接调用，测试不等线程）。

    自开 Session——绝不用请求会话。逐文档失败 warning 继续（血泪#10：
    吞异常必留痕）；文件磁盘缺失 warning 跳过且不计失败（云端/桌面文件
    可能在清理后不在）。返回是否全部成功——True 才落 marker，False 留待
    下轮启动重试。重打标不用（已有标签仍然有效）。
    """
    from app.core.database import SessionLocal
    from app.models.base import SystemConfig
    from app.services import note_embedding_service

    owns_session = session_factory is None
    sf = session_factory or SessionLocal
    db = sf()
    try:
        if _md_tables_marker_done(db):
            return True
        docs = db.query(Document).filter(Document.extraction_status == "success").all()
        targets = [
            d for d in docs
            if os.path.splitext(d.file_path or "")[1].lower() in (".xlsx", ".docx")
        ]
        failed = 0
        updated = 0
        for doc in targets:
            doc_id, user_id = doc.id, doc.user_id  # commit 会 expire 实例，标量先取
            try:
                if not doc.file_path or not os.path.exists(doc.file_path):
                    logger.warning(
                        "表格文本层迁移：文档 %s 文件磁盘缺失（%s），跳过不计失败",
                        doc_id, doc.file_path)
                    continue
                new_text = extract_text(doc.file_path, doc.file_type)
                if new_text == (doc.content_text or ""):
                    continue  # 抽取结果无变化：不动索引
                doc.content_text = new_text
                doc.updated_at = datetime.now()
                db.commit()
                # 向量重嵌（embed_document 自开 Session，必须在 commit 后调）；
                # 开源版无 fts_index（剥离面），只重嵌向量
                note_embedding_service.embed_document(doc_id, user_id)
                updated += 1
            except Exception as e:
                logger.warning(
                    "表格文本层迁移：文档 %s 重抽取失败: %s", doc_id, e, exc_info=True)
                try:
                    db.rollback()
                except Exception:
                    pass
                failed += 1
        if failed == 0:
            db.add(SystemConfig(
                id=str(uuid.uuid4()), key=_MD_TABLES_MARKER_KEY, value_json="true"))
            db.commit()
            logger.info(
                "表格文本层迁移完成：%d 篇重抽取，marker %s 落库", updated, _MD_TABLES_MARKER_KEY)
            return True
        logger.warning(
            "表格文本层迁移：%d 篇失败，marker 不落库，留待下次启动重试", failed)
        return False
    except Exception as e:
        # 血泪规矩：后台线程的异常必须吞，但必须 warning 留痕
        logger.warning("表格文本层迁移扫描失败: %s", e, exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        if owns_session:
            db.close()


def initialize_extract_md_tables_backfill() -> None:
    """启动钩子：延迟 ~120s 后台跑一次存量迁移（参照 autotag 兜底扫描的
    boot 120s 口径，让启动主链路先就绪）；lifespan 每 TestClient 触发一次，防重复挂载。"""
    global _md_backfill_started
    if _md_backfill_started:
        return
    _md_backfill_started = True

    def _run() -> None:
        import time
        time.sleep(120)
        backfill_md_table_documents()

    threading.Thread(target=_run, name="extract-md-tables-backfill", daemon=True).start()


ALLOWED_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".pdf", ".docx", ".xlsx", ".xls", ".pptx", ".html", ".htm",
    ".jpg", ".jpeg", ".png", ".webp", ".bmp",  # 图片：无文字层，走后台 OCR
}

# 图片格式子集（向量门放宽、后台 OCR 分发等场景共用判定）
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# 文本类文档（在线编辑只放行这类）：file_type 落库的是上传 MIME 或后缀（create_document
# 的 file_type or ext），大小写不敏感，两种形态都认
TEXT_DOCUMENT_TYPES = {
    ".md", ".markdown", ".txt", "md", "markdown", "txt",
    "text/plain", "text/markdown", "text/x-markdown",
}


def is_text_document(file_type: Optional[str]) -> bool:
    """文本类文档判定（md/txt）：按 doc.file_type 判定，大小写不敏感。"""
    return (file_type or "").strip().lower() in TEXT_DOCUMENT_TYPES


def is_image_document(file_path: Optional[str], file_type: Optional[str]) -> bool:
    """图片文档判定：文件后缀命中 IMAGE_EXTENSIONS，或 MIME 为 image/*。"""
    ext = os.path.splitext(file_path or "")[1].lower()
    if ext in IMAGE_EXTENSIONS:
        return True
    return (file_type or "").lower().startswith("image/")


def create_document(
    db: Session,
    user: User,
    uploaded_file_path: str,
    original_name: str,
    file_type: Optional[str] = None,
    file_size: int = 0,
    title: Optional[str] = None,
    index_only: bool = False,
) -> Document:
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"不支持的文件格式: {ext}")

    safe_name = _get_safe_filename(original_name)
    unique_name = f"{uuid.uuid4()}_{safe_name}"
    upload_dir = "uploads/documents"
    os.makedirs(upload_dir, exist_ok=True)
    dest_path = os.path.join(upload_dir, unique_name)
    shutil.move(uploaded_file_path, dest_path)

    tenant = get_active_tenant(db, user)
    doc = Document(
        id=str(uuid.uuid4()),
        user_id=user.id,
        # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
        tenant_id=tenant.id if tenant else None,
        title=title or safe_name,
        original_name=original_name,
        file_path=dest_path,
        file_size=file_size,
        file_type=file_type or ext,
        content_text=None,
        extraction_status="pending",
        doc_status="active",
        index_only=bool(index_only),  # 仓库模式（09-19）：导入时可直设
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Extract text asynchronously-like (in same request for simplicity)
    needs_ocr = False
    if is_image_document(dest_path, file_type):
        # 图片无文字层：OCR 是唯一提取手段，走「pending + 后台 OCR」
        needs_ocr = _prepare_image_ocr(doc)
    else:
        try:
            content = extract_text(dest_path, file_type)
            doc.content_text = content
            doc.extraction_status = "success"
            # 扫描件兜底：缺文字页 → 状态翻 pending，后台 OCR 合并后翻 success
            needs_ocr = _prepare_pdf_ocr(doc)
        except Exception as e:
            doc.extraction_status = "error"
            doc.extraction_error = str(e)

    doc.updated_at = datetime.now()
    db.commit()
    db.refresh(doc)
    if needs_ocr:
        # 必须在 commit 之后拉线程：后台用独立 Session，行没落库它读不到
        # （开源版 _schedule_ocr_background 是空操作，needs_ocr 恒 False 不会走到）
        _schedule_ocr_background(doc.id, doc.file_path)
    elif doc.extraction_status == "success":
        # 开源版无 autotag（剥离面）：_trigger_autotag 是空操作
        _trigger_autotag(doc.user_id)
    return doc


def reextract_document(db: Session, user: User, document_id: str) -> Optional[Document]:
    doc = get_document(db, user, document_id)
    if not doc:
        return None
    needs_ocr = False
    if is_image_document(doc.file_path, doc.file_type):
        # 「重新提取」图片 = 重跑后台 OCR（含 OCR 未启用时落 error 的口径）
        needs_ocr = _prepare_image_ocr(doc)
    else:
        try:
            content = extract_text(doc.file_path, doc.file_type)
            doc.content_text = content
            doc.extraction_status = "success"
            doc.extraction_error = None
            # 「重新提取」同样触发扫描件 OCR 重跑（含缺文字页后台合并）
            needs_ocr = _prepare_pdf_ocr(doc)
        except Exception as e:
            doc.extraction_status = "error"
            doc.extraction_error = str(e)
    doc.updated_at = datetime.now()
    db.commit()
    db.refresh(doc)
    if needs_ocr:
        # commit 后拉线程；若已有 OCR 在跑，_schedule_ocr_background 幂等跳过
        _schedule_ocr_background(doc.id, doc.file_path)
    elif doc.extraction_status == "success":
        # 「重新提取」出新正文：重打自动标签（只碰无标签口径，已打标的不动）
        _trigger_autotag(doc.user_id)
    return doc


def list_documents(
    db: Session,
    user: User,
    file_type: Optional[str] = None,
    extraction_status: Optional[str] = None,
    q: Optional[str] = None,
    brain_side: Optional[str] = None,
    folder_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Document]:
    from sqlalchemy import or_
    from app.models.base import Folder
    from app.core.tenant_scope import content_filter, content_visible_condition
    tenant = get_active_tenant(db, user)
    query = db.query(Document).filter(
        scope_condition(Document, user.id, tenant),
        Document.doc_status == "active"
    )
    # 目录级权限（批 C）：不可见夹内文档不进列表（个人空间恒真条件，零变化）
    query = query.filter(content_visible_condition(db, Document, user, tenant))
    # 脑侧/未归档口径与 notes 列表一致（文档进树：手动归档，09-10）
    if brain_side and brain_side != "both" and not folder_id:
        query = query.filter(Document.brain_side.in_([brain_side, "both"]))
    if folder_id == "none":
        # 未归档（按查看脑 P）：doc.brain_side ∈ {P,'both'} 且（folder_id 为空 或 文件夹不属 P 脑）
        p = brain_side if brain_side in ("personal", "network") else "personal"
        own_folder_ids = content_filter(
            db.query(Folder.id).filter(Folder.brain_side == p), Folder, user, tenant
        )
        query = query.filter(Document.brain_side.in_([p, "both"]))
        query = query.filter(or_(Document.folder_id.is_(None), ~Document.folder_id.in_(own_folder_ids)))
    elif folder_id:
        query = query.filter(Document.folder_id == folder_id)
    if file_type:
        query = query.filter(Document.file_type.ilike(f"%{file_type}%"))
    if extraction_status:
        query = query.filter(Document.extraction_status == extraction_status)
    if q:
        search = f"%{q}%"
        query = query.filter(
            Document.title.ilike(search)
            | Document.original_name.ilike(search)
            | Document.content_text.ilike(search)
        )
    return query.order_by(Document.created_at.desc()).offset(skip).limit(limit).all()


def get_document(db: Session, user: User, document_id: str) -> Optional[Document]:
    from app.core.tenant_scope import content_visible_condition
    tenant = get_active_tenant(db, user)
    return db.query(Document).filter(
        Document.id == document_id,
        scope_condition(Document, user.id, tenant),
        Document.doc_status == "active",
        # 目录级权限（批 C）：不可见夹内文档按不存在处理（详情/更新/删除共用本查询）
        content_visible_condition(db, Document, user, tenant),
    ).first()


def delete_document(db: Session, user: User, document_id: str) -> bool:
    doc = get_document(db, user, document_id)
    if not doc:
        return False
    doc.doc_status = "deleted"
    # 删除连带清派生关联（与 notes/knowledge/clips 删除同口径，此前全漏实捕）：
    # 标签关联 + 图谱边，防孤儿标签/幽灵图节点
    tag_service.delete_tags_for(db, "document", doc.id)
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, doc.id)
    db.commit()
    # 09-30 安全批 deferred⑧：删除同步释放配额记账（负差原子 UPDATE）
    try:
        from app.services.quota_service import QuotaService
        QuotaService(db).record_storage_add(user.id, -(doc.file_size or 0))
    except Exception:
        db.rollback()  # 记账失败不回滚删除本身，只留痕
        import logging
        logging.getLogger(__name__).warning("文档删除配额记账失败 doc=%s", document_id)
    # Optionally delete file physically; keep for now to avoid accidental loss
    return True


def save_to_knowledge(db: Session, user: User, doc: Document, tag_ids: Optional[List[str]] = None) -> str:
    content = doc.content_text or ""
    safe_content, _, safe_title = sanitize_knowledge_input(
        content,
        None,
        doc.title or doc.original_name or "(无标题)"
    )

    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=user.id,
        # KU 继承文档的脑侧（09-10 口径B 补充：随 folder_id 一起快照继承，之后不联动）
        brain_side=doc.brain_side or 'network',
        content_raw=safe_content,
        content_type='document',
        title=safe_title,  # 09-16 单元自身标题
        source_url=f"/uploads/{doc.file_path}" if doc.file_path else None,
        source_title=safe_title,
        source_type='document',
        source_author=None,
        source_publish_date=None,
        verification_status='unverified',
        trust_level='tentative',
        verification_history='[]',
        # 与来源文档同空间：团队文档转出的知识单元也归团队
        tenant_id=doc.tenant_id,
        # KU 继承文档的归档位置（09-10 口径B）：继承后不联动——
        # 删文档不影响 KU，挪 KU 不动文档
        folder_id=doc.folder_id,
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)

    if tag_ids:
        # 标签落到文档所属空间（团队文档 → 团队标签）
        from app.models.base import Tenant
        tenant = db.query(Tenant).filter(Tenant.id == doc.tenant_id).first() if doc.tenant_id else None
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
            content_id=unit.id,
            user_id=user.id,
            tag_inputs=tag_ids,
            tenant=tenant,
        )
        db.commit()
        db.refresh(unit)

    try:
        from app.api.v1.endpoints.graph import auto_link_knowledge
        auto_link_knowledge(db, unit, user.id)
        db.commit()
    except Exception as e:
        print(f"Auto-link failed for document knowledge {unit.id}: {e}")

    doc.doc_status = "imported_to_knowledge"
    doc.knowledge_id = unit.id
    db.commit()

    return unit.id
