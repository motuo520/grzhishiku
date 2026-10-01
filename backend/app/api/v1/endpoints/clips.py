from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import datetime
import asyncio
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_clip_input, sanitize_knowledge_input
from app.core.feature_guard import FeatureGuard
from app.services.quota_service import QuotaService
from app.models.base import User, BrowserClip, KnowledgeUnit, content_tags, Folder
from app.schemas.clip import ClipCreate, ClipResponse, ClipUpdate
from app.schemas.knowledge import KnowledgeUnitResponse
from app.services import tag_service
from app.core.tenant_scope import get_active_tenant, content_filter, content_visible_condition
from app.core.tenant_scope import audit as _audit
from pydantic import BaseModel as PydanticBaseModel, Field
import urllib.request
import urllib.error
import re
from datetime import datetime, timedelta

class BatchClipCreate(PydanticBaseModel):
    items: List[ClipCreate]

class BatchClipDelete(PydanticBaseModel):
    # 批量删除上限 500 条：超出直接 422，避免单次请求打爆库
    ids: List[str] = Field(..., max_length=500)

class BatchCreateResult(PydanticBaseModel):
    success_count: int
    failed_count: int
    failures: List[dict] = []
    items: List[ClipResponse] = []
    # 防重：同用户 active 且 URL 相同的条目跳过
    skipped_count: int = 0
    skipped: List[dict] = []

class UrlMetadataRequest(PydanticBaseModel):
    urls: List[str]

class UrlMetadata(PydanticBaseModel):
    url: str
    title: str
    domain: str
    excerpt: Optional[str] = None
    error: Optional[str] = None

class UrlContentRequest(PydanticBaseModel):
    url: str = Field(..., min_length=1, max_length=2048)

class UrlContent(PydanticBaseModel):
    url: str
    title: str
    domain: str
    excerpt: Optional[str] = None
    full_text: Optional[str] = None
    error: Optional[str] = None
from app.api.v1.endpoints.graph import queue_auto_link
from app.utils.search import build_search_filter

router = APIRouter()


_TRACKING_QUERY_KEYS = re.compile(r"^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|spm|ref_?)$", re.IGNORECASE)


def _normalize_url(url: str) -> str:
    """URL 规范化用于判重：小写协议/域名、去跟踪参数（utm 等）、去 fragment、
    查询参数排序、去路径末尾斜杠。规范化后相同视为同一链接。"""
    try:
        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
        parsed = urlparse((url or "").strip())
        scheme = (parsed.scheme or "https").lower()
        netloc = parsed.netloc.lower()
        path = parsed.path or "/"
        if path != "/" and path.endswith("/"):
            path = path.rstrip("/")
        query = urlencode(sorted(
            (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
            if not _TRACKING_QUERY_KEYS.match(k)
        ))
        return urlunparse((scheme, netloc, path, "", query, ""))
    except Exception:
        return (url or "").strip()


def _build_clip_response(clip: BrowserClip, db: Session) -> dict:
    return {
        "id": clip.id,
        "user_id": clip.user_id,
        "brain_side": clip.brain_side,
        "title": clip.title,
        "url": clip.url,
        "domain": clip.domain,
        "excerpt": clip.excerpt,
        "full_text": clip.full_text,
        "folder_id": clip.folder_id,
        "index_only": bool(clip.index_only),
        "tags": tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip.id),
        "created_at": clip.created_at,
        "updated_at": clip.updated_at,
    }


