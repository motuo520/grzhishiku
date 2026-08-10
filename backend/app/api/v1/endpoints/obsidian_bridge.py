# -*- coding: utf-8 -*-
"""Obsidian 导入桥 + Markdown 导出。

POST /import/obsidian  — 扫描本地 Obsidian vault，把 .md 增量导入为笔记，
                         并把 wiki 链接解析为图谱边（幂等，可重复导入做增量同步）。
POST /export/markdown  — 把当前用户的笔记 / 知识单元导出为带 YAML frontmatter
                         的 Markdown 目录，图谱边回写为「## 相关」wiki 链接段。
"""

import json
import re
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

try:
    import yaml
except ImportError:  # pragma: no cover - pyyaml 不可用时降级为不解析 frontmatter
    yaml = None

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.base import User, Note, KnowledgeUnit, GraphEdge, Tag, content_tags

router = APIRouter()

MAX_VAULT_FILES = 5000
EXPORT_DIR_NAME = "_钤记"  # 钤记导出目录；导入时跳过，避免自我循环
WIKI_LINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?", re.DOTALL)
INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


class ObsidianImportRequest(BaseModel):
    vault_path: str


class MarkdownExportRequest(BaseModel):
    target_dir: str


# ---------------------------------------------------------------- 解析工具

def _parse_frontmatter(text: str) -> Tuple[dict, str]:
    """拆分 YAML frontmatter，返回 (meta, body)。解析失败按无 frontmatter 处理。"""
    m = FRONTMATTER_RE.match(text)
    if not m or yaml is None:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return {}, text
    if not isinstance(meta, dict):
        meta = {}
    return meta, text[m.end():]


def _as_str_list(value) -> List[str]:
    """frontmatter 的 tags / aliases 可能是 str 或 list，统一成字符串列表。"""
    if value is None:
        return []
    if isinstance(value, str):
        v = value.strip()
        return [v] if v else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value)]


def _parse_wiki_target(raw: str) -> str:
    """[[target|alias]] / [[target#heading]] / [[target^block]] -> target。"""
    target = raw.split("|", 1)[0]
    target = target.split("#", 1)[0]
    target = target.split("^", 1)[0]
    return target.strip()


def _scan_markdown(vault: Path) -> Tuple[List[Path], int]:
    """递归收集 .md 文件；跳过隐藏目录（.obsidian 等）和导出目录 _钤记/。
    返回 (文件列表, 跳过的隐藏 md 数)。"""
    files: List[Path] = []
    skipped = 0

    def walk(directory: Path) -> None:
        nonlocal skipped
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            return
        for entry in entries:
            if entry.is_dir():
                if entry.name.startswith(".") or entry.name == EXPORT_DIR_NAME:
                    continue
                walk(entry)
            elif entry.suffix.lower() == ".md":
                if entry.name.startswith("."):
                    skipped += 1
                    continue
                files.append(entry)

    walk(vault)
    return files, skipped


def _safe_filename(name: str, used: set) -> str:
    """去掉 Windows 非法字符，重名追加序号。"""
    base = INVALID_FILENAME_CHARS.sub("_", (name or "").strip()).strip(". ")
    if not base:
        base = "未命名"
    base = base[:80]
    candidate, i = base, 2
    while candidate.lower() in used:
        candidate = f"{base} ({i})"
        i += 1
    used.add(candidate.lower())
    return candidate


def _dump_frontmatter(meta: dict) -> str:
    if yaml is None:  # pragma: no cover
        lines = "\n".join(f"{k}: {v}" for k, v in meta.items())
        return f"---\n{lines}\n---\n\n"
    body = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{body}\n---\n\n"


# ---------------------------------------------------------------- 导入

