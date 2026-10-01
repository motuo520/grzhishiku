from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from typing import List, Optional
from datetime import datetime, timedelta
import uuid
import json

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_note_input
from app.core.feature_guard import FeatureGuard
from app.services.quota_service import QuotaService
from app.models.base import User, Note, Tag, Folder, content_tags
from app.schemas.note import NoteCreate, NoteUpdate, NoteResponse
from pydantic import BaseModel as PydanticBaseModel, Field

class BatchNoteItem(NoteCreate):
    # 批量导入容忍无正文（标题清单/链接列表类导入）；单条创建仍要求正文
    content: str = ""


class BatchNoteCreate(PydanticBaseModel):
    # 09-30 安全批：批量条数硬帽——无帽时一个请求体塞两万条小 item，
    # 同步逐条 savepoint 把事件循环卡死几十秒（登录即可用的 DoS）
    items: List[BatchNoteItem] = Field(..., max_length=200)

class BatchNoteDelete(PydanticBaseModel):
    ids: List[str] = Field(..., max_length=500)

class BatchCreateResult(PydanticBaseModel):
    success_count: int
    failed_count: int
    failures: List[dict] = []
    items: List[NoteResponse] = []
    # 防重：同用户 active 且标题+正文完全一致的条目跳过
    skipped_count: int = 0
    skipped: List[dict] = []
from app.schemas.tag import TagItem
from app.api.v1.endpoints.graph import queue_auto_link
from app.api.v1.endpoints.folders import validate_folder_assignment
from app.api.v1.endpoints.jianghu import record_evolution_transition
from app.core.tenant_scope import get_active_tenant, content_filter, content_visible_condition
from app.core.tenant_scope import audit as _audit
from app.services import tag_service
from app.services import note_embedding_service
from app.utils.search import build_search_filter

router = APIRouter()


def _get_note_tags(db: Session, note_id: str) -> List[TagItem]:
    """Get associated tags for a note."""
    return tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_NOTE, note_id)


def _set_note_tags(db: Session, note_id: str, user_id: str, tag_inputs: Optional[List[str]], tenant=None) -> None:
    """
    Associate tags with a note. tag_inputs can be tag IDs or tag names.
    Creates new tags automatically for names that don't exist.
    tenant 非空（团队上下文）时标签写/复用该租户的团队标签。
    """
    tag_service.set_tags_for(
        db,
        content_type=tag_service.CONTENT_TYPE_NOTE,
        content_id=note_id,
        user_id=user_id,
        tag_inputs=tag_inputs,
        tenant=tenant,
    )


def _sync_capsule_refs(note: Note, db: Session) -> None:
    """Keep capsule_refs in sync with content_tags for backward compatibility."""
    tags = _get_note_tags(db, note.id)
    tag_names = [t.name for t in tags]
    note.capsule_refs = json.dumps(tag_names, ensure_ascii=False) if tag_names else None