@router.get("/", response_model=List[ClipResponse], summary="List clips", description="Get all browser clips for the current user with pagination, search, domain filter, and tag filter.")
async def list_clips(
    skip: int = Query(0, ge=0),
    # 上限放宽到 1000：个人库规模全量读取无压力，配合前端「加载更多」递增加载
    limit: int = Query(20, ge=1, le=1000),
    domain: Optional[str] = Query(None, description="Filter by domain"),
    q: Optional[str] = Query(None, max_length=200, description="Search in title or excerpt"),
    tag_ids: Optional[str] = Query(None, description="Filter by comma-separated tag IDs"),
    brain_side: Optional[str] = Query(None, description="Filter by brain side: personal / network / both"),
    folder_id: Optional[str] = Query(None, description="Filter by folder id; 'none' = 未归档"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    query = content_filter(
        db.query(BrowserClip).filter(BrowserClip.status == "active"),
        BrowserClip, current_user, tenant,
    ).filter(content_visible_condition(db, BrowserClip, current_user, tenant))

    # 脑侧/未归档口径与 notes 列表一致（剪藏进树，08-22）
    if brain_side and brain_side != "both" and not folder_id:
        query = query.filter(BrowserClip.brain_side.in_([brain_side, "both"]))

    if folder_id == "none":
        p = brain_side if brain_side in ("personal", "network") else "network"  # 剪藏主战场是网络脑
        own_folder_ids = content_filter(
            db.query(Folder.id).filter(Folder.brain_side == p), Folder, current_user, tenant
        )
        query = query.filter(BrowserClip.brain_side.in_([p, "both"]))
        query = query.filter(or_(BrowserClip.folder_id.is_(None), ~BrowserClip.folder_id.in_(own_folder_ids)))
    elif folder_id:
        query = query.filter(BrowserClip.folder_id == folder_id)

    if domain:
        query = query.filter(BrowserClip.domain == domain)
    
    if q:
        # 中文长句 bigram 兜底，同 notes 列表口径（BUG-N01）
        query = query.filter(build_search_filter(q, BrowserClip.title, BrowserClip.excerpt))
    
    if tag_ids:
        tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if tag_id_list:
            from sqlalchemy import and_
            query = query.join(
                content_tags,
                and_(
                    content_tags.c.content_id == BrowserClip.id,
                    content_tags.c.content_type == tag_service.CONTENT_TYPE_CLIP,
                    content_tags.c.tag_id.in_(tag_id_list)
                )
            ).distinct()
    
    clips = query.order_by(BrowserClip.created_at.desc()).offset(skip).limit(limit).all()
    return [_build_clip_response(c, db) for c in clips]

@router.post("/", response_model=ClipResponse, status_code=status.HTTP_201_CREATED, summary="Create clip", description="Create a new browser clip for the current user.")
async def create_clip(
    clip_data: ClipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Feature & quota checks
    guard = FeatureGuard(db, current_user)

    # 锁定用户行，串行化同一用户并发创建，防月度限额先查后写竞态
    db.query(User).filter(User.id == current_user.id).with_for_update().first()

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    clip_month_count = db.query(func.count(BrowserClip.id)).filter(
        BrowserClip.user_id == current_user.id,
        BrowserClip.status == "active",
        BrowserClip.created_at >= month_start,
    ).scalar() or 0
    guard.check_limit("clips_per_month", clip_month_count)

    quota = QuotaService(db)
    safe_title, safe_excerpt, safe_full_text, safe_url = sanitize_clip_input(
        clip_data.title, clip_data.excerpt, clip_data.full_text, clip_data.url
    )
    tenant = get_active_tenant(db, current_user)

    # 防重：同空间已有相同 URL（规范化后，utm 等跟踪参数变体算重复）的 active 剪藏则冲突
    domain = clip_data.domain or _extract_domain(safe_url)
    normalized = _normalize_url(safe_url)
    existing_urls = content_filter(
        db.query(BrowserClip.url).filter(
            BrowserClip.status == "active",
            BrowserClip.domain == domain,
        ),
        BrowserClip, current_user, tenant,
    ).all()
    if any(_normalize_url(u) == normalized for (u,) in existing_urls):
        raise HTTPException(status_code=409, detail="该链接已在剪藏中")

    additional_bytes = (
        quota.estimate_storage_bytes(safe_title or "")
        + quota.estimate_storage_bytes(safe_excerpt or "")
        + quota.estimate_storage_bytes(safe_full_text or "")
    )
    quota.check_storage_before_create(current_user.id, additional_bytes)

    clip = BrowserClip(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side=clip_data.brain_side,
        title=safe_title,
        url=safe_url,
        domain=domain,
        excerpt=safe_excerpt,
        full_text=safe_full_text,
        status="active",
        index_only=bool(clip_data.index_only),  # 仓库模式（09-19）：创建时可直设
        # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
        tenant_id=tenant.id if tenant else None,
    )
    db.add(clip)
    # 租户审计：团队空间的内容创建记流水（个人空间不记）
    if tenant:
        _audit(db, tenant.id, current_user, "content_create", "clip", clip.id, safe_title or safe_url)
    db.flush()

    quota.record_storage_add(current_user.id, additional_bytes)

    # Set tags（团队上下文写/复用该租户的团队标签）
    if clip_data.tags is not None:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_CLIP,
            content_id=clip.id,
            user_id=current_user.id,
            tag_inputs=clip_data.tags,
            tenant=tenant,
        )

    # Auto-link graph edges（后台队列+防抖，请求路径零扫描）
    queue_auto_link("clip", clip.id, current_user.id, db)

    # 统一事务提交，避免部分成功留脏数据
    db.commit()
    db.refresh(clip)

    return _build_clip_response(clip, db)

@router.get("/{clip_id}", response_model=ClipResponse, summary="Get clip", description="Get a specific clip by ID.")
async def get_clip(
    clip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    clip = content_filter(
        db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.status == "active"),
        BrowserClip, current_user, tenant,
    ).filter(content_visible_condition(db, BrowserClip, current_user, tenant)).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    return _build_clip_response(clip, db)

@router.put("/{clip_id}", response_model=ClipResponse, summary="Update clip", description="Update an existing browser clip.")
async def update_clip(
    clip_id: str,
    data: ClipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    clip = content_filter(
        db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.status == "active"),
        BrowserClip, current_user, tenant,
    ).filter(content_visible_condition(db, BrowserClip, current_user, tenant)).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    # 09-30 安全批：update 同样过存储配额（与 notes 同口径差值扣账）
    quota = QuotaService(db)
    _old_bytes = quota.estimate_storage_bytes(clip.title or "") \
        + quota.estimate_storage_bytes(clip.excerpt or "") \
        + quota.estimate_storage_bytes(clip.full_text or "")
    if data.title is not None:
        safe_title, _, _, _ = sanitize_clip_input(data.title, None, None, None)
        clip.title = safe_title
    if data.url is not None:
        _, _, _, safe_url = sanitize_clip_input(None, None, None, data.url)
        clip.url = safe_url
        if data.domain is None:
            clip.domain = _extract_domain(safe_url)
    if data.domain is not None:
        clip.domain = data.domain
    if data.excerpt is not None:
        _, safe_excerpt, _, _ = sanitize_clip_input(None, data.excerpt, None, None)
        clip.excerpt = safe_excerpt
    if data.index_only is not None:
        # 仓库模式开关（09-19）：切回 false 随打标兜底扫描/下次建图自然回归语义层
        clip.index_only = data.index_only
    if data.full_text is not None:
        _, _, safe_full_text, _ = sanitize_clip_input(None, None, data.full_text, None)
        clip.full_text = safe_full_text
    if data.tags is not None:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_CLIP,
            content_id=clip.id,
            user_id=current_user.id,
            tag_inputs=data.tags,
            tenant=tenant,
        )
    # folder_id 显式传了才处理（含显式 null = 移出文件夹，未归档）；校验同笔记口径
    if "folder_id" in data.model_fields_set:
        if data.folder_id is not None:
            from app.api.v1.endpoints.folders import validate_folder_assignment
            validate_folder_assignment(db, current_user.id, clip.brain_side or "network", data.folder_id, tenant=tenant)
        clip.folder_id = data.folder_id
    _new_bytes = quota.estimate_storage_bytes(clip.title or "") \
        + quota.estimate_storage_bytes(clip.excerpt or "") \
        + quota.estimate_storage_bytes(clip.full_text or "")
    _quota_delta = _new_bytes - _old_bytes
    if _quota_delta > 0:
        quota.check_storage_before_create(current_user.id, _quota_delta)
    clip.updated_at = datetime.now()
    db.commit()
    db.refresh(clip)
    if _quota_delta != 0:
        quota.record_storage_add(current_user.id, _quota_delta)
    return _build_clip_response(clip, db)


@router.post("/{clip_id}/save-to-knowledge", response_model=KnowledgeUnitResponse, status_code=status.HTTP_201_CREATED, summary="Save clip as knowledge unit", description="Convert a browser clip into a knowledge unit.")
async def save_clip_to_knowledge(
    clip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    clip = content_filter(
        db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.status == "active"),
        BrowserClip, current_user, tenant,
    ).filter(content_visible_condition(db, BrowserClip, current_user, tenant)).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    content = clip.full_text or clip.excerpt or clip.title
    safe_content, safe_url, safe_title = sanitize_knowledge_input(content, clip.url, clip.title)
    unit = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        brain_side='network',
        content_raw=safe_content,
        content_type='clip',
        title=safe_title,  # 09-16 单元自身标题
        source_url=safe_url,
        source_title=safe_title,
        source_type='browser_clip',
        source_author=None,
        verification_status='unverified',
        trust_level='tentative',
        verification_history='[]',
        # 与来源剪藏同空间：团队剪藏转出的知识单元也归团队
        tenant_id=tenant.id if tenant else None,
    )
    db.add(unit)
    # 租户审计：团队剪藏转出的知识单元记 content_create（个人空间不记）
    if tenant:
        _audit(db, tenant.id, current_user, "content_create", "knowledge", unit.id, safe_title or safe_content)
    db.commit()
    db.refresh(unit)

    # Copy clip tags to knowledge unit（团队上下文写/复用团队标签）
    clip_tags = tag_service.get_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip.id)
    if clip_tags:
        tag_service.set_tags_for(
            db,
            content_type=tag_service.CONTENT_TYPE_KNOWLEDGE,
            content_id=unit.id,
            user_id=current_user.id,
            tag_inputs=[t.name for t in clip_tags],
            tenant=tenant,
        )
        db.commit()
        db.refresh(unit)

    # Auto-link（后台队列+防抖，请求路径零扫描）
    queue_auto_link("knowledge", unit.id, current_user.id, db)

    return unit


