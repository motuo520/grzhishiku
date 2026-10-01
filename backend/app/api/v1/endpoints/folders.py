from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel as PydanticBaseModel, Field
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.tenant_scope import (
    get_active_tenant, content_filter, audit as _audit, invisible_folder_ids,
)
from app.models.base import User, Note, Folder, KnowledgeUnit, BrowserClip, Document

router = APIRouter()


def validate_folder_assignment(db: Session, user_id: str, brain_side: str, folder_id: str, tenant=None) -> Folder:
    """归档归属校验（笔记/知识单元共用，按空间口径）：
    团队上下文只接受该租户的文件夹（不校验脑侧——脑侧是个人空间概念）；
    个人上下文照旧：本人文件夹 + personal 内容只能进 personal 夹，network 同理，both 任意。
    目录级权限（10-01 批 C）：目标夹对操作者不可见 → 403（不可见即不可写入）。"""
    if tenant is not None:
        folder = db.query(Folder).filter(Folder.id == folder_id, Folder.tenant_id == tenant.id).first()
        if not folder:
            raise HTTPException(status_code=404, detail="文件夹不存在")
        if folder.id in invisible_folder_ids(db, db.get(User, user_id), tenant):
            raise HTTPException(status_code=403, detail="目标文件夹对你不可见，无法归档")
        return folder
    folder = db.query(Folder).filter(
        Folder.id == folder_id, Folder.user_id == user_id, Folder.tenant_id.is_(None)
    ).first()
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
    # 自动归档规则：{"tags": [...], "subtypes": [...], "verification": [...]}；传 {} 清空规则
    auto_rules: Optional[dict] = Field(None, description="自动归档规则（夹内 OR）；空对象=清除")


def _get_own_folder(db: Session, folder_id: str, user: User, tenant) -> Folder:
    """按空间口径取文件夹：团队上下文限该租户（全员可操作），个人上下文限本人且 tenant_id 为空。"""
    folder = content_filter(db.query(Folder).filter(Folder.id == folder_id), Folder, user, tenant).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    return folder


def _validate_parent(db: Session, user: User, brain_side: str, parent_id: Optional[str], tenant) -> None:
    """父文件夹必须存在且同属该空间该脑。"""
    if parent_id is None:
        return
    parent = content_filter(db.query(Folder).filter(Folder.id == parent_id), Folder, user, tenant).first()
    if not parent:
        raise HTTPException(status_code=404, detail="父文件夹不存在")
    if parent.brain_side != brain_side:
        raise HTTPException(status_code=400, detail="父文件夹不属于该脑，无法在此下创建/移动")
    # 层级限三层（根→子→孙）：父夹有祖父即父夹已是第二层，其下再建即第四层。
    # 树管「放在哪」不管分类法，深层归类是标签档夹的活（08-19 拍板）。
    if parent.parent_id is not None:
        grandparent = content_filter(db.query(Folder).filter(Folder.id == parent.parent_id), Folder, user, tenant).first()
        if grandparent and grandparent.parent_id is not None:
            raise HTTPException(status_code=400, detail="文件夹最多三层（根/子/孙），更细的归类请用标签")

def _is_self_or_descendant(db: Session, user: User, root_id: str, candidate_id: str, tenant) -> bool:
    """沿 candidate 的父链上溯，命中 root 即成环（candidate 是 root 自身或其后代）。
    团队夹的父链可能跨创建者，上溯按空间口径取（不能限 user_id）。"""
    current = candidate_id
    while current:
        if current == root_id:
            return True
        f = content_filter(db.query(Folder).filter(Folder.id == current), Folder, user, tenant).first()
        current = f.parent_id if f else None
    return False


def _subtree_height(db: Session, user: User, root_id: str, tenant) -> int:
    """root 子树的最大高度（根=1）。用于移动时校验：新父链深度 + 子树高度 ≤ 3。"""
    height = 1
    frontier = [root_id]
    while frontier:
        children = [r[0] for r in content_filter(
            db.query(Folder.id).filter(Folder.parent_id.in_(frontier)), Folder, user, tenant).all()]
        if not children:
            break
        height += 1
        frontier = children
    return height


def _folder_item(folder: Folder, note_count: int, knowledge_count: int, clip_count: int = 0, document_count: int = 0) -> dict:
    import json as _json
    try:
        rules = _json.loads(folder.auto_rules) if folder.auto_rules else None
        if not isinstance(rules, dict):
            rules = None
    except (ValueError, TypeError):
        rules = None
    return {
        "id": folder.id,
        "user_id": folder.user_id,
        "tenant_id": folder.tenant_id,
        "brain_side": folder.brain_side,
        "parent_id": folder.parent_id,
        "name": folder.name,
        "sort_order": folder.sort_order or 0,
        "auto_rules": rules,
        "visibility": folder.visibility or "inherit",  # 10-01 目录级权限：树图标用（inherit/private/restricted）
        "note_count": note_count,
        "knowledge_count": knowledge_count,
        "clip_count": clip_count,
        "document_count": document_count,
        "created_at": folder.created_at,
        "updated_at": folder.updated_at,
    }