@router.post(
    "/import/obsidian",
    summary="Import Obsidian vault",
    description="Scan a local Obsidian vault directory and import all Markdown files as notes. "
                "Idempotent: existing notes (matched by title) are updated, wiki links become graph edges.",
)
async def import_obsidian_vault(
    req: ObsidianImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vault = Path(req.vault_path.strip()).expanduser() if req.vault_path.strip() else None
    if vault is None:
        raise HTTPException(status_code=400, detail="vault_path 不能为空")
    # 根目录白名单防路径穿越（默认用户主目录，可用 OBSIDIAN_VAULT_ROOT 覆盖）
    from app.core.config import settings
    allowed_root = Path(getattr(settings, "OBSIDIAN_VAULT_ROOT", None) or "~").expanduser().resolve()
    try:
        vault.resolve().relative_to(allowed_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="vault_path 不在允许的目录范围内")
    if not vault.exists():
        raise HTTPException(status_code=400, detail=f"路径不存在: {vault}")
    if not vault.is_dir():
        raise HTTPException(status_code=400, detail=f"路径不是目录: {vault}")

    md_files, skipped_files = _scan_markdown(vault)
    if len(md_files) > MAX_VAULT_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"库中 Markdown 文件超过 {MAX_VAULT_FILES} 个（{len(md_files)}），请分批导入",
        )

    notes_created = 0
    notes_updated = 0
    imported: List[Note] = []
    alias_by_note: Dict[str, List[str]] = {}

    for path in md_files:
        rel = path.relative_to(vault)
        title = rel.with_suffix("").as_posix()  # 如 "Bases/Functions"
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            skipped_files += 1
            continue

        meta, body = _parse_frontmatter(raw)
        wiki_targets = [m.group(1).strip() for m in WIKI_LINK_RE.finditer(body)]
        forward_links = json.dumps(wiki_targets, ensure_ascii=False)
        aliases = _as_str_list(meta.get("aliases")) + _as_str_list(meta.get("alias"))
        fm_tags = [t.lstrip("#") for t in _as_str_list(meta.get("tags"))]

        note = (
            db.query(Note)
            .filter(Note.user_id == current_user.id, Note.title == title)
            .first()
        )
        if note:
            # 幂等：重复导入 = 增量同步，更新内容但不动 created_at
            note.content = body
            note.forward_links = forward_links
            note.content_format = "markdown"
            if note.status != "active":
                note.status = "active"
            notes_updated += 1
        else:
            note = Note(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                title=title,
                content=body,
                content_format="markdown",
                brain_side="personal",
                origin_type="obsidian_import",
                forward_links=forward_links,
                status="active",
            )
            db.add(note)
            db.flush()
            notes_created += 1
        imported.append(note)
        alias_by_note[note.id] = aliases

        # frontmatter tags -> 建/复用 Tag 并关联（content_tags 关联表）
        for tag_name in fm_tags:
            tag = (
                db.query(Tag)
                .filter(Tag.user_id == current_user.id, Tag.name == tag_name)
                .first()
            )
            if not tag:
                tag = Tag(id=str(uuid.uuid4()), user_id=current_user.id, name=tag_name)
                db.add(tag)
                db.flush()
            exists = db.execute(
                content_tags.select().where(
                    content_tags.c.content_id == note.id,
                    content_tags.c.content_type == "note",
                    content_tags.c.tag_id == tag.id,
                )
            ).first()
            if not exists:
                db.execute(
                    content_tags.insert().values(
                        content_id=note.id, content_type="note", tag_id=tag.id
                    )
                )

    # ---- wiki 链接 -> GraphEdge ----
    # 解析顺序：文件名 stem（小写）→ frontmatter 别名 → 相对路径标题
    stem_map: Dict[str, Note] = {}
    alias_map: Dict[str, Note] = {}
    path_map: Dict[str, Note] = {}
    for note in imported:
        path_map.setdefault(note.title.lower(), note)
        stem = note.title.rsplit("/", 1)[-1].lower()
        stem_map.setdefault(stem, note)
        for alias in alias_by_note.get(note.id, []):
            alias_map.setdefault(alias.lower(), note)

    existing_edges = {
        (e.source_id, e.target_id)
        for e in db.query(GraphEdge.source_id, GraphEdge.target_id)
        .filter(GraphEdge.user_id == current_user.id, GraphEdge.edge_type == "wiki")
        .all()
    }

    edges_created = 0
    unresolved_links = 0
    for note in imported:
        for raw_target in json.loads(note.forward_links or "[]"):
            target_key = _parse_wiki_target(raw_target)
            if not target_key:
                continue
            target = (
                stem_map.get(target_key.rsplit("/", 1)[-1].lower())
                or alias_map.get(target_key.lower())
                or path_map.get(target_key.lower())
            )
            if not target or target.id == note.id:
                unresolved_links += 1
                continue
            if (note.id, target.id) in existing_edges:
                continue
            db.add(
                GraphEdge(
                    id=str(uuid.uuid4()),
                    user_id=current_user.id,
                    source_id=note.id,
                    target_id=target.id,
                    source_brain_side=note.brain_side or "personal",
                    target_brain_side=target.brain_side or "personal",
                    edge_type="wiki",
                    strength=1.5,  # 人工 wiki 链接，权重高于机器边
                    weight=1.0,
                    context=f"obsidian: [[{raw_target}]]",
                    cross_brain=False,
                    auto_created=False,
                )
            )
            existing_edges.add((note.id, target.id))
            edges_created += 1

    db.commit()
    return {
        "files": len(md_files),
        "notes_created": notes_created,
        "notes_updated": notes_updated,
        "edges_created": edges_created,
        "unresolved_links": unresolved_links,
        "skipped_files": skipped_files,
    }