# 路由顺序铁律（血泪 #10）：/batch 必须注册在 /{clip_id} 的 DELETE 之前，否则被路径参数抢路由
@router.delete("/batch", response_model=dict, summary="Batch delete clips", description="Soft-delete multiple clips by IDs.")
async def batch_delete_clips(
    request: BatchClipDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 语义与单条删除完全一致：软删 + 标签关联清理 + 图边清理 + 团队空间审计；
    # 空间口径之外的 id 静默跳过（幂等：不报错，只少删）
    tenant = get_active_tenant(db, current_user)
    deleted = 0
    _inv_vis = content_visible_condition(db, BrowserClip, current_user, tenant)
    for clip_id in request.ids:
        clip = content_filter(
            db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.status == "active"),
            BrowserClip, current_user, tenant,
        ).filter(_inv_vis).first()
        if not clip:
            continue
        clip.status = "deleted"
        # 租户审计：团队空间的内容删除记流水（个人空间不记）
        if clip.tenant_id:
            _audit(db, clip.tenant_id, current_user, "content_delete", "clip", clip.id, clip.title)
        tag_service.delete_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip_id)
        from app.api.v1.endpoints.graph import cleanup_content_edges
        cleanup_content_edges(db, clip_id)
        deleted += 1
    db.commit()
    return {"deleted": deleted}


