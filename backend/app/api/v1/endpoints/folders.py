from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel as PydanticBaseModel, Field
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, Note, Folder, KnowledgeUnit

router = APIRouter()


def validate_folder_assignment(db: Session, user_id: str, brain_side: str, folder_id: str) -> Folder:
    """归档归属校验（笔记/知识单元共用）：personal 内容只能进 personal 文件夹，network 同理，both 可进任一脑。"""
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.user_id == user_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if brain_side != "both" and folder.brain_side != brain_side:
        side_label = {"personal": "个人", "network": "网络"}.get(brain_side, brain_side)
        folder_label = {"personal": "个人", "network": "网络"}.get(folder.brain_side, folder.brain_side)
        raise HTTPException(status_code=400, detail=f"{side_label}脑内容不能归档到{folder_label}脑的文件夹")
    return folder


class FolderCreate(PydanticBaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="文件夹名（1-100 字）")
    brain_side: str = Field(..., pattern="^(personal|network)$", description="所属脑：personal / network")
    parent_id: Optional[str] = Field(None, description="父文件夹 id，空=根级")
    sort_order: int = Field(0, description="排序权重")


class FolderUpdate(PydanticBaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="新名称")
    parent_id: Optional[str] = Field(None, description="新父文件夹 id，显式传 null 表示移到根级")
    sort_order: Optional[int] = Field(None, description="排序权重")


def _get_own_folder(db: Session, folder_id: str, user_id: str) -> Folder:
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.user_id == user_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    return folder


def _validate_parent(db: Session, user_id: str, brain_side: str, parent_id: Optional[str]) -> None:
    """父文件夹必须存在且同属该用户该脑。"""
    if parent_id is None:
        return
    parent = db.query(Folder).filter(Folder.id == parent_id, Folder.user_id == user_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="父文件夹不存在")
    if parent.brain_side != brain_side:
        raise HTTPException(status_code=400, detail="父文件夹不属于该脑，无法在此下创建/移动")


def _is_self_or_descendant(db: Session, user_id: str, root_id: str, candidate_id: str) -> bool:
    """沿 candidate 的父链上溯，命中 root 即成环（candidate 是 root 自身或其后代）。"""
    current = candidate_id
    while current:
        if current == root_id:
            return True
        f = db.query(Folder).filter(Folder.id == current, Folder.user_id == user_id).first()
        current = f.parent_id if f else None
    return False


def _folder_item(folder: Folder, note_count: int, knowledge_count: int) -> dict:
    return {
        "id": folder.id,
        "user_id": folder.user_id,
        "brain_side": folder.brain_side,
        "parent_id": folder.parent_id,
        "name": folder.name,
        "sort_order": folder.sort_order or 0,
        "note_count": note_count,
        "knowledge_count": knowledge_count,
        "created_at": folder.created_at,
        "updated_at": folder.updated_at,
    }


def _content_counts(db: Session, user_id: str) -> tuple:
    """各文件夹直属笔记数 / 知识单元数（与各自列表同口径：笔记 active、KU 非 deleted）。"""
    note_counts = dict(db.query(Note.folder_id, func.count(Note.id)).filter(
        Note.user_id == user_id, Note.status == "active", Note.folder_id.isnot(None)
    ).group_by(Note.folder_id).all())
    ku_counts = dict(db.query(KnowledgeUnit.folder_id, func.count(KnowledgeUnit.id)).filter(
        KnowledgeUnit.user_id == user_id, KnowledgeUnit.status != "deleted", KnowledgeUnit.folder_id.isnot(None)
    ).group_by(KnowledgeUnit.folder_id).all())
    return note_counts, ku_counts


@router.get("/", summary="List folders", description="返回指定脑的全部文件夹 flat 列表（含直属笔记数），树由前端组装。")
async def list_folders(
    brain_side: str = Query(..., pattern="^(personal|network)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folders = db.query(Folder).filter(
        Folder.user_id == current_user.id, Folder.brain_side == brain_side
    ).order_by(Folder.sort_order, Folder.created_at).all()
    note_counts, ku_counts = _content_counts(db, current_user.id)
    return [_folder_item(f, note_counts.get(f.id, 0), ku_counts.get(f.id, 0)) for f in folders]


@router.post("/", status_code=201, summary="Create folder", description="在指定脑下创建文件夹（可指定父级）。")
async def create_folder(
    data: FolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _validate_parent(db, current_user.id, data.brain_side, data.parent_id)
    folder = Folder(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=data.brain_side,
        parent_id=data.parent_id,
        name=data.name,
        sort_order=data.sort_order,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _folder_item(folder, 0, 0)


@router.put("/{folder_id}", summary="Update folder", description="重命名 / 移动（防环）/ 调排序。")
async def update_folder(
    folder_id: str,
    data: FolderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_own_folder(db, folder_id, current_user.id)
    if data.name is not None:
        folder.name = data.name
    # parent_id 显式传了才处理（含传 null 移到根级）
    if "parent_id" in data.model_fields_set and data.parent_id != folder.parent_id:
        if data.parent_id is not None:
            _validate_parent(db, current_user.id, folder.brain_side, data.parent_id)
            if _is_self_or_descendant(db, current_user.id, folder.id, data.parent_id):
                raise HTTPException(status_code=400, detail="不能将文件夹移动到自身或其子文件夹下")
        folder.parent_id = data.parent_id
    if data.sort_order is not None:
        folder.sort_order = data.sort_order
    folder.updated_at = datetime.now()
    db.commit()
    db.refresh(folder)
    note_counts, ku_counts = _content_counts(db, current_user.id)
    return _folder_item(folder, note_counts.get(folder.id, 0), ku_counts.get(folder.id, 0))


@router.delete("/{folder_id}", summary="Delete folder", description="删除文件夹：子文件夹与其中笔记/知识单元上提到被删文件夹的父级（父级为空则到根/未归档）。")
async def delete_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_own_folder(db, folder_id, current_user.id)
    # 子文件夹上提到被删文件夹的父级
    db.query(Folder).filter(Folder.user_id == current_user.id, Folder.parent_id == folder.id).update(
        {"parent_id": folder.parent_id}, synchronize_session=False
    )
    # 其中笔记与知识单元上提；父级为空则 folder_id=NULL（未归档）
    db.query(Note).filter(Note.user_id == current_user.id, Note.folder_id == folder.id).update(
        {"folder_id": folder.parent_id}, synchronize_session=False
    )
    db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.folder_id == folder.id).update(
        {"folder_id": folder.parent_id}, synchronize_session=False
    )
    db.delete(folder)
    db.commit()
    return {"success": True}