def _content_counts(db: Session, user: User, tenant) -> tuple:
    """各文件夹直属笔记数 / 知识单元数 / 剪藏数 / 文档数（与各自列表同口径：active/非 deleted；
    团队上下文统计全空间内容，个人上下文限本人）。"""
    from app.core.tenant_scope import scope_condition
    note_counts = dict(db.query(Note.folder_id, func.count(Note.id)).filter(
        scope_condition(Note, user.id, tenant), Note.status == "active", Note.folder_id.isnot(None)
    ).group_by(Note.folder_id).all())
    ku_counts = dict(db.query(KnowledgeUnit.folder_id, func.count(KnowledgeUnit.id)).filter(
        scope_condition(KnowledgeUnit, user.id, tenant), KnowledgeUnit.status != "deleted", KnowledgeUnit.folder_id.isnot(None)
    ).group_by(KnowledgeUnit.folder_id).all())
    clip_counts = dict(db.query(BrowserClip.folder_id, func.count(BrowserClip.id)).filter(
        scope_condition(BrowserClip, user.id, tenant), BrowserClip.status == "active", BrowserClip.folder_id.isnot(None)
    ).group_by(BrowserClip.folder_id).all())
    # 文档进树（09-10 口径B）：直属文档数同口径（doc_status=active）
    doc_counts = dict(db.query(Document.folder_id, func.count(Document.id)).filter(
        scope_condition(Document, user.id, tenant), Document.doc_status == "active", Document.folder_id.isnot(None)
    ).group_by(Document.folder_id).all())
    return note_counts, ku_counts, clip_counts, doc_counts


