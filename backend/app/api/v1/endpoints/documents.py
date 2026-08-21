import logging
import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, Document
from app.schemas.document import DocumentResponse, DocumentSaveToKnowledgeRequest
from app.services import document_service, tag_service

router = APIRouter()

logger = logging.getLogger(__name__)


def _build_response(doc: Document) -> dict:
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
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
    }


@router.get("/", response_model=List[DocumentResponse], summary="List documents")
async def list_documents(
    file_type: Optional[str] = Query(None),
    extraction_status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    docs = document_service.list_documents(
        db, current_user, file_type=file_type, extraction_status=extraction_status, q=q, skip=skip, limit=limit
    )
    return [_build_response(d) for d in docs]


@router.post("/", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED, summary="Upload document")
async def upload_document(
    file: UploadFile = File(...),
    title: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in document_service.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}，请上传 {', '.join(document_service.ALLOWED_EXTENSIONS)} 文件"
        )

    upload_dir = "uploads/_temp_documents"
    os.makedirs(upload_dir, exist_ok=True)
    temp_name = f"{uuid.uuid4()}_{filename}"
    temp_path = os.path.join(upload_dir, temp_name)

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception:
        logger.exception(f"Failed to save uploaded file {filename}")
        raise HTTPException(status_code=400, detail="保存上传文件失败，请查看服务端日志")
    finally:
        await file.close()

    try:
        doc = document_service.create_document(
            db, current_user, temp_path, filename, file_type=file.content_type, file_size=os.path.getsize(temp_path), title=title
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Failed to process uploaded file {filename}")
        raise HTTPException(status_code=400, detail="处理文件失败，请查看服务端日志")

    return _build_response(doc)


@router.get("/{document_id}", response_model=DocumentResponse, summary="Get document")
async def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = document_service.get_document(db, current_user, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _build_response(doc)


@router.post("/{document_id}/extract", response_model=DocumentResponse, summary="Re-extract document text")
async def reextract_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = document_service.reextract_document(db, current_user, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return _build_response(doc)


# 路由顺序铁律（血泪 #10）：/batch 必须注册在 /{document_id} 的 DELETE 之前，否则被路径参数抢路由
class BatchDocumentDelete(BaseModel):
    # 批量删除上限 500 条：超出直接 422，避免单次请求打爆库
    ids: List[str] = Field(..., max_length=500)


@router.delete("/batch", response_model=dict, summary="Batch delete documents")
async def batch_delete_documents(
    request: BatchDocumentDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 复用 service 单删语义（user_id 口径 + doc_status 软删，物理文件保留）；
    # 不属于当前用户的 id 静默跳过（幂等：不报错，只少删）
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