@router.delete("/{clip_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete clip", description="Soft-delete a clip by setting status to deleted.")
async def delete_clip(
    clip_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tenant = get_active_tenant(db, current_user)
    clip = content_filter(
        db.query(BrowserClip).filter(BrowserClip.id == clip_id, BrowserClip.status == "active"),
        BrowserClip, current_user, tenant,
    ).filter(content_visible_condition(db, BrowserClip, current_user, tenant)).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    clip.status = "deleted"
    # 租户审计：团队空间的内容删除记流水（个人空间不记）
    if clip.tenant_id:
        _audit(db, clip.tenant_id, current_user, "content_delete", "clip", clip.id, clip.title)
    tag_service.delete_tags_for(db, tag_service.CONTENT_TYPE_CLIP, clip_id)
    from app.api.v1.endpoints.graph import cleanup_content_edges
    cleanup_content_edges(db, clip_id)
    db.commit()
    return None


def _extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain or url
    except Exception:
        return url


def _fetch_url_metadata(url: str) -> UrlMetadata:
    try:
        # SSRF 防护：仅 http/https、拒绝内网地址；重定向逐跳校验，响应体限 5MB
        from app.core.ssrf import open_checked_url, read_capped
        with open_checked_url(
            url,
            timeout=8,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        ) as response:
            html = read_capped(response).decode("utf-8", errors="ignore")
        
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else url
        # Collapse whitespace
        title = re.sub(r"\s+", " ", title)
        
        desc_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            re.IGNORECASE,
        ) or re.search(
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
            html,
            re.IGNORECASE,
        )
        excerpt = desc_match.group(1).strip() if desc_match else None
        if excerpt:
            excerpt = re.sub(r"\s+", " ", excerpt)
        
        return UrlMetadata(url=url, title=title, domain=_extract_domain(url), excerpt=excerpt)
    except ValueError as e:
        # core.ssrf 的校验提示本身是对外口径（如"地址不能指向内网或本机"），可直接透出
        return UrlMetadata(url=url, title=url, domain=_extract_domain(url), error=str(e))
    except Exception as e:
        # 底层异常原文可能含内网地址等细节，只进日志；对外固定文案
        import logging
        logging.getLogger(__name__).info("clip metadata fetch failed url=%s err=%s", url, e)
        return UrlMetadata(url=url, title=url, domain=_extract_domain(url), error="无法访问该地址")


