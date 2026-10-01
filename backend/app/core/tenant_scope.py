"""租户上下文（企业版 MVP 数据口径）。

口径（拍板）：
- user.tenant_id 表示「当前激活租户」；成员被移除/租户停用后残留一律视为个人空间。
- 团队空间内内容全员可见可读写删（成员级共享，不做部门隔离）。
- 团队内容归属团队：成员退出/注销不随个人删除（删除侧见 users._delete_user_content
  的 tenant_id IS NULL 条件）。
- 文件夹/标签同样按空间口径：团队夹/团队标签已上线，租户上下文里 folders/tags
  与内容一样走 content_filter（空间+名称唯一，跨空间引用 404）。
"""
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.base import User, Tenant
from app.models.tenant import TenantMember


def get_active_tenant(db: Session, user: User) -> Optional[Tenant]:
    """返回用户当前激活的租户；tenant_id 失效（成员被移除/租户停用/残留）返回 None，视为个人空间。"""
    if not user.tenant_id:
        return None
    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id, Tenant.status == "active").first()
    if not tenant:
        return None
    membership = db.query(TenantMember).filter(
        TenantMember.tenant_id == tenant.id,
        TenantMember.user_id == user.id,
        TenantMember.status == "active",
    ).first()
    if not membership:
        return None
    return tenant


def scope_condition(model, user_id: str, tenant: Optional[Tenant]):
    """内容归属条件：租户上下文 → model.tenant_id == T；个人空间 → 本人且 tenant_id 为空。"""
    if tenant is not None:
        return model.tenant_id == tenant.id
    return and_(model.user_id == user_id, model.tenant_id.is_(None))


def content_filter(query, model, user: User, tenant: Optional[Tenant]):
    """按租户上下文约束内容查询（retrieval 等只有 user_id 的场景用 scope_condition）。"""
    return query.filter(scope_condition(model, user.id, tenant))


def semantic_visible(model):
    """语义加工层可见性条件（09-19 仓库模式门禁）：index_only=True 的内容只进
    检索层（FTS/向量/SQL 直查，RAG 照常可答），不进语义加工层——图谱语料 /
    wiki 编译 / 自动打标 / 复盘素材等消费方一律加本条件过滤。

    血泪#78 纪律：检索层查询（FTS/向量/保底/普查/站内统计/存储计费）一律
    不要用本条件——仓库内容必须照常可答、照常计数。NULL 兼容存量行。
    """
    from sqlalchemy import or_
    return or_(model.index_only.is_(None), model.index_only.is_(False))


def audit(db: Session, tenant_id: str, actor: User, action: str, target_type: str,
          target_id: Optional[str] = None, detail: Optional[str] = None) -> None:
    """写一条租户审计流水（不 commit，由调用方统一提交）。

    actor_email 冗余存，防用户注销后查不到名；detail 截断 80 字。
    只在团队上下文调用（个人空间操作不记审计）。
    """
    from app.models.tenant import TenantAudit
    import uuid as _uuid
    db.add(TenantAudit(
        id=str(_uuid.uuid4()),
        tenant_id=tenant_id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=(detail or "")[:80] or None,
    ))


# ---------------------------------------------------------------------------
# 目录级权限判定单点（10-01 立项，血泪#85：规则单点化，所有查询路径只调这里）
#
# 语义（拍板）：
# - 仅团队空间有效；个人空间单人单库，恒空集（行为零变化）。
# - Folder.visibility：inherit（沿 parent_id 上溯，≤3 层）/ private（仅创建者）
#   / restricted（folder_shares 授权清单：user 直授 或 group 经分组成员间授）。
# - 最近的非 inherit 夹决定生效可见性（自>父>祖）；restricted/private 夹的创建者
#   恒可见；租户 owner/admin 全局旁路。
# - 内容的可见性 = 其 folder_id 所属夹的生效可见性；folder_id IS NULL 不受限。
# ---------------------------------------------------------------------------

def _tenant_member_role(db: Session, user: User, tenant) -> Optional[str]:
    m = db.query(TenantMember).filter(
        TenantMember.tenant_id == tenant.id,
        TenantMember.user_id == user.id,
        TenantMember.status == "active",
    ).first()
    return m.role if m else None


def invisible_folder_ids(db: Session, user: User, tenant) -> frozenset:
    """当前用户在该空间内不可见的文件夹 id 集（frozenset，可能为空）。

    个人空间/无文件夹/owner/admin 短路为空集。每次请求现算（不做全局缓存，
    授权变更即时生效，无缓存失效难题）；一次查询拉全量夹+授权行内存判定，
    不逐层查库。
    """
    if tenant is None:
        return frozenset()
    from app.models.folder import Folder
    from app.models.groups import FolderShare, UserGroupMember

    folders = db.query(Folder).filter(Folder.tenant_id == tenant.id).all()
    if not folders:
        return frozenset()
    if _tenant_member_role(db, user, tenant) in ("owner", "admin"):
        return frozenset()

    by_id = {f.id: f for f in folders}

    def _effective(folder):
        """沿父链上溯找最近非 inherit 夹，返回 (visibility, 决定夹)。内存走 map。"""
        cur = folder
        for _ in range(4):  # 树限 3 层，多留一档防脏数据自环
            vis = getattr(cur, "visibility", None) or "inherit"
            if vis != "inherit":
                return vis, cur
            nxt = by_id.get(cur.parent_id) if cur.parent_id else None
            if nxt is None or nxt.id == cur.id:
                break
            cur = nxt
        return "inherit", None

    # 本人可见的 restricted 决定夹集合：直授 + 分组成员间授
    my_group_ids = {r[0] for r in db.query(UserGroupMember.group_id).filter(
        UserGroupMember.user_id == user.id,
    ).all()}
    shares = db.query(FolderShare).filter(
        FolderShare.folder_id.in_(list(by_id)),
    ).all()
    visible_restricted = set()
    for s in shares:
        if s.grantee_type == "user" and s.grantee_id == user.id:
            visible_restricted.add(s.folder_id)
        elif s.grantee_type == "group" and s.grantee_id in my_group_ids:
            visible_restricted.add(s.folder_id)

    invisible = set()
    for f in folders:
        vis, decider = _effective(f)
        if vis == "private":
            if f.user_id != user.id:
                invisible.add(f.id)
        elif vis == "restricted" and decider is not None:
            if decider.user_id != user.id and decider.id not in visible_restricted:
                invisible.add(f.id)
    return frozenset(invisible)


def content_visible_condition(db: Session, model, user: User, tenant, inv: Optional[frozenset] = None):
    """内容级 SQLAlchemy 过滤条件：folder_id 为空或不在不可见集。直接叠加在
    content_filter 之后（各路径只调它，别各自实现）。model 必须有 folder_id 列。
    inv：调用方一次请求内多处过滤时可预算不可见集传入，避免每处重算（规则仍单点）。"""
    if inv is None:
        inv = invisible_folder_ids(db, user, tenant)
    if not inv:
        from sqlalchemy import true
        return true()
    from sqlalchemy import or_
    return or_(model.folder_id.is_(None), ~model.folder_id.in_(list(inv)))


def is_content_visible(db: Session, folder_id: Optional[str], user: User, tenant,
                       inv: Optional[frozenset] = None) -> bool:
    """单点判定（非 SQL 路径用：FTS/向量命中回表、图谱节点等按 content 行判）。"""
    if not folder_id:
        return True
    if inv is None:
        inv = invisible_folder_ids(db, user, tenant)
    return folder_id not in inv