def _build_note_response(note: Note, db: Session, tags=None) -> dict:
    if tags is None:
        tags = _get_note_tags(db, note.id)
    try:
        attached_practice_ids = json.loads(note.attached_practice_ids or '[]') if note.attached_practice_ids else []
    except json.JSONDecodeError:
        attached_practice_ids = []
    return {
        "id": note.id,
        "user_id": note.user_id,
        "brain_side": note.brain_side,
        "title": note.title,
        "content": note.content,
        "content_format": note.content_format or "markdown",
        "tags": tags,
        "origin_type": note.origin_type or "self_practice",
        "invoke_count": note.invoke_count or 0,
        "last_invoked_at": note.last_invoked_at,
        "practice_depth": note.practice_depth or 0,
        "personal_relevance_score": note.personal_relevance_score if note.personal_relevance_score is not None else 0.5,
        "evolution_stage": note.evolution_stage or "collected",
        "attached_practice_ids": attached_practice_ids,
        "pipeline_stage": note.pipeline_stage or "raw",
        "folder_id": note.folder_id,
        "index_only": bool(note.index_only),
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


@router.get("/", response_model=List[NoteResponse], summary="List notes", description="Get all notes for the current user with pagination, search, sorting, and tag filtering.")
async def list_notes(
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(20, ge=1, le=1000),
    sort_by: str = Query("created_at", pattern="^(created_at|updated_at|title)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    q: Optional[str] = Query(None, max_length=200, description="Search in title or content"),
    tag_ids: Optional[str] = Query(None, description="Filter by comma-separated tag IDs"),
    brain_side: Optional[str] = Query(None, description="Filter by brain side: personal / network / both"),
    folder_id: Optional[str] = Query(None, description="Filter by folder id; 'none' = 未归档"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    query = content_filter(db.query(Note).filter(Note.status == "active"), Note, current_user, tenant)
    # 目录级权限（批 C）：不可见夹内笔记不进列表（个人空间恒真条件，零变化）
    query = query.filter(content_visible_condition(db, Note, current_user, tenant))
    # 带 folder_id 过滤时脑侧由文件夹归属规则约束（夹内笔记天然脑侧兼容），不再做严格等值过滤
    # 脑侧口径同 knowledge 列表：both 侧笔记在 personal/network 视图都可见
    if brain_side and brain_side != "both" and not folder_id:
        query = query.filter(Note.brain_side.in_([brain_side, "both"]))

    if folder_id == "none":
        # 未归档（按查看脑 P）：note.brain_side ∈ {P,'both'} 且（folder_id 为空 或 文件夹不属 P 脑）；
        # 文件夹范围按空间口径（团队上下文=该租户的夹）
        p = brain_side if brain_side in ("personal", "network") else "personal"
        own_folder_ids = content_filter(
            db.query(Folder.id).filter(Folder.brain_side == p), Folder, current_user, tenant
        )
        query = query.filter(Note.brain_side.in_([p, "both"]))
        query = query.filter(or_(Note.folder_id.is_(None), ~Note.folder_id.in_(own_folder_ids)))
    elif folder_id:
        query = query.filter(Note.folder_id == folder_id)
    
    if q:
        # 中文长句无空格分词，整串 ilike 之外加 bigram 命中比例兜底（BUG-N01）
        query = query.filter(build_search_filter(q, Note.title, Note.content))
    
    if tag_ids:
        tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if tag_id_list:
            query = query.join(
                content_tags,
                and_(
                    content_tags.c.content_id == Note.id,
                    content_tags.c.content_type == "note",
                    content_tags.c.tag_id.in_(tag_id_list)
                )
            ).distinct()
    
    sort_column = getattr(Note, sort_by, Note.created_at)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())
    
    notes = query.offset(skip).limit(limit).all()
    # 批量取标签（09-14 N+1 实捕：每笔记一条 join → 一条 IN 查询）
    tags_map = tag_service.get_tags_for_many(db, tag_service.CONTENT_TYPE_NOTE, [n.id for n in notes])
    return [_build_note_response(n, db, tags=tags_map.get(n.id, [])) for n in notes]


@router.post("/", response_model=NoteResponse, status_code=status.HTTP_201_CREATED, summary="Create note", description="Create a new note for the current user.")
async def create_note(
    note_data: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Feature & quota checks
    guard = FeatureGuard(db, current_user)

    # 锁定用户行，串行化同一用户的并发创建，防配额先查后写竞态
    db.query(User).filter(User.id == current_user.id).with_for_update().one()

    note_count = db.query(func.count(Note.id)).filter(
        Note.user_id == current_user.id, Note.status == "active"
    ).scalar() or 0
    guard.check_limit("notes", note_count)

    quota = QuotaService(db)
    safe_title, safe_content = sanitize_note_input(note_data.title, note_data.content)
    additional_bytes = quota.estimate_storage_bytes(safe_title or "") + quota.estimate_storage_bytes(safe_content or "")
    quota.check_storage_before_create(current_user.id, additional_bytes)

    tenant = get_active_tenant(db, current_user)

    note = Note(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=note_data.brain_side,
        title=safe_title,
        content=safe_content,
        content_format="markdown",
        status="active",
        origin_type=note_data.origin_type.value if note_data.origin_type else "self_practice",
        practice_depth=note_data.practice_depth if note_data.practice_depth is not None else 0,
        personal_relevance_score=note_data.personal_relevance_score if note_data.personal_relevance_score is not None else 0.5,
        evolution_stage=note_data.evolution_stage.value if note_data.evolution_stage else "collected",
        pipeline_stage=note_data.pipeline_stage.value if note_data.pipeline_stage else "raw",
        attached_practice_ids='[]',
        index_only=bool(note_data.index_only),  # 仓库模式（09-19）：建笔记时可直设
        # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
        tenant_id=tenant.id if tenant else None,
    )
    if note_data.folder_id:
        # 团队上下文归档到团队夹合法（脑侧校验仅个人空间生效）
        validate_folder_assignment(db, current_user.id, note_data.brain_side, note_data.folder_id, tenant=tenant)
        note.folder_id = note_data.folder_id
    db.add(note)
    # 租户审计：团队空间的内容创建记流水（个人空间不记）
    if tenant:
        _audit(db, tenant.id, current_user, "content_create", "note", note.id, safe_title)
    # 标签与笔记必须同一笔提交：先提笔记再补标签，autotag 监听会在「无标签窗口」
    # 抢到这条笔记，自动标签整组替换用户手打的标签（QA BUG-010 生产实捕）
    _set_note_tags(db, note.id, current_user.id, note_data.tags, tenant=tenant)
    _sync_capsule_refs(note, db)
    db.commit()
    db.refresh(note)

    quota.record_storage_add(current_user.id, additional_bytes)

    # Auto-link graph edges（后台队列+防抖，请求路径零扫描）
    queue_auto_link("note", note.id, current_user.id, db)

    return _build_note_response(note, db)


@router.get("/{note_id}", response_model=NoteResponse, summary="Get note", description="Get a specific note by ID.")
async def get_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    note = content_filter(
        db.query(Note).filter(Note.id == note_id, Note.status == "active"),
        Note, current_user, tenant,
    ).filter(content_visible_condition(db, Note, current_user, tenant)).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    # Opening a note counts as an invocation ("调用") signal.
    # Debounced: re-opens within 30 minutes don't re-count (avoids refocus/refetch inflation).
    # 游客注入请求不计数不写库：演示账号数据被所有匿名访客共享，
    # 游客浏览会把 invoke_count 刷成流量噪声（GET 写副作用收窄）
    from app.core.guest_demo import is_guest_demo_user
    if not is_guest_demo_user(current_user):
        now = datetime.now()
        if not note.last_invoked_at or (now - note.last_invoked_at) > timedelta(minutes=30):
            note.invoke_count = (note.invoke_count or 0) + 1
            note.last_invoked_at = now
            db.commit()
    return _build_note_response(note, db)


@router.put("/{note_id}", response_model=NoteResponse, summary="Update note", description="Update a note by ID.")
async def update_note(
    note_id: str,
    note_data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    note = content_filter(
        db.query(Note).filter(Note.id == note_id, Note.status == "active"),
        Note, current_user, tenant,
    ).filter(content_visible_condition(db, Note, current_user, tenant)).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    content_changed = False
    # 09-30 安全批：update 同样过存储配额（此前只查 create——免费号可先建 1 字节笔记
    # 再 PUT 大正文绕过 100MB 档）。先取旧字节，变更后按差值检查+原子扣账（负差=释放）
    quota = QuotaService(db)
    _old_bytes = quota.estimate_storage_bytes(note.title or "") + quota.estimate_storage_bytes(note.content or "")
    if note_data.title is not None:
        note.title = sanitize_note_input(note_data.title, None)[0]
    if note_data.content is not None:
        new_content = sanitize_note_input(None, note_data.content)[1]
        content_changed = new_content != (note.content or "")
        note.content = new_content
    _quota_delta = 0
    if note_data.title is not None or note_data.content is not None:
        _new_bytes = quota.estimate_storage_bytes(note.title or "") + quota.estimate_storage_bytes(note.content or "")
        _quota_delta = _new_bytes - _old_bytes
        if _quota_delta > 0:
            quota.check_storage_before_create(current_user.id, _quota_delta)
    if note_data.brain_side is not None:
        note.brain_side = note_data.brain_side
    if note_data.origin_type is not None:
        note.origin_type = note_data.origin_type.value
    if note_data.practice_depth is not None:
        note.practice_depth = note_data.practice_depth
    if note_data.personal_relevance_score is not None:
        note.personal_relevance_score = note_data.personal_relevance_score
    if note_data.evolution_stage is not None:
        # 手动推进/回退阶段记流水（trigger=manual），同值重写不记
        record_evolution_transition(db, note, "note", note_data.evolution_stage.value, "manual")
        note.evolution_stage = note_data.evolution_stage.value
    if note_data.pipeline_stage is not None:
        note.pipeline_stage = note_data.pipeline_stage.value
    # 仓库模式开关（09-19）：显式传值才改；切回 false 后随打标兜底扫描/下次建图
    # 自然回归语义层（再进通道=摘标记，现有周期机制接管，无需单独入口）
    if note_data.index_only is not None:
        note.index_only = note_data.index_only
    if note_data.tags is not None:
        _set_note_tags(db, note_id, current_user.id, note_data.tags, tenant=tenant)
        _sync_capsule_refs(note, db)
    # folder_id 显式传了才处理（含显式 null = 移出文件夹，未归档）；
    # 团队上下文归档到团队夹合法（脑侧校验仅个人空间生效）
    if "folder_id" in note_data.model_fields_set:
        if note_data.folder_id is not None:
            target_brain = note_data.brain_side if note_data.brain_side is not None else note.brain_side
            validate_folder_assignment(db, current_user.id, target_brain, note_data.folder_id, tenant=tenant)
        note.folder_id = note_data.folder_id
    elif note_data.brain_side is not None and note.folder_id and not note.tenant_id:
        # 单改脑侧的兜底（仅个人空间：脑侧是个人概念）：既有文件夹与新脑侧不兼容时自动移出
        folder = db.query(Folder).filter(Folder.id == note.folder_id).first()
        if folder and note.brain_side != "both" and folder.brain_side != note.brain_side:
            note.folder_id = None

    note.updated_at = datetime.now()
    db.commit()
    db.refresh(note)
    if _quota_delta != 0:
        quota.record_storage_add(current_user.id, _quota_delta)  # 负差=释放（原子 UPDATE）
    
    # 后台队列+防抖：auto-link 不再占用保存响应（09-14）
    queue_auto_link("note", note.id, current_user.id, db)


    return _build_note_response(note, db)


@router.patch("/{note_id}", response_model=NoteResponse, summary="Partial update note", description="Partially update a note by ID.")
async def patch_note(
    note_id: str,
    note_data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return await update_note(note_id, note_data, db, current_user)


@router.delete("/batch", response_model=dict, summary="Batch delete notes", description="Soft-delete multiple notes by IDs.")
async def batch_delete_notes(
    request: BatchNoteDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    deleted = 0
    tenant = get_active_tenant(db, current_user)
    # 与单删同口径：图边也要清，否则批删留幽灵节点（单删有、批删漏实捕）
    from app.api.v1.endpoints.graph import cleanup_content_edges
    _inv_vis = content_visible_condition(db, Note, current_user, tenant)
    for note_id in request.ids:
        note = content_filter(
            db.query(Note).filter(Note.id == note_id, Note.status == "active"),
            Note, current_user, tenant,
        ).filter(_inv_vis).first()
        if note:
            note.status = "deleted"
            if tenant:
                _audit(db, tenant.id, current_user, "content_delete", "note", note.id, note.title)
            db.execute(
                content_tags.delete().where(
                    and_(
                        content_tags.c.content_id == note_id,
                        content_tags.c.content_type == "note"
                    )
                )
            )
            cleanup_content_edges(db, note_id)
            deleted += 1
    db.commit()
    return {"success": True, "deleted_count": deleted}


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete note", description="Soft-delete a note by setting status to deleted.")
async def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    note = content_filter(
        db.query(Note).filter(Note.id == note_id, Note.status == "active"),
        Note, current_user, tenant,
    ).filter(content_visible_condition(db, Note, current_user, tenant)).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    note.status = "deleted"
    # 租户审计：团队空间的内容删除记流水（个人空间不记）
    if tenant:
        _audit(db, tenant.id, current_user, "content_delete", "note", note.id, note.title)
    

    # Remove tag associations
    db.execute(
        content_tags.delete().where(
            and_(
                content_tags.c.content_id == note_id,
                content_tags.c.content_type == "note"
            )
        )
    )

    # Remove graph edges referencing this note (avoid phantom nodes)
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, note_id)

    db.commit()
    return None


@router.post("/batch", response_model=BatchCreateResult, summary="Batch create notes", description="Create multiple notes in a single request.")
async def batch_create_notes(
    batch: BatchNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 配额预检：与单条创建同口径，当前用量 + 本批数量不得超限，超额整批 403
    guard = FeatureGuard(db, current_user)
    db.query(User).filter(User.id == current_user.id).with_for_update().one()
    note_count = db.query(func.count(Note.id)).filter(
        Note.user_id == current_user.id, Note.status == "active"
    ).scalar() or 0
    if batch.items:
        guard.check_limit("notes", note_count + len(batch.items) - 1)

    created = []
    failures = []
    skipped = []
    # 批量项目在 nested savepoint 内会先 flush，导致最终外层 commit 时
    # session.new 已为空，note_embedding_service 的 ORM 监听无法捕获新笔记。
    # 先记录 savepoint 成功的任务，待外层 commit 成功后显式入队；失败项目
    # 和整批回滚都不会污染向量队列。
    embedding_jobs = []
    tenant = get_active_tenant(db, current_user)
    # 防重：同范围 active 笔记按（标题+正文）完全一致判重，批量导入同一份文件两次不产生重复。
    # 只拉标题在本批里的候选行（09-30 安全批：此前全表 title+content 进内存——
    # 库存撑大后每次批量导入都是一次内存尖峰）
    _batch_titles = list({(nd.title or "")[:500] for nd in batch.items})
    existing_pairs = {
        (t, c) for t, c in content_filter(
            db.query(Note.title, Note.content).filter(
                Note.status == "active", Note.title.in_(_batch_titles)),
            Note, current_user, tenant,
        ).all()
    } if _batch_titles else set()
    # 存储配额按批累计（09-30 安全批：批量导入此前不过 100MB 档）
    quota = QuotaService(db)
    _batch_bytes = 0
    for index, note_data in enumerate(batch.items):
        try:
            safe_title, safe_content = sanitize_note_input(note_data.title, note_data.content)
            if (safe_title, safe_content) in existing_pairs:
                skipped.append({"index": index, "title": note_data.title, "reason": "已存在相同内容，跳过"})
                continue
            _batch_bytes += quota.estimate_storage_bytes(safe_title or "") \
                + quota.estimate_storage_bytes(safe_content or "")
            if _batch_bytes > 0:
                quota.check_storage_before_create(current_user.id, _batch_bytes)
            # item 级 savepoint：失败回滚本 item 已 flush 的行，保证报失败=真没写
            # （显式 commit/rollback 而非 with 形式：嵌套 savepoint 的上下文管理器
            #   与测试夹具的 savepoint 重启监听器冲突，显式形式两种环境行为一致）
            savepoint = db.begin_nested()
            try:
                note = Note(
                    id=str(uuid.uuid4()),
                    user_id=current_user.id,
                    brain_side=note_data.brain_side,
                    title=safe_title,
                    content=safe_content,
                    content_format="markdown",
                    status="active",
                    origin_type=note_data.origin_type.value if note_data.origin_type else "self_practice",
                    practice_depth=note_data.practice_depth if note_data.practice_depth is not None else 0,
                    personal_relevance_score=note_data.personal_relevance_score if note_data.personal_relevance_score is not None else 0.5,
                    evolution_stage=note_data.evolution_stage.value if note_data.evolution_stage else "collected",
                    pipeline_stage=note_data.pipeline_stage.value if note_data.pipeline_stage else "raw",
                    attached_practice_ids='[]',
                    # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
                    tenant_id=tenant.id if tenant else None,
                )
                db.add(note)
                if tenant:
                    _audit(db, tenant.id, current_user, "content_create", "note", note.id, safe_title)
                db.flush()
                _set_note_tags(db, note.id, current_user.id, note_data.tags, tenant=tenant)
                _sync_capsule_refs(note, db)
                db.flush()
            except Exception:
                savepoint.rollback()
                raise
            savepoint.commit()
            embedding_jobs.append((note.id, current_user.id))
            queue_auto_link("note", note.id, current_user.id, db)
            db.refresh(note)
            created.append(_build_note_response(note, db))
            existing_pairs.add((safe_title, safe_content))  # 批内防重
        except Exception as e:
            failures.append({"index": index, "title": note_data.title, "reason": "写入失败"})
    
    db.commit()
    if _batch_bytes > 0:
        quota.record_storage_add(current_user.id, _batch_bytes)
    for note_id, user_id in embedding_jobs:
        note_embedding_service._enqueue_embed("note", note_id, user_id)
    return {
        "success_count": len(created),
        "failed_count": len(failures),
        "failures": failures,
        "items": created,
        "skipped_count": len(skipped),
        "skipped": skipped,
    }