def _fetch_url_content(url: str) -> UrlContent:
    """服务端抓 URL 正文（readability-lxml）：网页端「剪藏网页」无扩展场景的补齐（09-01 立项）。

    SSRF 防护与 _fetch_url_metadata 同一套（仅 http/https、拒内网、重定向逐跳、5MB 上限）。
    提取口径：标题=readability 清洗版 > <title> > url；摘要=meta description > 正文前 300 字；
    正文=summary() 剥标签纯文本（不设长度上限——09-11 随 ClipCreate.full_text 一起拆 5 万字墙）。
    """
    try:
        from app.core.ssrf import open_checked_url, read_capped
        from readability import Document
        with open_checked_url(
            url,
            timeout=12,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        ) as response:
            html = read_capped(response).decode("utf-8", errors="ignore")

        doc = Document(html)
        title = (doc.short_title() or "").strip()
        if not title:
            title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
            title = re.sub(r"\s+", " ", title_match.group(1).strip()) if title_match else url
        text = re.sub(r"<[^>]+>", " ", doc.summary())
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < 200:
            # 正文太短=提取失败（JS 渲染页/登录墙/反爬验证页——36kr 安全检测页实测只出 56 字），
            # 不造空剪藏；阈值与向量前拦门同口径（正文≥200 字）
            raise ValueError("未能从页面提取到正文（可能是 JS 渲染页、需要登录或反爬拦截）")

        desc_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.IGNORECASE,
        ) or re.search(
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
            html, re.IGNORECASE,
        )
        excerpt = re.sub(r"\s+", " ", desc_match.group(1).strip()) if desc_match else None
        return UrlContent(
            url=url, title=title[:200], domain=_extract_domain(url),
            excerpt=excerpt or text[:300], full_text=text,  # 09-10 取消 5 万字截断（单文档上限取消）
        )
    except ValueError as e:
        # ssrf 校验提示与「未能提取正文」都是对外口径，可直接透出
        return UrlContent(url=url, title=url, domain=_extract_domain(url), error=str(e))
    except Exception as e:
        # 底层异常原文可能含内网地址等细节，只进日志；对外固定文案
        import logging
        logging.getLogger(__name__).info("clip content fetch failed url=%s err=%s", url, e)
        return UrlContent(url=url, title=url, domain=_extract_domain(url), error="无法访问该地址")


@router.post("/fetch-content", response_model=UrlContent, summary="Fetch URL content", description="服务端抓取 URL 正文（readability），供剪藏表单一键填充。")
async def fetch_url_content(
    request: UrlContentRequest,
    current_user: User = Depends(get_current_user)
):
    # 同步 urllib 抓取卸载到线程池（与 fetch-metadata 同模式，P04 防拖死事件循环）
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch_url_content, request.url)


