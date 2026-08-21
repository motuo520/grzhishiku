from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, ReadLaterItem
from app.schemas.read_later import (
    ReadLaterCreate,
    ReadLaterUpdate,
    ReadLaterResponse,
    ReadLaterSaveToKnowledgeRequest,
)
from app.services import read_later_service, tag_service

router = APIRouter()


class BatchItemDelete(BaseModel):
    # 批量删除上限 500 条：超出直接 422，避免单次请求打爆库
    ids: List[str] = Field(..., max_length=500)


def _build_response(item: ReadLaterItem, db: Session) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "title": item.title,
        "url": item.url,
        "domain": item.domain,
        "excerpt": item.excerpt,
        "full_text": item.full_text,
        "cover_image": item.cover_image,
        "status": item.status,
        "is_favorite": item.is_favorite,
        "read_progress": item.read_progress,
        "source": item.source,
        "item_status": item.item_status,
        "knowledge_id": item.knowledge_id,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


@router.get("/items", response_model=List[ReadLaterResponse], summary="List read later items")
async def list_items(
    status: Optional[str] = Query(None),
    is_favorite: Optional[bool] = Query(None),
    q: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    items = read_later_service.list_items(
        db, current_user, status=status, is_favorite=is_favorite, q=q, skip=skip, limit=limit
    )
    return [_build_response(i, db) for i in items]


@router.post("/items", response_model=ReadLaterResponse, status_code=status.HTTP_201_CREATED, summary="Add read later item")
async def create_item(
    data: ReadLaterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 防重：同用户已有相同 URL 的未归档条目则冲突提示（批量导入/重复添加不产重复）
    _dup = db.query(ReadLaterItem).filter(
        ReadLaterItem.user_id == current_user.id, ReadLaterItem.url == data.url, ReadLaterItem.item_status == "active"
    ).first()
    if _dup:
        raise HTTPException(status_code=409, detail="该链接已在稍后读列表中")
    item = read_later_service.create_item(
        db, current_user,
        url=data.url,
        title=data.title,
        excerpt=data.excerpt,
        source=data.source or "manual",
    )
    return _build_response(item, db)


@router.get("/items/{item_id}", response_model=ReadLaterResponse, summary="Get read later item")
async def get_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    item = read_later_service.get_item(db, current_user, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _build_response(item, db)


@router.put("/items/{item_id}", response_model=ReadLaterResponse, summary="Update read later item")
async def update_item(
    item_id: str,
    data: ReadLaterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    item = read_later_service.update_item(db, current_user, item_id, data.model_dump(exclude_unset=True))
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _build_response(item, db)


# 路由顺序铁律（血泪 #10）：/items/batch 必须注册在 /items/{item_id} 的 DELETE 之前，否则被路径参数抢路由
@router.delete("/items/batch", response_model=dict, summary="Batch delete read later items")
async def batch_delete_items(
    request: BatchItemDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 复用 service 单删语义（空间口径过滤 + item_status 软删）；
    # 不属于当前空间的 id 静默跳过（幂等：不报错，只少删）
    deleted = 0
    for item_id in request.ids:
        if read_later_service.delete_item(db, current_user, item_id):
            deleted += 1
    return {"deleted": deleted}


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete read later item")
async def delete_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not read_later_service.delete_item(db, current_user, item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    return None


@router.post("/items/{item_id}/fetch-content", response_model=ReadLaterResponse, summary="Fetch full content from URL")
async def fetch_content(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    item = read_later_service.fetch_full_content(db, current_user, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _build_response(item, db)


@router.post("/items/{item_id}/save-to-knowledge", response_model=dict, summary="Save read later item as knowledge unit")
async def save_to_knowledge(
    item_id: str,
    request: ReadLaterSaveToKnowledgeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    item = read_later_service.get_item(db, current_user, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    knowledge_id = read_later_service.save_to_knowledge(db, current_user, item, request.tag_ids)
    return {"success": True, "knowledge_id": knowledge_id}