@router.get("/", summary="List folders", description="返回指定脑的全部文件夹 flat 列表（含直属笔记数），树由前端组装。团队上下文返回团队夹。")
async def list_folders(
    brain_side: str = Query(..., pattern="^(personal|network)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    folders = content_filter(db.query(Folder), Folder, current_user, tenant).filter(
        Folder.brain_side == brain_side
    ).order_by(Folder.sort_order, Folder.created_at).all()
    # 目录级权限（批 C）：本人不可见的夹不进树（个人空间恒空集，零变化）
    inv = invisible_folder_ids(db, current_user, tenant)
    if inv:
        folders = [f for f in folders if f.id not in inv]
    note_counts, ku_counts, clip_counts, doc_counts = _content_counts(db, current_user, tenant)
    return [_folder_item(f, note_counts.get(f.id, 0), ku_counts.get(f.id, 0), clip_counts.get(f.id, 0), doc_counts.get(f.id, 0)) for f in folders]


@router.post("/", status_code=201, summary="Create folder", description="在指定脑下创建文件夹（可指定父级）。团队上下文创建为团队夹（全员可见）。")
async def create_folder(
    data: FolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    _validate_parent(db, current_user, data.brain_side, data.parent_id, tenant)
    folder = Folder(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=data.brain_side,
        parent_id=data.parent_id,
        name=data.name,
        sort_order=data.sort_order,
        # 团队上下文：文件夹 tenant_id=激活租户，user_id 仍记创建者
        tenant_id=tenant.id if tenant else None,
    )
    db.add(folder)
    # 租户审计：团队空间的文件夹创建记流水（个人空间不记）
    if tenant:
        _audit(db, tenant.id, current_user, "folder_create", "folder", folder.id, folder.name)
    db.commit()
    db.refresh(folder)
    return _folder_item(folder, 0, 0)


@router.post("/seed-defaults", summary="Seed default folders", description="两脑各建一套默认目录树（收集箱/进行中/长线深耕/素材参考/封存）。幂等：某脑已有文件夹则跳过该脑。")
async def seed_default_folders_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.folder_service import seed_default_folders
    tenant = get_active_tenant(db, current_user)
    created = seed_default_folders(db, current_user.id, tenant.id if tenant else None)
    return {"ok": True, "created": created}


@router.put("/{folder_id}", summary="Update folder", description="重命名 / 移动（防环）/ 调排序。")
async def update_folder(
    folder_id: str,
    data: FolderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    folder = _get_own_folder(db, folder_id, current_user, tenant)
    renamed = data.name is not None
    if renamed:
        folder.name = data.name
    # parent_id 显式传了才处理（含传 null 移到根级）
    moved = False
    if "parent_id" in data.model_fields_set and data.parent_id != folder.parent_id:
        if data.parent_id is not None:
            _validate_parent(db, current_user, folder.brain_side, data.parent_id, tenant)
            if _is_self_or_descendant(db, current_user, folder.id, data.parent_id, tenant):
                raise HTTPException(status_code=400, detail="不能将文件夹移动到自身或其子文件夹下")
            # 子树高度随移动一起走：新父深度 + 子树高度不得超过三层
            parent = content_filter(db.query(Folder).filter(Folder.id == data.parent_id), Folder, current_user, tenant).first()
            parent_depth = 1
            cur = parent.parent_id if parent else None
            while cur:
                parent_depth += 1
                pf = content_filter(db.query(Folder).filter(Folder.id == cur), Folder, current_user, tenant).first()
                cur = pf.parent_id if pf else None
            if parent_depth + _subtree_height(db, current_user, folder.id, tenant) > 3:
                raise HTTPException(status_code=400, detail="移动后子树超过三层上限，请先调整子文件夹")
        folder.parent_id = data.parent_id
        moved = True
    if data.sort_order is not None:
        folder.sort_order = data.sort_order
    # 自动归档规则：显式传了才处理（{} = 清除规则，夹退回用户领地）
    if "auto_rules" in data.model_fields_set:
        import json as _json
        folder.auto_rules = _json.dumps(data.auto_rules, ensure_ascii=False) if data.auto_rules else None
    folder.updated_at = datetime.now()
    # 租户审计：团队空间的文件夹重命名/移动记流水（个人空间不记）
    if tenant and (renamed or moved):
        _audit(db, tenant.id, current_user, "folder_update", "folder", folder.id, folder.name)
    db.commit()
    db.refresh(folder)
    note_counts, ku_counts, clip_counts, doc_counts = _content_counts(db, current_user, tenant)
    return _folder_item(folder, note_counts.get(folder.id, 0), ku_counts.get(folder.id, 0), clip_counts.get(folder.id, 0), doc_counts.get(folder.id, 0))


@router.delete("/{folder_id}", summary="Delete folder", description="删除文件夹：子文件夹与其中笔记/知识单元上提到被删文件夹的父级（父级为空则到根/未归档）。")
async def delete_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.core.tenant_scope import scope_condition
    tenant = get_active_tenant(db, current_user)
    folder = _get_own_folder(db, folder_id, current_user, tenant)
    # 子文件夹上提到被删文件夹的父级（团队夹的子夹可能跨创建者，按空间口径更新）
    db.query(Folder).filter(
        scope_condition(Folder, current_user.id, tenant), Folder.parent_id == folder.id
    ).update({"parent_id": folder.parent_id}, synchronize_session=False)
    # 其中笔记、知识单元、剪藏与文档上提；父级为空则 folder_id=NULL（未归档）。团队夹内内容跨创建者，同按空间口径
    db.query(Note).filter(
        scope_condition(Note, current_user.id, tenant), Note.folder_id == folder.id
    ).update({"folder_id": folder.parent_id}, synchronize_session=False)
    db.query(KnowledgeUnit).filter(
        scope_condition(KnowledgeUnit, current_user.id, tenant), KnowledgeUnit.folder_id == folder.id
    ).update({"folder_id": folder.parent_id}, synchronize_session=False)
    db.query(BrowserClip).filter(
        scope_condition(BrowserClip, current_user.id, tenant), BrowserClip.folder_id == folder.id
    ).update({"folder_id": folder.parent_id}, synchronize_session=False)
    db.query(Document).filter(
        scope_condition(Document, current_user.id, tenant), Document.folder_id == folder.id
    ).update({"folder_id": folder.parent_id}, synchronize_session=False)
    # 租户审计：团队空间的文件夹删除（含子级上提）记流水（个人空间不记）
    if tenant:
        _audit(db, tenant.id, current_user, "folder_delete", "folder", folder.id, folder.name)
    db.delete(folder)
    db.commit()
    return {"success": True}


# ---------------------------------------------------------------------------
# 目录级权限管理（10-01 立项批 C）：visibility 设置 + 授权清单读取。
# 仅团队空间有意义；判定规则单点在 tenant_scope（本文件不另造规则）。
# ---------------------------------------------------------------------------

class FolderShareIn(PydanticBaseModel):
    grantee_type: str = Field(..., pattern="^(user|group)$", description="授权对象类型：user / group")
    grantee_id: str = Field(..., min_length=1, description="授权对象 id（用户 id 或分组 id）")


class FolderVisibilityUpdate(PydanticBaseModel):
    visibility: str = Field(..., pattern="^(inherit|private|restricted)$", description="inherit / private / restricted")
    # 全量替换语义：restricted 时为本夹新授权清单；非 restricted 时忽略并清空授权行
    shares: List[FolderShareIn] = Field(default_factory=list)


def _tenant_folder_or_404(db: Session, folder_id: str, tenant) -> Folder:
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.tenant_id == tenant.id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    return folder


def _member_role(db: Session, tenant, user: User) -> Optional[str]:
    from app.models.tenant import TenantMember
    m = db.query(TenantMember).filter(
        TenantMember.tenant_id == tenant.id,
        TenantMember.user_id == user.id,
        TenantMember.status == "active",
    ).first()
    return m.role if m else None


def _can_manage_visibility(db: Session, folder: Folder, user: User, tenant) -> bool:
    """夹创建者 或 租户 owner/admin 可设置可见性/授权。"""
    return folder.user_id == user.id or _member_role(db, tenant, user) in ("owner", "admin")


def _share_out(db: Session, tenant, share) -> dict:
    """授权行 → 透出结构（user 解析 email、group 解析 name；对象已删则 None）。"""
    item = {"grantee_type": share.grantee_type, "grantee_id": share.grantee_id,
            "email": None, "name": None}
    if share.grantee_type == "user":
        u = db.query(User).filter(User.id == share.grantee_id).first()
        if u:
            item["email"] = u.email
            item["name"] = u.name
    else:
        from app.models.groups import UserGroup
        g = db.query(UserGroup).filter(
            UserGroup.id == share.grantee_id, UserGroup.tenant_id == tenant.id).first()
        if g:
            item["name"] = g.name
    return item


@router.put("/{folder_id}/visibility", summary="Set folder visibility", description="设置文件夹可见性（inherit/private/restricted）并全量替换授权清单；非 restricted 忽略 shares 并清空授权行。仅团队空间；夹创建者或 owner/admin。")
async def set_folder_visibility(
    folder_id: str,
    data: FolderVisibilityUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    if tenant is None:
        raise HTTPException(status_code=400, detail="目录级权限仅团队空间可用")
    folder = _tenant_folder_or_404(db, folder_id, tenant)
    if not _can_manage_visibility(db, folder, current_user, tenant):
        raise HTTPException(status_code=403, detail="仅文件夹创建者或租户管理员可设置可见性")

    from app.models.groups import FolderShare, UserGroup
    from app.models.tenant import TenantMember

    new_shares = []
    if data.visibility == "restricted":
        for s in data.shares:
            if s.grantee_type == "user":
                m = db.query(TenantMember).filter(
                    TenantMember.tenant_id == tenant.id,
                    TenantMember.user_id == s.grantee_id,
                    TenantMember.status == "active",
                ).first()
                if not m:
                    raise HTTPException(status_code=400, detail=f"授权用户不是本租户成员: {s.grantee_id}")
            else:
                g = db.query(UserGroup).filter(
                    UserGroup.id == s.grantee_id, UserGroup.tenant_id == tenant.id).first()
                if not g:
                    raise HTTPException(status_code=400, detail=f"授权分组不属于本租户: {s.grantee_id}")
            new_shares.append(s)

    # 全量替换：先清旧授权行，restricted 时落新清单（非 restricted 即清空语义）
    db.query(FolderShare).filter(FolderShare.folder_id == folder.id).delete(synchronize_session=False)
    for s in new_shares:
        db.add(FolderShare(
            id=str(uuid.uuid4()), folder_id=folder.id,
            grantee_type=s.grantee_type, grantee_id=s.grantee_id,
            created_by=current_user.id,
        ))
    folder.visibility = data.visibility
    folder.updated_at = datetime.now()
    _audit(db, tenant.id, current_user, "folder_visibility", "folder", folder.id,
           f"{folder.name} -> {data.visibility}")
    db.commit()
    return {"id": folder.id, "visibility": folder.visibility,
            "shares": [_share_out(db, tenant, s) for s in
                       db.query(FolderShare).filter(FolderShare.folder_id == folder.id).all()]}


@router.get("/{folder_id}/shares", summary="Get folder shares", description="返回文件夹 visibility + 授权清单（user 解析 email / group 解析 name）。创建者或 owner/admin 可读；普通成员可见自己可见夹的授权情况。")
async def get_folder_shares(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = get_active_tenant(db, current_user)
    if tenant is None:
        raise HTTPException(status_code=400, detail="目录级权限仅团队空间可用")
    folder = _tenant_folder_or_404(db, folder_id, tenant)
    # 读口径：管理者可读；普通成员仅自己可见的夹可读（不可见夹 404 防探测）
    if not _can_manage_visibility(db, folder, current_user, tenant):
        if folder.id in invisible_folder_ids(db, current_user, tenant):
            raise HTTPException(status_code=404, detail="文件夹不存在")
    from app.models.groups import FolderShare
    shares = db.query(FolderShare).filter(FolderShare.folder_id == folder.id).all()
    return {
        "id": folder.id,
        "visibility": folder.visibility or "inherit",
        "shares": [_share_out(db, tenant, s) for s in shares],
    }