# ---------------------------------------------------------------- 导出

@router.post(
    "/export/markdown",
    summary="Export notes to Markdown",
    description="Export all active notes and knowledge units as Markdown files with YAML frontmatter. "
                "Graph edges are written back as wiki links under a '## 相关' section.",
)
async def export_markdown(
    req: MarkdownExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw_dir = (req.target_dir or "").strip()
    if not raw_dir:
        raise HTTPException(status_code=400, detail="target_dir 不能为空")
    target = Path(raw_dir).expanduser()
    # 防止误写根目录（C:\ 或 /）
    if target.parent == target:
        raise HTTPException(status_code=400, detail="不允许直接导出到根目录")
    # 根目录白名单防路径穿越/任意文件写（默认用户主目录，可用 OBSIDIAN_EXPORT_ROOT 覆盖）
    from app.core.config import settings
    allowed_export_root = Path(getattr(settings, "OBSIDIAN_EXPORT_ROOT", None) or "~").expanduser().resolve()
    try:
        target.resolve().relative_to(allowed_export_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="target_dir 不在允许的目录范围内")

    notes_dir = target / "notes"
    knowledge_dir = target / "knowledge"
    try:
        notes_dir.mkdir(parents=True, exist_ok=True)
        knowledge_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"无法创建导出目录: {e}")

    notes = (
        db.query(Note)
        .filter(Note.user_id == current_user.id, Note.status == "active")
        .order_by(Note.created_at)
        .all()
    )
    units = (
        db.query(KnowledgeUnit)
        .filter(KnowledgeUnit.user_id == current_user.id, KnowledgeUnit.status == "active")
        .order_by(KnowledgeUnit.first_seen)
        .all()
    )

    # 导出内容的 id -> 标题映射，用于图谱边回写成 wiki 链接
    title_by_id: Dict[str, str] = {}
    for n in notes:
        title_by_id[n.id] = n.title
    for u in units:
        title_by_id[u.id] = u.source_title or u.content_type or "未命名知识"

    # 每个笔记的相关目标（出边 + 入边，去重）
    related: Dict[str, List[str]] = {n.id: [] for n in notes}
    edges = db.query(GraphEdge).filter(GraphEdge.user_id == current_user.id).all()
    for e in edges:
        for src, dst in ((e.source_id, e.target_id), (e.target_id, e.source_id)):
            if src in related and dst in title_by_id and dst != src:
                title = title_by_id[dst]
                if title not in related[src]:
                    related[src].append(title)

    used_names: set = set()
    exported_notes = 0
    for n in notes:
        filename = _safe_filename(n.title, used_names) + ".md"
        meta = {
            "title": n.title,
            "created": n.created_at.isoformat() if n.created_at else None,
            "updated": n.updated_at.isoformat() if n.updated_at else None,
            "brain_side": n.brain_side,
        }
        text = _dump_frontmatter(meta) + (n.content or "")
        if related[n.id]:
            links = "\n".join(f"- [[{t}]]" for t in sorted(related[n.id]))
            text += f"\n\n## 相关\n\n{links}\n"
        try:
            (notes_dir / filename).write_text(text, encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"写入失败 {filename}: {e}")
        exported_notes += 1

    used_names = set()
    exported_knowledge = 0
    for u in units:
        title = title_by_id[u.id]
        filename = _safe_filename(title, used_names) + ".md"
        meta = {
            "title": title,
            "source_title": u.source_title,
            "verification_status": u.verification_status,
            "trust_level": u.trust_level,
            "brain_side": u.brain_side,
        }
        text = _dump_frontmatter(meta) + (u.content_raw or "")
        try:
            (knowledge_dir / filename).write_text(text, encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"写入失败 {filename}: {e}")
        exported_knowledge += 1

    return {
        "exported_notes": exported_notes,
        "exported_knowledge": exported_knowledge,
        "target_dir": str(target),
    }
