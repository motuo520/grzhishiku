"""默认目录树 + 规则归档。

设计（08-22 拍板 v2）：
- 现成目录树是「起点」不是约束——全部是普通文件夹，删掉/改名即解除
- 二级按内容职能分（不预置主题）：产物夹（概念卡/碰撞火花/可信沉淀）预置规则，开箱即用
- 归档按规则不按名字：文件夹 auto_rules（JSON）命中即入，只动未归档内容
"""
import json
import logging
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.base import Folder

logger = logging.getLogger(__name__)

# 默认目录树（两脑各一套）：打乱重命名自经典的 灵感库/项目/长期关注/参考资料/归档 五段式。
# rules 即 auto_rules 预置：subtypes=知识单元子类型（管线产物）；verification=验证状态（进化线出口）。
DEFAULT_FOLDER_TREE = [
    {"name": "收集箱", "children": [{"name": "闪念速记"}, {"name": "待理素材"}]},
    {"name": "进行中", "children": []},
    {"name": "长线深耕", "children": [
        {"name": "概念卡", "rules": {"subtypes": ["concept"]}},
        {"name": "碰撞火花", "rules": {"subtypes": ["collision_result"]}},
    ]},
    {"name": "素材参考", "children": []},
    {"name": "可信沉淀", "rules": {"verification": ["confirmed"]}, "children": []},
    {"name": "封存", "children": []},
]


def seed_default_folders(db: Session, user_id: str, tenant_id: str = None) -> int:
    """给指定空间的两脑各种一套默认目录树。幂等：某脑已有任何文件夹则跳过该脑。
    返回新建文件夹数。"""
    created = 0
    for brain in ("personal", "network"):
        q = db.query(Folder).filter(Folder.user_id == user_id, Folder.brain_side == brain)
        q = q.filter(Folder.tenant_id == tenant_id) if tenant_id else q.filter(Folder.tenant_id.is_(None))
        if q.first():
            continue
        sort = 0
        for spec in DEFAULT_FOLDER_TREE:
            parent = Folder(
                id=str(uuid.uuid4()), user_id=user_id, tenant_id=tenant_id,
                brain_side=brain, parent_id=None, name=spec["name"], sort_order=sort,
                auto_rules=json.dumps(spec["rules"], ensure_ascii=False) if spec.get("rules") else None,
            )
            db.add(parent)
            db.flush()
            sort += 1
            created += 1
            for child in spec["children"]:
                db.add(Folder(
                    id=str(uuid.uuid4()), user_id=user_id, tenant_id=tenant_id,
                    brain_side=brain, parent_id=parent.id, name=child["name"], sort_order=sort,
                    auto_rules=json.dumps(child["rules"], ensure_ascii=False) if child.get("rules") else None,
                ))
                sort += 1
                created += 1
    if created:
        db.commit()
        logger.info("seeded %d default folders for user=%s tenant=%s", created, user_id, tenant_id)
    return created


def _parse_rules(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def evaluate_archive_rules(db: Session, content_type: str, content_id: str, user_id: str,
                           allow_lane_switch: bool = False) -> bool:
    """按文件夹 auto_rules 归档：未归档内容命中规则即放入（树序先到先得）。

    口径：
    - 绝不抢用户手动归的档；allow_lane_switch=True 时（验证通过等阶段跃迁）
      允许在「规则夹之间」换道（当前夹有 auto_rules 视为系统车道），用户自建/手动夹不动
    - 团队内容不归；'both' 内容匹配两脑的规则夹（个人脑树优先）
    - 规则维度：tags（标签名）/ subtypes（KU 子类型）/ verification（验证状态），夹内 OR
    """
    from app.models.base import Note, KnowledgeUnit, BrowserClip
    from app.services import tag_service

    model = {"note": Note, "knowledge": KnowledgeUnit, "clip": BrowserClip}.get(content_type)
    if model is None:
        return False
    # 全局 autoflush=False：创建链路里内容还在 session.new（未落盘），先认 pending 再查库
    obj = next((p for p in db.new if isinstance(p, model) and getattr(p, "id", None) == content_id), None)
    if obj is None:
        obj = db.query(model).filter(model.id == content_id).first()
    if obj is None or getattr(obj, "tenant_id", None):
        return False
    current_folder = None
    if getattr(obj, "folder_id", None):
        if not allow_lane_switch:
            return False
        current_folder = db.query(Folder).filter(Folder.id == obj.folder_id).first()
        # 换道只许在规则夹之间：当前夹无规则=用户领地，不动
        if current_folder is None or not _parse_rules(current_folder.auto_rules):
            return False
    brain = getattr(obj, "brain_side", None)
    if brain in ("personal", "network"):
        brain_filter = Folder.brain_side == brain
    elif brain == "both":
        brain_filter = Folder.brain_side.in_(["personal", "network"])
    else:
        return False

    tag_names = {t.name for t in tag_service.get_tags_for(db, content_type, content_id)}
    subtype = getattr(obj, "content_subtype", None) if content_type == "knowledge" else None
    verification = getattr(obj, "verification_status", None)

    folders = (
        db.query(Folder)
        .filter(
            Folder.user_id == user_id,
            Folder.tenant_id.is_(None),
            brain_filter,
            Folder.auto_rules.isnot(None),
        )
        # 个人脑优先（both 内容的归宿），同脑按树序
        .order_by(Folder.brain_side != "personal", Folder.sort_order, Folder.created_at)
        .all()
    )
    for f in folders:
        rules = _parse_rules(f.auto_rules)
        if not rules:
            continue
        if current_folder is not None and f.id == current_folder.id:
            continue  # 跳过当前夹，继续找后续规则夹（换道场景）
        hit = (
            any(t in tag_names for t in rules.get("tags", []))
            or (subtype and subtype in rules.get("subtypes", []))
            or (verification and verification in rules.get("verification", []))
        )
        if hit:
            obj.folder_id = f.id
            logger.info("rule-filed %s %s -> folder %s (%s)", content_type, content_id, f.id, f.name)
            return True
    return False