@router.post("/batch", response_model=BatchCreateResult, summary="Batch create clips", description="Create multiple browser clips in a single request.")
async def batch_create_clips(
    batch: BatchClipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 配额预检：与单条创建同口径，本月用量 + 本批数量不得超限，超额整批 403
    guard = FeatureGuard(db, current_user)
    db.query(User).filter(User.id == current_user.id).with_for_update().first()
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    clip_month_count = db.query(func.count(BrowserClip.id)).filter(
        BrowserClip.user_id == current_user.id,
        BrowserClip.status == "active",
        BrowserClip.created_at >= month_start,
    ).scalar() or 0
    if batch.items:
        guard.check_limit("clips_per_month", clip_month_count + len(batch.items) - 1)

    created = []
    failures = []
    skipped = []
    tenant = get_active_tenant(db, current_user)
    # 防重：同空间 active 剪藏按规范化 URL 判重（与单条创建同口径，utm 变体算重复），
    # 预载集合与批内去重都先规范化，批量导入同一份文件两次不产生重复
    existing_urls = {
        _normalize_url(u) for (u,) in content_filter(
            db.query(BrowserClip.url).filter(BrowserClip.status == "active"),
            BrowserClip, current_user, tenant,
        ).all()
    }
    for index, clip_data in enumerate(batch.items):
        try:
            safe_title, safe_excerpt, safe_full_text, safe_url = sanitize_clip_input(
                clip_data.title, clip_data.excerpt, clip_data.full_text, clip_data.url
            )
            normalized = _normalize_url(safe_url)
            if normalized in existing_urls:
                skipped.append({"index": index, "title": clip_data.title, "reason": "已存在相同链接，跳过"})
                continue
            # item 级 savepoint：失败回滚本 item 已 flush 的行，保证报失败=真没写
            # （显式 commit/rollback 而非 with 形式：嵌套 savepoint 的上下文管理器
            #   与测试夹具的 savepoint 重启监听器冲突，显式形式两种环境行为一致）
            savepoint = db.begin_nested()
            try:
                clip = BrowserClip(
                    id=str(uuid.uuid4()),
                    user_id=current_user.id,
                    brain_side=clip_data.brain_side,
                    title=safe_title,
                    url=safe_url,
                    domain=clip_data.domain or _extract_domain(safe_url),
                    excerpt=safe_excerpt,
                    full_text=safe_full_text,
                    status="active",
                    # 租户上下文创建：内容归团队（tenant_id=激活租户），user_id 仍记创建者
                    tenant_id=tenant.id if tenant else None,
                )
                db.add(clip)
                if tenant:
                    _audit(db, tenant.id, current_user, "content_create", "clip", clip.id, safe_title or safe_url)
                db.flush()
                if clip_data.tags is not None:
                    tag_service.set_tags_for(
                        db,
                        content_type=tag_service.CONTENT_TYPE_CLIP,
                        content_id=clip.id,
                        user_id=current_user.id,
                        tag_inputs=clip_data.tags,
                        tenant=tenant,
                    )
            except Exception:
                savepoint.rollback()
                raise
            savepoint.commit()
            queue_auto_link("clip", clip.id, current_user.id, db)
            db.refresh(clip)
            created.append(_build_clip_response(clip, db))
            existing_urls.add(normalized)  # 批内防重
        except Exception as e:
            failures.append({"index": index, "title": clip_data.title, "reason": str(e)})
    
    db.commit()
    return {
        "success_count": len(created),
        "failed_count": len(failures),
        "failures": failures,
        "items": created,
        "skipped_count": len(skipped),
        "skipped": skipped,
    }


@router.post("/fetch-metadata", response_model=List[UrlMetadata], summary="Fetch URL metadata", description="Fetch titles and descriptions for a list of URLs.")
async def fetch_url_metadata(
    request: UrlMetadataRequest,
    current_user: User = Depends(get_current_user)
):
    # _fetch_url_metadata 是同步 urllib 抓取（带 8s 超时），慢页会拖死事件循环；
    # run_in_executor 模式卸载到线程池并发执行。
    # urllib/opener 无共享客户端状态，线程安全，无需额外处理。
    loop = asyncio.get_running_loop()
    return list(await asyncio.gather(*[
        loop.run_in_executor(None, _fetch_url_metadata, url) for url in request.urls
    ]))
