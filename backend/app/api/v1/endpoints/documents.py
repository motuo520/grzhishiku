import os
import uuid
import shutil
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.tenant_scope import get_active_tenant
from app.models.base import User, Document
from app.schemas.document import DocumentResponse, DocumentSaveToKnowledgeRequest, DocumentUpdateRequest
from app.services import document_service, tag_service

router = APIRouter()
logger = logging.getLogger(__name__)


class BatchDocumentDelete(BaseModel):
    # 批量删除上限 500 条：超出直接 422，避免单次请求打爆库
    ids: List[str] = Field(..., max_length=500)


def _build_response(doc: Document, db: Session) -> dict:
    return {
        "id": doc.id,
        "user_id": doc.user_id,
        "title": doc.title,
        "original_name": doc.original_name,
        "file_path": doc.file_path,
        "file_size": doc.file_size,
        "file_type": doc.file_type,
        "content_text": doc.content_text,
        "extraction_status": doc.extraction_status,
        "extraction_error": doc.extraction_error,
        "doc_status": doc.doc_status,
        "knowledge_id": doc.knowledge_id,
        "brain_side": doc.brain_side,
        "folder_id": doc.folder_id,
        "index_only": bool(doc.index_only),
        # 标签随响应下发（09-11 文档纳入自动打标）：与 clips 的 _build_clip_response 同口径
        "tags": tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_DOCUMENT, doc.id),
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
    }


@router.get("/", response_model=List[DocumentResponse], summary="List documents")
async def list_documents(
    file_type: Optional[str] = Query(None),
    extraction_status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    brain_side: Optional[str] = Query(None, description="Filter by brain side: personal / network / both"),
    folder_id: Optional[str] = Query(None, description="Filter by folder id; 'none' = 未归档"),
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    docs = document_service.list_documents(
        db, current_user, file_type=file_type, extraction_status=extraction_status, q=q,
        brain_side=brain_side, folder_id=folder_id, skip=skip, limit=limit
    )
    return [_build_response(d, db) for d in docs]


@router.post("/", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED, summary="Upload document")
async def upload_document(
    file: UploadFile = File(...),
    title: Optional[str] = Query(None),
    index_only: bool = Query(False, description="仓库模式：只进检索层（RAG 可答），不进图谱/打标/复盘"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    filename = file.filename or "unknown"
    # 展示名也只留 basename（正反斜杠都剥——穿越名不该进 original_name 落库）
    display_name = os.path.basename(filename.replace("\\", "/")) or "unknown"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in document_service.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}，请上传 {', '.join(document_service.ALLOWED_EXTENSIONS)} 文件"
        )

    # 开源本地版只有本机部署形态：云端水位/单文件上限护栏不适用（桌面端口径，本地磁盘自负）
    cloud = False
    MAX_CLOUD_FILE_BYTES = 20 * 1024 * 1024

    upload_dir = "uploads/_temp_documents"
    os.makedirs(upload_dir, exist_ok=True)
    # 文件名必须净化——原始名可含 ../ 穿越出 uploads/ 覆盖白名单后缀文件
    # （requirements.txt 等；10-01 审计诱饵实捕，create_document 随后 move 不留痕）
    temp_name = f"{uuid.uuid4()}_{document_service._get_safe_filename(filename)}"
    temp_path = os.path.join(upload_dir, temp_name)

    try:
        written = 0
        with open(temp_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 256)  # async 读：别在事件循环上同步拉盘（09-30 安全批）
                if not chunk:
                    break
                written += len(chunk)
                if cloud and written > MAX_CLOUD_FILE_BYTES:
                    raise HTTPException(status_code=400, detail="单文件超过 20MB，请使用桌面端本地处理大文件")
                buffer.write(chunk)
    except HTTPException:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise
    except Exception:
        # 09-30 安全批：临时文件不残留（磁盘满/IO 错同样清理）；异常详情只进日志
        if os.path.exists(temp_path):
            os.remove(temp_path)
        logger.warning("保存上传文件失败: %s", file.filename)
        raise HTTPException(status_code=400, detail="保存上传文件失败")
    finally:
        await file.close()

    # 09-30 安全批 deferred⑧：文档字节计入用户存储配额（此前文档完全不记账——
    # 100MB 免费档只罩 notes/clips，文档是无配额后门）。先查再建，建成原子扣账
    from app.services.quota_service import QuotaService
    quota = QuotaService(db)
    _file_bytes = os.path.getsize(temp_path)
    quota.check_storage_before_create(current_user.id, _file_bytes)
    try:
        # 抽取是重 CPU 同步活（PDF 三遍全页扫描/xlsx DOM 展开），挪出事件循环——
        # 单 worker 云端一个毒文件同步解析就是全站 DoS（09-30 安全批）
        from fastapi.concurrency import run_in_threadpool
        doc = await run_in_threadpool(
            document_service.create_document,
            db, current_user, temp_path, display_name, file.content_type, _file_bytes, title,
            index_only,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("处理上传文件失败: %s", filename)
        raise HTTPException(status_code=400, detail="处理文件失败")

    quota.record_storage_add(current_user.id, _file_bytes)
    return _build_response(doc, db)


@router.get("/{document_id}", response_model=DocumentResponse, summary="Get document")
async def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = document_service.get_document(db, current_user, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _build_response(doc, db)


@router.post("/{document_id}/extract", response_model=DocumentResponse, summary="Re-extract document text")
async def reextract_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 与上传同口径：重抽取同样是重 CPU 同步活，挪出事件循环（09-30 安全批）
    from fastapi.concurrency import run_in_threadpool
    doc = await run_in_threadpool(document_service.reextract_document, db, current_user, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _build_response(doc, db)


@router.put("/{document_id}", response_model=DocumentResponse, summary="Update document", description="手动归档：写 folder_id（显式 null=移出文件夹）。口径B：文档只手动归档，不进规则引擎。文本类文档（md/txt）在线编辑：title/content 改的是标题与 content_text 抽取文本层，原始上传文件不动；content 变化后重走重索引链（FTS + 向量 + 自动打标）。")
async def update_document(
    document_id: str,
    request: DocumentUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    doc = document_service.get_document(db, current_user, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # folder_id 显式传了才处理（含显式 null = 移出文件夹，未归档）；校验同笔记/剪藏口径
    # 团队上下文归档到团队夹合法（脑侧校验仅个人空间生效）
    if "folder_id" in request.model_fields_set:
        if request.folder_id is not None:
            from app.api.v1.endpoints.folders import validate_folder_assignment
            validate_folder_assignment(db, current_user.id, doc.brain_side or "personal", request.folder_id, tenant=tenant)
        doc.folder_id = request.folder_id
    # 在线编辑（title/content 任一在场）：只放行文本类文档，PDF/DOCX 等 400
    edit_requested = ("title" in request.model_fields_set and request.title is not None) or \
        ("content" in request.model_fields_set and request.content is not None)
    if edit_requested and not document_service.is_text_document(doc.file_type):
        raise HTTPException(status_code=400, detail="仅支持文本类文档（md/txt）在线编辑")
    if request.index_only is not None:
        # 仓库模式开关（09-19）：切回 false 随打标兜底扫描/下次建图自然回归语义层
        doc.index_only = request.index_only
    content_changed = False
    title_changed = False
    if "title" in request.model_fields_set and request.title is not None:
        title_changed = request.title != (doc.title or "")
        doc.title = request.title
    if "content" in request.model_fields_set and request.content is not None:
        content_changed = request.content != (doc.content_text or "")
        doc.content_text = request.content
        # file_size 与文本层同步（原始文件字节数已不代表内容体量）
        doc.file_size = len(request.content.encode("utf-8"))
    doc.updated_at = datetime.now()
    # 先提交主表（sync_content 回表取最新状态；commit 会 expire 实例，标量提前取）
    doc_id, doc_user_id = doc.id, doc.user_id
    db.commit()
    if content_changed:
        # 向量重嵌（幂等，先算后写、被门拦清旧向量；自开 SessionLocal，须在 commit 后调）
        # 开源版无 FTS 索引与自动打标服务，正文变更只重嵌向量
        from app.services.note_embedding_service import embed_document
        embed_document(doc_id, current_user.id)
    db.refresh(doc)
    return _build_response(doc, db)


# 路由顺序铁律（血泪 #10）：/batch 必须注册在 /{document_id} 的 DELETE 之前，否则被路径参数抢路由
@router.delete("/batch", response_model=dict, summary="Batch delete documents")
async def batch_delete_documents(
    request: BatchDocumentDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 复用 service 单删语义（空间口径过滤 + doc_status 软删，物理文件保留）；
    # 不属于当前空间的 id 静默跳过（幂等：不报错，只少删）
    deleted = 0
    for document_id in request.ids:
        if document_service.delete_document(db, current_user, document_id):
            deleted += 1
    return {"deleted": deleted}


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete document")
async def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not document_service.delete_document(db, current_user, document_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return None


@router.post("/{document_id}/save-to-knowledge", response_model=dict, summary="Save document as knowledge unit")
async def save_to_knowledge(
    document_id: str,
    request: DocumentSaveToKnowledgeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = document_service.get_document(db, current_user, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    knowledge_id = document_service.save_to_knowledge(db, current_user, doc, request.tag_ids)
    return {"success": True, "knowledge_id": knowledge_id}
