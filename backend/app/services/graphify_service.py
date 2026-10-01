"""Graphify integration: export user content to a markdown corpus and build/query a knowledge graph via the graphify CLI.

Layout:
  backend/graphify_data/{user_id}/corpus/*.md                 # 个人空间：exported source documents
  backend/graphify_data/{user_id}/corpus/graphify-out/        # graph.json / graph.html / GRAPH_REPORT.md
  backend/graphify_data/tenant_{tenant_id}/corpus/...         # 团队空间：同上结构，按租户分目录

Node → source mapping: each exported file is named `{type}__{source_id}.md`,
and graphify records the file path on every extracted node, so the frontend can
jump from a graph node back to the originating note/clip/knowledge unit.

空间口径（09-12 双空间隔离，产物目录空间化已落地）：
- 产物目录：个人空间沿用 graphify_data/{user_id}（存量零迁移，桌面端 tenant 恒
  None，行为逐字节不变）；团队空间用 graphify_data/tenant_{tenant_id}/（团队图谱是
  全新能力，无存量）。目录函数（_space_dir/_corpus_dir/_out_dir/_graph_json_path）
  与语义缓存播种/收割/看门狗、load_graph 全链一律带 tenant_id 形参。
- 构建状态（graph_build_state 表 + 内存 _build_status）按空间分行：个人空间一行、
  团队空间共享一行，互不覆盖；断点续建/自进化/启动恢复逐空间处理。状态函数一律带
  tenant_id 形参。
- 边同步（sync_edges_from_build）整删只动本空间：个人=user_id+tenant 空、
  团队=tenant_id=T 不限作者——团队构建不再误删个人边（边行 tenant 戳由
  _create_edge 按出处内容行自动盖）。
- 自进化（配置在 user.settings，个人级）：团队空间口径（09-12 拍板）——团队空间
  构建后按触发者的个人设置跑自进化；写入监听捕团队内容（user_id, tenant_id）对，
  触发团队空间重建（用写入者自己的配置与模型）。不动表结构、不引入团队级配置。
"""

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.base import User, Note, BrowserClip, KnowledgeUnit, GraphEdge, GraphBuildState

logger = logging.getLogger(__name__)

def _resolve_data_root() -> Path:
    """图谱数据根目录。

    优先 GRAPHIFY_DATA_DIR / PSB_DATA_DIR（用户数据目录）；回退包内路径仅用于
    开发环境。**绝不能落在安装目录**：frozen 下包内路径 = _internal/graphify_data，
    每次自动更新整个 resources 目录被替换，图谱被连锅端（「每次更新后图谱要重建」
    的根因，0.2.49 修复）。"""
    env = os.environ.get("GRAPHIFY_DATA_DIR")
    if env:
        return Path(env)
    psb = os.environ.get("PSB_DATA_DIR")
    if psb:
        return Path(psb) / "graphify_data"
    return Path(__file__).resolve().parents[2] / "graphify_data"


DATA_ROOT = _resolve_data_root()
_LEGACY_PKG_ROOT = Path(__file__).resolve().parents[2] / "graphify_data"


def migrate_legacy_data_root() -> None:
    """把落在安装目录（旧 DATA_ROOT）的图谱数据迁到用户数据目录。

    逐用户目录移动，目标已存在则跳过（重复启动幂等）；旧目录残留留给下次
    更新自然清理。失败只记日志不影响启动。"""
    try:
        if DATA_ROOT == _LEGACY_PKG_ROOT or not _LEGACY_PKG_ROOT.is_dir():
            return
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        moved = 0
        for child in _LEGACY_PKG_ROOT.iterdir():
            dst = DATA_ROOT / child.name
            if dst.exists():
                continue
            try:
                shutil.move(str(child), str(dst))
                moved += 1
            except Exception:
                try:
                    if child.is_dir():
                        shutil.copytree(child, dst)
                    else:
                        shutil.copy2(child, dst)
                    moved += 1
                except Exception as e:
                    logger.warning("graphify data migration failed for %s: %s", child.name, e)
        if moved:
            logger.info("graphify data migrated to user data dir: %d entries -> %s", moved, DATA_ROOT)
    except Exception as e:
        logger.warning("graphify data migration skipped: %s", e)
VALID_TYPES = {"note", "clip", "knowledge", "document"}  # document 09-17 P2-4 入图

# user_id -> build status（内存读缓存；graph_build_state 表为持久层，重启可水合/断点续建）
# 09-12 起键为空间键（_space_key）：个人空间沿用裸 user_id（桌面端 tenant 恒 None，
# 键形逐字节不变），团队空间带租户后缀——两空间的构建状态在内存里同样互不覆盖
_build_status: Dict[str, Dict[str, Any]] = {}
# RLock：start_build_background 的「检查+置状态+起线程」须整体持锁（防同用户并发双开），
# 而临界区内的 get_build_status/_set_build_status 也会再拿这把锁
_build_lock = threading.RLock()


def _space_key(user_id: str, tenant_id: Optional[str] = None) -> str:
    """构建状态内存键：个人空间 = 裸 user_id；团队空间 = user_id + 租户后缀。"""
    return f"{user_id}::t:{tenant_id}" if tenant_id else user_id


def _state_row_filter(user_id: str, tenant_id: Optional[str] = None):
    """graph_build_state 行口径（与模型注释一致）：个人 = 本人 + tenant_id='' 占位行；
    团队 = tenant_id=T 共享一行（不限作者——构建是整个空间的资源，谁触发都读写同一行）。
    '' 占位而非 NULL：SQLite 复合主键里 NULL 互不判等，(user, NULL) 可插重复行。"""
    if tenant_id:
        return GraphBuildState.tenant_id == tenant_id
    return and_(GraphBuildState.user_id == user_id, GraphBuildState.tenant_id == "")


def _user_dir(user_id: str) -> Path:
    # user_id 白名单校验，防路径穿越
    if not re.fullmatch(r"[A-Za-z0-9_-]+", user_id or ""):
        raise ValueError(f"Invalid user_id: {user_id}")
    return DATA_ROOT / user_id


def _space_dir(user_id: str, tenant_id: Optional[str] = None) -> Path:
    """空间根目录（09-12 产物目录空间化）：个人空间沿用 graphify_data/{user_id}
    （存量零迁移，桌面端 tenant 恒 None 逐字节不变）；团队空间 graphify_data/
    tenant_{tenant_id}/（全新能力无存量，租户级共享一份产物）。"""
    if tenant_id:
        # tenant_id 白名单校验，防路径穿越（同 _user_dir）
        if not re.fullmatch(r"[A-Za-z0-9_-]+", tenant_id):
            raise ValueError(f"Invalid tenant_id: {tenant_id}")
        return DATA_ROOT / f"tenant_{tenant_id}"
    return _user_dir(user_id)


def _corpus_dir(user_id: str, tenant_id: Optional[str] = None) -> Path:
    return _space_dir(user_id, tenant_id) / "corpus"


def _out_dir(user_id: str, tenant_id: Optional[str] = None) -> Path:
    # graphify extract writes graphify-out/ INSIDE the input directory
    return _corpus_dir(user_id, tenant_id) / "graphify-out"


def _graph_json_path(user_id: str, tenant_id: Optional[str] = None) -> Path:
    return _out_dir(user_id, tenant_id) / "graph.json"


def _slug(text: str, max_len: int = 60) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    return text[:max_len] or "untitled"


def _yaml_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace('"', '\\"')


def _write_doc(corpus: Path, doc_type: str, source_id: str, title: str, body: str,
               extra_meta: Optional[Dict[str, str]] = None) -> None:
    if doc_type not in VALID_TYPES:
        return
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", source_id)
    if not safe_id:
        return
    meta = [
        "---",
        f'id: "{_yaml_escape(source_id)}"',
        f'type: "{doc_type}"',
        f'title: "{_yaml_escape(_slug(title))}"',
    ]
    for k, v in (extra_meta or {}).items():
        if v:
            meta.append(f'{k}: "{_yaml_escape(str(v))}"')
    meta.append("---")
    meta.append("")
    meta.append(f"# {_slug(title)}")
    meta.append("")
    meta.append((body or "").strip() or "(无正文)")
    (corpus / f"{doc_type}__{safe_id}.md").write_text("\n".join(meta), encoding="utf-8")


def export_user_corpus(db: Session, user_id: str, tenant_id: Optional[str] = None) -> Dict[str, int]:
    """Rewrite the user's corpus documents from current DB content. Returns counts.

    Only the exported *.md files are replaced; corpus/graphify-out/ (the last
    built graph) is preserved so it stays readable until a new build swaps in.

    空间口径（09-12）：tenant_id 非空=团队空间全团内容，否则=本人个人空间行
    （user_id + tenant_id IS NULL，口径同 community_digest._physical_fingerprint）。
    语料落本空间目录（个人={user_id}/，团队=tenant_{tenant_id}/，见 _space_dir）。
    """
    def _scope(model):
        # 内容表个人口径是 tenant_id IS NULL（'' 占位只是 graph_build_state 的特例）
        if tenant_id:
            return model.tenant_id == tenant_id
        return and_(model.user_id == user_id, model.tenant_id.is_(None))

    # 目录级权限（批 C）：团队空间语料剔除不可见夹内容（restricted/private 夹不
    # 进图）。图谱是空间级共享视图，按「任一成员不可见即不入语料」保守口径——
    # 构建是后台全量行为，无法绑定单个请求者，故以「对全体普通成员可见」为准：
    # 只要夹对任一 active 普通成员不可见就剔除（owner/admin 旁路不算）。
    # 已建边不做实时清退：授权收紧后旧边随下次重建自然消退。
    from app.core.tenant_scope import content_visible_condition
    _vis_inv = frozenset()
    if tenant_id:
        from app.core.tenant_scope import invisible_folder_ids
        from app.models.base import Tenant
        from app.models.tenant import TenantMember
        _tenant = db.get(Tenant, tenant_id)
        if _tenant is not None:
            # 逐普通成员求不可见集并集（构建者无关口径）
            for (_uid,) in db.query(TenantMember.user_id).filter(
                TenantMember.tenant_id == tenant_id,
                TenantMember.status == "active",
                ~TenantMember.role.in_(("owner", "admin")),
            ).all():
                _u = db.get(User, _uid)
                if _u is not None:
                    _vis_inv = _vis_inv | invisible_folder_ids(db, _u, _tenant)

    def _vis(model):
        # 个人空间恒真（零变化）；团队空间剔除对普通成员不可见的夹
        return content_visible_condition(db, model, None, None, inv=_vis_inv)

    corpus = _corpus_dir(user_id, tenant_id)
    corpus.mkdir(parents=True, exist_ok=True)
    for stale_doc in corpus.glob("*.md"):
        stale_doc.unlink()

    counts = {"note": 0, "clip": 0, "knowledge": 0}

    from app.core.tenant_scope import semantic_visible

    # Only live content belongs in the graph: soft-deleted/rejected items must
    # not keep influencing extraction after the user removed them.
    # 仓库模式（09-19）：index_only 内容只进检索层，不进图谱语料
    for note in db.query(Note).filter(_scope(Note), Note.status == "active", semantic_visible(Note), _vis(Note)).all():
        _write_doc(corpus, "note", note.id, note.title or "无标题笔记", note.content or "",
                   {"created_at": note.created_at.isoformat() if note.created_at else ""})
        counts["note"] += 1

    for clip in db.query(BrowserClip).filter(_scope(BrowserClip), BrowserClip.status == "active", semantic_visible(BrowserClip), _vis(BrowserClip)).all():
        body = clip.full_text or clip.excerpt or ""
        _write_doc(corpus, "clip", clip.id, clip.title or clip.url or "未命名剪藏", body,
                   {"url": clip.url or "", "domain": clip.domain or ""})
        counts["clip"] += 1

    # debunked（证伪）知识不进图谱语料——错误知识进图谱比不进更糟
    for ku in db.query(KnowledgeUnit).filter(
        _scope(KnowledgeUnit),
        KnowledgeUnit.status == "active",
        _vis(KnowledgeUnit),
        or_(
            KnowledgeUnit.verification_status != "debunked",
            KnowledgeUnit.verification_status.is_(None)
        ),
    ).all():
        _write_doc(corpus, "knowledge", ku.id, ku.source_title or "知识单元", ku.content_raw or "",
                   {"url": ku.source_url or ""})
        counts["knowledge"] += 1

    # 文档入图（09-17 P2-4 多模态节点 v1）：口径=向量前拦门同款——active+
    # extraction_status=success+正文长度门槛（文本类 ≥200 字、图片类 ≥20 字，
    # 图片判定复用 document_service.is_image_document）；OCR 文本/表格 markdown
    # 现成在 content_text。frontmatter 带 file_type 供下游判图片节点。
    from app.models.content import Document
    from app.services.document_service import is_image_document
    counts["document"] = 0
    for doc in db.query(Document).filter(
        _scope(Document),
        Document.doc_status == "active",
        Document.extraction_status == "success",
        semantic_visible(Document),  # 仓库模式不入图
        _vis(Document),  # 目录级权限（批 C）：不可见夹文档不入图
    ).all():
        body = (doc.content_text or "").strip()
        _min_len = 20 if is_image_document(doc.file_path, doc.file_type) else 200
        if len(body) < _min_len:
            continue
        _write_doc(corpus, "document", doc.id, doc.title or doc.original_name or "未命名文档",
                   body, {"file_type": doc.file_type or ""})
        counts["document"] += 1

    return counts


# provider → (graphify 后端, 模型环境变量, key 环境变量)
# opencode/glm/dashscope 无专属后端：OpenAI 兼容，走 openai 后端 + 换 base_url。
# kimi 后端模型固定 k2.6（无 model env，且命名是点号 k2.6 vs 目录连字符 k2-6），
# 所有 kimi 型号统一绕道 openai 兼容 + GRAPHIFY_LLM_TEMPERATURE=none（k2.6 拒显式温度）。
_PROVIDER_GRAPH_SPEC = {
    "ollama": ("ollama", "OLLAMA_MODEL", []),
    "deepseek": ("deepseek", "GRAPHIFY_DEEPSEEK_MODEL", ["DEEPSEEK_API_KEY"]),
    "kimi": ("openai", "GRAPHIFY_OPENAI_MODEL", ["OPENAI_API_KEY"]),
    "openai": ("openai", "GRAPHIFY_OPENAI_MODEL", ["OPENAI_API_KEY"]),
    "google": ("gemini", "GRAPHIFY_GEMINI_MODEL", ["GEMINI_API_KEY"]),
    "anthropic": ("claude", "ANTHROPIC_MODEL", ["ANTHROPIC_API_KEY"]),
    "opencode": ("openai", "GRAPHIFY_OPENAI_MODEL", ["OPENAI_API_KEY"]),
    "glm": ("openai", "GRAPHIFY_OPENAI_MODEL", ["OPENAI_API_KEY"]),
    "dashscope": ("openai", "GRAPHIFY_OPENAI_MODEL", ["OPENAI_API_KEY"]),
}


# 推理档/强制思考模型黑名单（09-03 实捕：sys-glm-5.3-flash 建 793 篇大图，
# 配速 ~30s/篇，必撞 4h 总时限卡死）。批量图谱抽取是配速敏感型任务——
# 构建选择器和后端双重禁入；超时预算在 build 里按此分级。
REASONING_MODEL_PATTERNS = ("glm-5.3-flash", "glm-5.2", "reasoner", "-o1", "-o3", "-o4")


def is_reasoning_model(model_id: Optional[str]) -> bool:
    """是否推理档（强制思考）模型：批量图谱构建禁入（配速 3-10 倍超标）。"""
    mid = (model_id or "").lower()
    return any(p in mid for p in REASONING_MODEL_PATTERNS)


def _resolve_build_backend(
    db, preferred_model: Optional[str], user_settings: Optional[Dict[str, Any]]
) -> Optional[tuple]:
    """把用户选的构建模型解析为 (graphify 后端, env 覆盖)；解析不出返回 None（回退默认链）。

    修复前：_pick_backend 只认 ModelConfig 静态表且只映射 5 家 provider，opencode 系
    全部落空——云端静默回落 deepseek、桌面静默回落 ollama（「选了模型但还是本地/DP
    在抽」的根因）；且所有后端的 model env 都没设，CLI 实际跑的是各家默认型号。
    key 解析顺序：用户 BYOK settings → 平台账户（llm_provider_router）→ 服务端环境配置。
    """
    if not preferred_model or preferred_model.startswith("platform:"):
        return None
    from app.core.config import settings as app_settings
    from app.services.llm_service import ModelConfig

    cfg = ModelConfig.get(preferred_model)
    if cfg:
        provider = cfg["provider"].value
        pmid = cfg.get("model_id") or preferred_model
    else:
        provider = pmid = None
        if db is not None:
            from app.models.llm_billing import LLMModel
            row = db.query(LLMModel).filter(LLMModel.id == preferred_model).first()
            if row:
                provider, pmid = row.provider, (row.provider_model_id or preferred_model)
    if not provider:
        return None
    spec = _PROVIDER_GRAPH_SPEC.get(provider)
    if not spec:
        return None
    backend, model_env, key_envs = spec

    # key：BYOK → 平台账户 → 服务端环境
    ai = (user_settings or {}).get("ai") or {}
    key = ai.get(f"{provider}_api_key") or None
    base_url = None
    if not key and db is not None:
        try:
            from app.services.llm_provider_router import LLMProviderRouter
            creds = LLMProviderRouter(db).get_credentials(provider)
            if creds:
                key, base_url = creds.get("api_key"), creds.get("base_url")
        except Exception:
            pass
    if not key:
        key = getattr(app_settings, f"{provider.upper()}_API_KEY", None)
    if provider != "ollama" and not key:
        return None

    env: Dict[str, str] = {}
    if model_env and pmid:
        # opencode 目录行的 provider_model_id 带 "opencode/" 前缀（OpenCode 客户端约定），
        # 直连 zen API 必须传裸模型 ID（与 llm_service._route_chat 同口径），
        # 否则 zen 响应形态异常、graphify 全 chunk 提取失败（08-16 云端实证）
        if provider == "opencode" and pmid.startswith("opencode/"):
            pmid = pmid.split("/", 1)[1]
        env[model_env] = pmid
    if key_envs and key:
        env[key_envs[0]] = key
    # openai 兼容绕道：补 base_url（平台账户 > 服务端默认）
    if backend == "openai" and provider != "openai":
        default_base = getattr(app_settings, f"{provider.upper()}_BASE_URL", None)
        resolved_base = base_url or default_base
        if resolved_base:
            # opencode zen 的 API 在 /v1 下（与 llm_service._join_api 同约定）；
            # 裸 /zen 打过去会吃到营销站 HTML 200，graphify 全 chunk 失败（08-16 实证）
            if provider == "opencode" and not resolved_base.rstrip("/").endswith("/v1"):
                resolved_base = resolved_base.rstrip("/") + "/v1"
            env["OPENAI_BASE_URL"] = resolved_base
        if provider == "kimi":
            env["GRAPHIFY_LLM_TEMPERATURE"] = "none"  # kimi-k2.6 拒显式 temperature
    elif provider == "openai" and base_url:
        env["OPENAI_BASE_URL"] = base_url
    return backend, env


def _graphify_env(preferred_model: Optional[str] = None, user_settings: Optional[Dict[str, Any]] = None, user_id: Optional[str] = None, db=None) -> Dict[str, str]:
    from app.core.config import settings as app_settings
    env = dict(os.environ)
    # 重试上限压到 2（库默认 6 是为 429 限流等窗口设计的）：构建链抽不出的 chunk
    # 快速放弃，缓存看门狗兜底下轮增量补——不当场烧 6 次等注定破碎的 JSON（09-13 成本闸门）
    env.setdefault("GRAPHIFY_MAX_RETRIES", "2")
    # 平台模型（platform: 前缀）：CLI 拿不到厂商 key，改走本机 OpenAI 兼容代理
    # （/api/v1/llm/compat/v1 → 云端代理按绑定用户余额计费）
    if preferred_model and preferred_model.startswith("platform:"):
        port = os.environ.get("PSB_PORT", "18723")
        env["OLLAMA_BASE_URL"] = f"http://127.0.0.1:{port}/api/v1/llm/compat/v1"
        env["OLLAMA_MODEL"] = preferred_model[len("platform:"):]
        env["GRAPHIFY_DISABLE_THINKING"] = "1"
        if user_id:
            from app.core.security import create_access_token
            env["OLLAMA_API_KEY"] = create_access_token({"sub": user_id})
        return env
    # graphify reads its own env var names; map server-level keys from app config
    if app_settings.DEEPSEEK_API_KEY and "DEEPSEEK_API_KEY" not in env:
        env["DEEPSEEK_API_KEY"] = app_settings.DEEPSEEK_API_KEY
    if app_settings.KIMI_API_KEY:
        env.setdefault("MOONSHOT_API_KEY", app_settings.KIMI_API_KEY)
    # 用户选择的构建模型：解析后端 + 注入对应 key/model/base_url（含 opencode 等
    # OpenAI 兼容 provider；本地 ollama 模型也会设置 OLLAMA_MODEL 生效选择）
    _resolved = _resolve_build_backend(db, preferred_model, user_settings)
    if _resolved:
        env.update(_resolved[1])
    # thinking 开关按后端分治（09-13 前拿 0.8b 经验全局套）：本地 ollama 小模型必须关
    # （qwen3.5 默认开思考流，散文打 JSON，血泪#30）；直连厂商/BYOK 模型交上游默认——
    # graphify #1621 实测关思考反而更频繁截断+抽取质量下降，截断触发二分重抽更烧钱。
    # platform: 代理分支不受此影响（chat 层已对推理档强制关思考，service.py deepseek 路径）
    _backend = _resolved[0] if _resolved else _pick_backend(preferred_model, db, user_settings)
    if _backend == "ollama":
        env.setdefault("GRAPHIFY_DISABLE_THINKING", "1")
    # graphify 的 ollama 后端走 OpenAI 兼容端点，URL 必须带 /v1
    # （compose/自托管注入的 OLLAMA_BASE_URL 通常没有 /v1，不补则提取全灭）
    _obase = (getattr(app_settings, "OLLAMA_BASE_URL", "") or "").rstrip("/")
    if _obase and not env.get("OLLAMA_BASE_URL", "").endswith("/v1"):
        env["OLLAMA_BASE_URL"] = _obase if _obase.endswith("/v1") else f"{_obase}/v1"
    return env


def _pick_backend(preferred_model: Optional[str] = None, db=None, user_settings: Optional[Dict[str, Any]] = None) -> str:
    from app.core.config import settings as app_settings
    if preferred_model and preferred_model.startswith("platform:"):
        # 平台模型（云端代理）经本机 OpenAI 兼容端点中转，graphify 用 ollama 后端即可
        return "ollama"
    if preferred_model:
        _r = _resolve_build_backend(db, preferred_model, user_settings)
        if _r:
            return _r[0]
    if app_settings.DEEPSEEK_API_KEY:
        return "deepseek"
    if app_settings.KIMI_API_KEY:
        return "kimi"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "gemini"
    return "ollama"


def _cli_cmd(args: List[str]) -> List[str]:
    """graphify CLI 调用形态（语言补丁接线点，实证见 graphify_prompt_patch.py）。

    frozen：sys.executable 是本 exe，desktop_entry 的 -m graphify 转发分支已打补丁；
    源码：python 直跑官方入口没有补丁时机，改走 app 内 wrapper 脚本（绝对路径，
    因为子进程 cwd 是临时构建目录，app 包不在其 sys.path）。
    """
    if getattr(sys, "frozen", False):
        return [sys.executable, "-m", "graphify", *args]
    wrapper = Path(__file__).resolve().parent / "graphify_cli.py"
    return [sys.executable, str(wrapper), *args]


def _run_cli(args: List[str], cwd: Optional[Path] = None, timeout: int = 1800,
             env: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        _cli_cmd(args),
        cwd=str(cwd) if cwd else None,
        env=env or _graphify_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


# 只落库、不进内存状态（也不透传给 /graphify/status 响应）的键
_PERSIST_ONLY_FIELDS = {"preferred_model", "evolve_dirty", "auto_resumed"}
# 允许写入 graph_build_state 表的状态键白名单
_PERSISTED_STATUS_FIELDS = {
    "state", "progress", "error", "has_graph", "doc_count", "synced_edges",
    "warning", "finished_at", "evolve_pending",
} | _PERSIST_ONLY_FIELDS


def get_build_status(user_id: str, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    key = _space_key(user_id, tenant_id)
    with _build_lock:
        st = _build_status.get(key)
    if st is None:
        st = _hydrate_build_status(user_id, tenant_id)
    # 产物目录已按空间（09-12）：团队空间读团队目录（tenant_{tenant_id}/），
    # 磁盘产物/质量指标与个人空间互不透
    if st:
        # has_graph lives only in terminal states; merge it from disk so a
        # rebuild in progress doesn't hide the still-readable previous graph.
        return {**st, "has_graph": st.get("has_graph") or _graph_json_path(user_id, tenant_id).exists(),
                **_graph_quality_metrics(user_id, tenant_id)}
    has_graph = _graph_json_path(user_id, tenant_id).exists()
    return {"state": "idle", "has_graph": has_graph, "progress": None, "error": None,
            **_graph_quality_metrics(user_id, tenant_id)}


# 构建质量透出（V3）：边置信度分布 + 零度孤儿节点数——「玩具图 vs 好图」一眼可见。
# graph.json 可能上百 KB，按 mtime 缓存，状态轮询不重复解析。
# 键为空间键（09-12）：两空间各自的 graph.json _mtime/指标互不串
_quality_cache: Dict[str, tuple] = {}


def _graph_quality_metrics(user_id: str, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    try:
        path = _graph_json_path(user_id, tenant_id)
        if not path.exists():
            return {}
        mtime = path.stat().st_mtime
        cache_key = _space_key(user_id, tenant_id)
        cached = _quality_cache.get(cache_key)
        if cached and cached[0] == mtime:
            return cached[1]
        import json as _json
        graph = _json.loads(path.read_text(encoding="utf-8"))
        nodes = graph.get("nodes", [])
        links = graph.get("links", [])
        conf: Dict[str, int] = {}
        degree: Dict[str, int] = {}
        quarantined = 0
        for l in links:
            if is_quarantined_link(l):
                quarantined += 1
        for l in links:
            c = l.get("confidence") or "UNKNOWN"
            conf[c] = conf.get(c, 0) + 1
            degree[l.get("source")] = degree.get(l.get("source"), 0) + 1
            degree[l.get("target")] = degree.get(l.get("target"), 0) + 1
        metrics = {
            "edge_confidence": conf,
            "orphan_nodes": sum(1 for n in nodes if degree.get(n.get("id"), 0) == 0),
            "quarantined_edges": quarantined,
        }
        _quality_cache[cache_key] = (mtime, metrics)
        return metrics
    except Exception as e:
        logger.warning("graphify quality metrics failed user=%s tenant=%s: %s", user_id, tenant_id, e)
        return {}


def _hydrate_build_status(user_id: str, tenant_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """内存 miss 时从 graph_build_state 水合（进程重启后的首次读）；无记录返回 None。"""
    key = _space_key(user_id, tenant_id)
    try:
        db = SessionLocal()
        try:
            row = db.query(GraphBuildState).filter(_state_row_filter(user_id, tenant_id)).first()
        finally:
            db.close()
    except Exception as e:
        logger.warning("graphify build status hydrate failed user=%s tenant=%s: %s", user_id, tenant_id, e)
        return None
    if row is None or row.state is None:
        return None
    st = {f: getattr(row, f) for f in ("state", "progress", "error", "has_graph", "doc_count",
                                       "synced_edges", "warning", "finished_at", "evolve_pending")
          if getattr(row, f, None) is not None}
    with _build_lock:
        _build_status[key] = st
    return st


def _set_build_status(user_id: str, tenant_id: Optional[str] = None, **kwargs: Any) -> None:
    key = _space_key(user_id, tenant_id)
    mem = {k: v for k, v in kwargs.items() if k not in _PERSIST_ONLY_FIELDS}
    if mem:
        with _build_lock:
            _build_status.setdefault(key, {}).update(mem)
    # write-through 落库（锁外短会话）：进程重启后可水合/断点续建；
    # 落库失败不影响构建主链路，但必须 warning 留痕（静默吞异常让缺陷隐形）
    fields = {k: v for k, v in kwargs.items() if k in _PERSISTED_STATUS_FIELDS}
    if not fields:
        return
    try:
        db = SessionLocal()
        try:
            row = db.query(GraphBuildState).filter(_state_row_filter(user_id, tenant_id)).first()
            if row is None:
                row = GraphBuildState(user_id=user_id, tenant_id=tenant_id or "")
                db.add(row)
            for k, v in fields.items():
                setattr(row, k, v)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning("graphify build status persist failed user=%s tenant=%s: %s", user_id, tenant_id, e)


def _safe_model_key(model: Optional[str], backend: str) -> str:
    """语义缓存按模型物理隔离（graphify 缓存 key 不含模型/backend，换模型必须换目录）。"""
    raw = model or f"backend-{backend}"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", raw)[:80] or "default"


def _seed_semantic_cache(user_id: str, model_key: str, build_dir: Path,
                         tenant_id: Optional[str] = None) -> int:
    """把上次构建的成功语义缓存播进构建目录，返回播种条数。

    失败/假成功条目（无 edges 且无 hyperedges——0.5b 输出合法 JSON 但只有
    孤儿节点的情形）不播种，让其重抽。graphify 缓存 key = 内容哈希+相对路径
    （文件名），语料目录名变化不影响命中。
    缓存目录随空间（09-12）：团队的播种/收割只动团队目录，不蹭个人缓存。"""
    src = _space_dir(user_id, tenant_id) / "graphify-cache" / model_key
    if not src.is_dir():
        return 0
    dst = build_dir / "graphify-out" / "cache" / "semantic"
    dst.mkdir(parents=True, exist_ok=True)
    kept = 0
    for f in src.glob("*.json"):
        try:
            entry = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not entry.get("edges") and not entry.get("hyperedges"):
            continue
        shutil.copy2(f, dst / f.name)
        kept += 1
    return kept


def _harvest_semantic_cache(user_id: str, model_key: str, build_dir: Path,
                            tenant_id: Optional[str] = None) -> int:
    """构建成功后把本次语义缓存收回持久目录（含播种命中+新抽取），返回条数。"""
    src = build_dir / "graphify-out" / "cache" / "semantic"
    if not src.is_dir():
        return 0
    dst = _space_dir(user_id, tenant_id) / "graphify-cache" / model_key
    shutil.rmtree(dst, ignore_errors=True)
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in src.glob("*.json"):
        shutil.copy2(f, dst / f.name)
        n += 1
    return n


def _sync_semantic_cache_incremental(user_id: str, model_key: str, build_dir: Path,
                                     tenant_id: Optional[str] = None) -> int:
    """合并式拷贝构建目录的语义缓存到持久目录（看门狗用）：不清空目标，逐文件跳过未变。"""
    src = build_dir / "graphify-out" / "cache" / "semantic"
    if not src.is_dir():
        return 0
    dst = _space_dir(user_id, tenant_id) / "graphify-cache" / model_key
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in src.glob("*.json"):
        target = dst / f.name
        try:
            if target.exists() and target.stat().st_mtime >= f.stat().st_mtime:
                continue
            shutil.copy2(f, target)
            n += 1
        except OSError:
            continue  # CLI 正在写该文件（半写 JSON），下轮再拷；播种侧本就跳过坏 JSON
    return n


def _start_cache_watchdog(user_id: str, model_key: str, build_dir: Path,
                          tenant_id: Optional[str] = None) -> threading.Event:
    """extract 运行期间每 15s 把已完成 chunk 的语义缓存同步到持久目录。

    进程被杀时 tmp 构建目录成孤儿，没有看门狗已完成 chunk 的抽取成果全丢
    （断点续建的根）。返回 stop event，extract 结束必须 set。"""
    stop = threading.Event()

    def _loop() -> None:
        while not stop.wait(15):
            try:
                _sync_semantic_cache_incremental(user_id, model_key, build_dir, tenant_id=tenant_id)
            except Exception as e:
                logger.warning("graphify cache watchdog sync failed user=%s tenant=%s: %s",
                               user_id, tenant_id, e)

    threading.Thread(target=_loop, daemon=True).start()
    return stop


def _harvest_semantic_cache_safe(user_id: str, model_key: str, build_dir: Path,
                                 tenant_id: Optional[str] = None) -> None:
    """失败/超时路径的缓存收割：尽量收下已完成 chunk，失败只留痕不掩盖原始错误。"""
    try:
        n = _harvest_semantic_cache(user_id, model_key, build_dir, tenant_id=tenant_id)
        if n:
            logger.info("graphify semantic cache harvested on failure user=%s tenant=%s model=%s entries=%d",
                        user_id, tenant_id, model_key, n)
    except Exception as e:
        logger.warning("graphify semantic cache harvest on failure failed user=%s tenant=%s: %s",
                       user_id, tenant_id, e)


def build_graph(db: Session, user_id: str, preferred_model: Optional[str] = None,
                tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """同步构建入口：实现体任何未捕获异常都置 failed 记 error。

    实现体（_build_graph_impl）只细粒度兜了导出失败/CLI 超时/非零退出，其余异常
    （copytree、cluster、输出置换、磁盘错误等）穿出会让状态永停 exporting/building，
    后续构建全被 start_build_background 误判「构建中」吞掉。

    tenant_id：构建状态写本空间行、语料/产物/语义缓存落本空间目录（09-12
    产物目录空间化已落地，见模块 docstring）。
    """
    try:
        return _build_graph_impl(db, user_id, preferred_model, tenant_id=tenant_id)
    except Exception as e:
        logger.exception("graphify build crashed user=%s tenant=%s", user_id, tenant_id)
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error=f"图谱构建异常中断: {e}")
        return get_build_status(user_id, tenant_id=tenant_id)


def _build_graph_impl(db: Session, user_id: str, preferred_model: Optional[str] = None,
                      tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Synchronous build: export corpus then run graphify extract. Caller should run in a thread."""
    _set_build_status(user_id, tenant_id=tenant_id, state="exporting", error=None, progress="正在导出语料…")
    try:
        counts = export_user_corpus(db, user_id, tenant_id=tenant_id)
    except Exception as e:
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error=f"语料导出失败: {e}")
        return get_build_status(user_id, tenant_id=tenant_id)

    total_docs = sum(counts.values())
    if total_docs == 0:
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error="没有可用于构建图谱的内容（笔记/剪藏/知识单元为空）")
        return get_build_status(user_id, tenant_id=tenant_id)

    # 用户选了模型时带上其 BYOK 配置（settings 里的厂商 key 注入 CLI 环境）
    user_settings: Optional[Dict[str, Any]] = None
    if preferred_model:
        import json as _json
        from app.models.base import User as _User
        _u = db.query(_User).filter(_User.id == user_id).first()
        if _u and _u.settings:
            try:
                user_settings = _json.loads(_u.settings)
            except Exception:
                user_settings = None

    backend = _pick_backend(preferred_model, db=db, user_settings=user_settings)
    cli_env = _graphify_env(preferred_model, user_settings, user_id=user_id, db=db)
    # Build in a throwaway copy of the corpus, then swap graphify-out on success.
    # Three reasons:
    # 1. graphify caches per-chunk extraction results under graphify-out/cache —
    #    including FAILED chunks (a doc that failed extraction is cached as an
    #    edge-less fallback node). Building in a fresh dir guarantees no poisoned
    #    cache is reused.
    # 2. The previous graph stays readable while the new one builds, and a failed
    #    build leaves it untouched.
    # 3. graphify honours ancestor .gitignore files, and this repo gitignores
    #    backend/graphify_data/ — building inside the repo made the scanner see
    #    0 documents ("graph is empty"). The throwaway copy therefore lives in
    #    the system temp dir, outside any repo.
    # 09-17 P2-1 补充：增量建图会带入旧产物的 manifest.json+graph.json（副本，
    # 旧图仍全程可读），毒缓存防线不变——语义缓存仍由我们自己的播种/收割口径
    # 管理（失败条目已剔除），带入的只是上游增量判定所需的清单与旧图。
    tmp_root = Path(tempfile.mkdtemp(prefix="psb-graphify-"))
    build_dir = tmp_root / "corpus_building"
    out_dir = _out_dir(user_id, tenant_id)
    new_graph_json = build_dir / "graphify-out" / "graph.json"
    shutil.copytree(_corpus_dir(user_id, tenant_id), build_dir,
                    # graphify-out*：旧图备份目录（graphify-out.bak-* 等）也绝不进
                    # 语料——09-10 实捕：备份目录被当语料扫描，2210 个垃圾节点
                    # （manifest.json/mtime/ast_hash）混进图谱。备份请放 corpus/ 外。
                    ignore=shutil.ignore_patterns("graphify-out", "graphify-out.*"))

    # 语义缓存复用：未变语料命中上次成功抽取（零成本+子图稳定），失败条目已剔除
    model_key = _safe_model_key(preferred_model, backend)
    # 增量建图（09-17 P2-1 Delta Sync）：把旧产物的 manifest.json+graph.json 带进
    # 构建目录，上游 detect_incremental 自动接管——按内容 hash 判变更（重导语料
    # mtime 全变但内容不变即 unchanged，不重抽零 LLM 成本），deleted 由
    # build_merge(prune_sources) 剪枝。模型变更不带入（上游 manifest 无模型维度，
    # 混模型图宁可全量——与语义缓存 _safe_model_key 隔离口径一致）；模型戳记在
    # out_dir/_meta.json（swap 后写，见下）。
    incremental = False
    try:
        _prev_meta = {}
        _meta_path = out_dir / "_meta.json"
        if _meta_path.exists():
            _prev_meta = json.loads(_meta_path.read_text(encoding="utf-8"))
        if (out_dir / "manifest.json").exists() and (out_dir / "graph.json").exists() \
                and _prev_meta.get("model") == model_key:
            _carry_out = build_dir / "graphify-out"
            _carry_out.mkdir(parents=True, exist_ok=True)
            for _name in ("manifest.json", "graph.json"):
                shutil.copy2(out_dir / _name, _carry_out / _name)
            incremental = True
            logger.info("graphify incremental mode user=%s tenant=%s model=%s",
                        user_id, tenant_id, model_key)
        elif _prev_meta.get("model") and _prev_meta.get("model") != model_key:
            logger.info("graphify full rebuild（模型变更 %s→%s，不带旧产物）user=%s tenant=%s",
                        _prev_meta.get("model"), model_key, user_id, tenant_id)
    except Exception as e:  # 吞异常必 warning：带入失败退化为全量，不阻断构建
        logger.warning("graphify incremental carry-over failed（按全量构建）: %s", e)
        incremental = False
    seeded = _seed_semantic_cache(user_id, model_key, build_dir, tenant_id=tenant_id)
    if seeded:
        logger.info("graphify semantic cache seeded user=%s tenant=%s model=%s entries=%d",
                    user_id, tenant_id, model_key, seeded)
    # 进度文案显示目录名（platform:opencode-xxx → 目录里的模型名），查不到剥前缀
    _model_label = preferred_model or backend
    if preferred_model:
        try:
            from app.models.llm_billing import LLMModel as _LLMModel
            _bare = preferred_model[len("platform:"):] if preferred_model.startswith("platform:") else preferred_model
            _row = db.query(_LLMModel).filter(_LLMModel.id == _bare).first()
            _model_label = (_row.name if _row and _row.name else _bare)
        except Exception:
            _model_label = _bare if preferred_model else backend
    _set_build_status(user_id, tenant_id=tenant_id, state="building", progress=f"正在用 {_model_label} 提取 {total_docs} 篇文档…")
    _watchdog_stop = _start_cache_watchdog(user_id, model_key, build_dir, tenant_id=tenant_id)
    try:
        # token-budget 25000：云端 /llm/chat message 上限 100k 字符，graphify 默认
        # 60k token 预算打出的大块（~17 万字符）会被 422 全灭（08-11 复现实锤）；
        # 超时按语料量+模型档位放大：非推理档 20s/篇、4h 上限（平台模型限流+本地 CPU
        # 模型的真实速率，原 5s/篇对 600 篇级语料必杀——08-31 用户实捕扣费后超时）；
        # 推理档 60s/篇、14h 上限（强制思考实测 ~30s/篇起——09-03 实捕撞上限卡死的保底，
        # 推理档同时已被选择器/端点双重禁入，这里是兜底的防御层）
        _per_doc = 60 if is_reasoning_model(preferred_model or backend) else 20
        _cap = 50400 if _per_doc == 60 else 14400
        _cli_timeout = max(1800, min(_cap, total_docs * _per_doc))
        proc = _run_cli(["extract", "corpus_building", "--backend", backend,
                         "--token-budget", "25000"], cwd=tmp_root, env=cli_env, timeout=_cli_timeout)
    except subprocess.TimeoutExpired:
        # 断点续建：收割已完成 chunk 的语义缓存再清场，重试只抽剩余文档
        _harvest_semantic_cache_safe(user_id, model_key, build_dir, tenant_id=tenant_id)
        shutil.rmtree(tmp_root, ignore_errors=True)
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error=f"构建超时（限时 {_cli_timeout // 60} 分钟）：已完成的抽取已入缓存，重新构建会从中断处续建、不重复扣费")
        return get_build_status(user_id, tenant_id=tenant_id)
    except Exception as e:
        # broad except：非超时异常（CLI 启动失败、磁盘错误等）同样收割缓存、置 failed，
        # 状态不得永停 building
        logger.exception("graphify extract crashed user=%s tenant=%s", user_id, tenant_id)
        _harvest_semantic_cache_safe(user_id, model_key, build_dir, tenant_id=tenant_id)
        shutil.rmtree(tmp_root, ignore_errors=True)
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error=f"图谱构建异常中断: {e}")
        return get_build_status(user_id, tenant_id=tenant_id)
    finally:
        _watchdog_stop.set()

    if proc.returncode != 0 or not new_graph_json.exists():
        tail = (proc.stderr or proc.stdout or "")[-500:]
        # 断点续建：同上，失败也先收缓存
        _harvest_semantic_cache_safe(user_id, model_key, build_dir, tenant_id=tenant_id)
        shutil.rmtree(tmp_root, ignore_errors=True)
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error=f"graphify 提取失败: {tail}")
        return get_build_status(user_id, tenant_id=tenant_id)

    harvested = _harvest_semantic_cache(user_id, model_key, build_dir, tenant_id=tenant_id)
    if harvested:
        logger.info("graphify semantic cache harvested user=%s tenant=%s model=%s entries=%d",
                    user_id, tenant_id, model_key, harvested)

    # 增量零变更早退（09-17 P2-1）：上游 clustered 路径无零变更早退（该早退只在
    # --no-cluster 分支），零变更时 cluster+export 照跑但产物等价——在我们层识别
    # 汇总行，跳过 swap/整删整插 sync/派生重建，直接置 done（缓存已收割过）。
    _inc_deleted = 0
    if incremental:
        _m = re.search(
            r"\[graphify extract\] 0 code, 0 docs, 0 papers, 0 images changed; "
            r"\d+ unchanged; (\d+) deleted", proc.stdout or "")
        if _m and _m.group(1) == "0":
            shutil.rmtree(tmp_root, ignore_errors=True)
            _set_build_status(user_id, tenant_id=tenant_id, state="done", has_graph=True,
                              progress=None, error=None,
                              finished_at=datetime.utcnow().isoformat() + "Z",
                              doc_count=total_docs, evolve_pending=0)
            return get_build_status(user_id, tenant_id=tenant_id)
        _m2 = re.search(r"changed; \d+ unchanged; (\d+) deleted", proc.stdout or "")
        if _m2:
            _inc_deleted = int(_m2.group(1))
    # 覆盖率守卫（09-10 实捕：DeepSeek 402 余额耗尽，抽取 55/140 块成功，残图
    # 71/829 篇覆盖、957→191 节点，无守卫直接 swap+清边重写 = 129→6 边事故）。
    # 新图节点不及旧图一半时：不 swap、不同步、不报错式覆盖——保留旧图，标 failed，
    # 已抽部分在语义缓存里，充值/恢复后重建只抽缺口。
    try:
        import json as _json_guard
        _new_nodes = len((_json_guard.loads(new_graph_json.read_text(encoding="utf-8"))).get("nodes") or [])
        _old_gj = out_dir / "graph.json"
        _old_nodes = len((_json_guard.loads(_old_gj.read_text(encoding="utf-8"))).get("nodes") or []) if _old_gj.exists() else 0
        # 增量+有删除源：缩图是 prune_sources 剪枝的合法结果（09-17 P2-1，
        # 用户批量删文档）——放行留痕；无删除的缩图仍是事故信号，照拦
        if _old_nodes and incremental and _inc_deleted > 0 \
                and _new_nodes < _old_nodes * 0.5:
            logger.warning("增量构建剪枝缩图放行 user=%s tenant=%s：%d→%d 节点（删除源 %d 个）",
                           user_id, tenant_id, _old_nodes, _new_nodes, _inc_deleted)
        if _old_nodes and _new_nodes < _old_nodes * 0.5 \
                and not (incremental and _inc_deleted > 0):
            shutil.rmtree(tmp_root, ignore_errors=True)
            _set_build_status(
                user_id, tenant_id=tenant_id, state="failed",
                error=(f"覆盖率守卫拦截：新图 {_new_nodes} 节点不及旧图 {_old_nodes} 的一半"
                       "（上游抽取大面积失败，常见原因是余额不足/限流）——旧图已保留，"
                       "已完成抽取入缓存，恢复后重建只补缺口不重复扣费"))
            return get_build_status(user_id, tenant_id=tenant_id)
    except Exception as e:
        logger.warning("覆盖率守卫自身异常（不阻断构建）: %s", e)

    # Step 2: clustering + community naming + GRAPH_REPORT.md + graph.html
    warning = None
    _set_build_status(user_id, tenant_id=tenant_id, state="building", progress="正在检测社区并生成报告…")
    try:
        proc2 = _run_cli(["cluster-only", "corpus_building", "--backend", backend, "--missing-only"], cwd=tmp_root, env=cli_env)
        if proc2.returncode != 0:
            # graph is already usable; report failure is non-fatal
            tail = (proc2.stderr or proc2.stdout or "")[-300:]
            warning = f"社区/报告生成失败（图谱可用）: {tail}"
    except subprocess.TimeoutExpired:
        warning = "社区/报告生成超时（图谱可用）"

    # 版本快照留底（09-17 P2-2）：swap 前自动快照旧图——此前过了覆盖率守卫的
    # 劣化图无备份直接 rmtree（09-10 事故防护只剩守卫拦截率一层）
    try:
        snapshot_graph(user_id, tenant_id=tenant_id, trigger="auto", model_key=model_key)
    except Exception as e:  # 吞异常必 warning：快照失败不阻断构建主链路
        logger.warning("graphify auto snapshot failed user=%s tenant=%s: %s",
                       user_id, tenant_id, e)
    # Swap the fresh output into place atomically-ish, then drop the build copy.
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.move(str(build_dir / "graphify-out"), str(out_dir))
    # 模型戳记（09-17 P2-1）：增量带入的准入凭据——下次构建模型不符则全量
    try:
        (out_dir / "_meta.json").write_text(
            json.dumps({"model": model_key,
                        "built_at": datetime.utcnow().isoformat() + "Z"},
                       ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # 吞异常必 warning：戳记缺失=下次退化为全量，不阻断
        logger.warning("graphify _meta.json write failed user=%s tenant=%s: %s",
                       user_id, tenant_id, e)
    shutil.rmtree(tmp_root, ignore_errors=True)

    # 图谱报告中文化：上游 GRAPH_REPORT.md 是全英文模板，从 graph.json 重生成中文
    # 覆盖同名文件（读取端点不变）；失败保留英文原件，仅追加 warning
    try:
        from app.services.graph_report_zh import regenerate_report_zh
        regenerate_report_zh(user_id, db=db, tenant_id=tenant_id)
    except Exception as e:
        warning = (warning + "；" if warning else "") + f"报告中文重生成失败（英文原报告保留）: {e}"

    # Deep fusion: write semantic relations back into graph_edges so collision
    # pairing and the legacy graph APIs consume them. Sync failure must not
    # fail the build — the graph itself is already usable.
    # 边同步按空间整删整建（09-12）：团队构建只动团队边，不再误删个人边
    sync_stats: Optional[Dict[str, int]] = None
    try:
        sync_stats = sync_edges_from_build(db, user_id, tenant_id=tenant_id)
    except Exception as e:
        warning = (warning + "；" if warning else "") + f"语义边同步失败（图谱可用）: {e}"

    # 3D V2 阶段一 + RAG 阶段二：布局与社区摘要落库（失败不阻断构建，只追加 warning）
    warning = _post_build_enrichments(db, user_id, warning, tenant_id=tenant_id)

    st: Dict[str, Any] = dict(state="done", has_graph=True, progress=None,
                              finished_at=datetime.utcnow().isoformat() + "Z", doc_count=total_docs, evolve_pending=0)
    if sync_stats is not None:
        st["synced_edges"] = sync_stats["created"]
    if warning:
        st["warning"] = warning
    _set_build_status(user_id, tenant_id=tenant_id, **st)
    return get_build_status(user_id, tenant_id=tenant_id)


def _post_build_enrichments(db, user_id: str, warning: Optional[str],
                            tenant_id: Optional[str] = None) -> Optional[str]:
    """构建收尾的落库增强：两层布局 + 社区摘要（RAG 阶段二，无 LLM 纯聚合）。

    两者都失败不阻断构建，只追加 warning——图谱本身已可用：
    布局缺失前端回退客户端力导向；摘要缺失 chat 不注入社区摘要区。
    tenant_id 透传（09-12 产物目录空间化已落地）：布局/摘要整删整插只动本空间
    的行、摘要产物源 graph.json 读本空间目录。
    """
    try:
        from app.services import graph_layout_service as gls
        gls.rebuild_semantic_layout(db, user_id, tenant_id=tenant_id)
    except Exception as e:
        warning = (warning + "；" if warning else "") + f"布局计算失败（图谱可用，前端回退客户端布局）: {e}"
    try:
        from app.services import community_digest as cd
        cd.build_semantic_digests(db, user_id, tenant_id=tenant_id)
    except Exception as e:
        warning = (warning + "；" if warning else "") + f"社区摘要计算失败（图谱可用）: {e}"
    return warning


# ---------------------------------------------------------------- 版本快照（09-17 P2-2）
# 快照落 {space}/snapshots/{ts}-{trigger}/（corpus/ 外——血泪#72：备份绝不能让
# 语料扫描看到；export/copytree 都只碰 corpus/，无需改 ignore）。swap 前自动留底
# + 手动端点留底；回滚=恢复产物文件+三张派生表幂等重建（graph_edges/graph_layouts/
# community_digests 都是 graph.json 的派生物），无需 DB 快照。
SNAPSHOT_KEEP = 5
SNAPSHOT_FILES = ("graph.json", ".graphify_labels.json", "GRAPH_REPORT.md")


def _snapshots_root(user_id: str, tenant_id: Optional[str] = None) -> Path:
    return _space_dir(user_id, tenant_id) / "snapshots"


def snapshot_graph(user_id: str, tenant_id: Optional[str] = None, trigger: str = "auto",
                   model_key: Optional[str] = None) -> Optional[str]:
    """把当前产物快照到 snapshots/ 下，返回 snapshot_id；无图可快照返回 None。
    保留最近 SNAPSHOT_KEEP 份，超出删最旧（目录名 ts 前缀字典序=时间序）。"""
    out_dir = _out_dir(user_id, tenant_id)
    if not (out_dir / "graph.json").exists():
        return None
    sid = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ") + f"-{trigger}"
    dst = _snapshots_root(user_id, tenant_id) / sid
    dst.mkdir(parents=True, exist_ok=True)
    for name in SNAPSHOT_FILES:
        src = out_dir / name
        if src.exists():
            shutil.copy2(src, dst / name)
    try:
        gj = json.loads((dst / "graph.json").read_text(encoding="utf-8"))
        meta = {
            "id": sid,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "trigger": trigger,
            "model": model_key,
            "nodes": len(gj.get("nodes") or []),
            "edges": len(gj.get("links") or gj.get("edges") or []),
        }
        (dst / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    except Exception as e:  # 吞异常必 warning：meta 缺失不影响快照本体可用
        logger.warning("graphify snapshot meta failed user=%s tenant=%s: %s",
                       user_id, tenant_id, e)
    try:
        snaps = sorted(p for p in _snapshots_root(user_id, tenant_id).iterdir() if p.is_dir())
        for old in snaps[:-SNAPSHOT_KEEP]:
            shutil.rmtree(old, ignore_errors=True)
    except Exception as e:  # 吞异常必 warning：淘汰失败只是磁盘多占
        logger.warning("graphify snapshot prune failed user=%s tenant=%s: %s",
                       user_id, tenant_id, e)
    return sid


def list_snapshots(user_id: str, tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """快照列表（新的在前）。meta.json 损坏/缺失时按目录名兜底。"""
    root = _snapshots_root(user_id, tenant_id)
    if not root.is_dir():
        return []
    out: List[Dict[str, Any]] = []
    for p in sorted((x for x in root.iterdir() if x.is_dir()), reverse=True):
        meta: Dict[str, Any] = {}
        meta_path = p / "meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:  # 读侧损坏按兜底处理（写入侧已 warning 留痕）
                meta = {}
        meta.setdefault("id", p.name)
        meta["has_graph"] = (p / "graph.json").exists()
        out.append(meta)
    return out


def rollback_snapshot(db: Session, user_id: str, snapshot_id: str,
                      tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """一键回滚：恢复快照产物 → 边/布局/社区摘要按口径幂等重建。
    构建中拒绝（同 start_build_background 的锁+状态口径）；快照 id 白名单防路径穿越。"""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", snapshot_id or ""):
        raise ValueError(f"Invalid snapshot_id: {snapshot_id}")
    snap = _snapshots_root(user_id, tenant_id) / snapshot_id
    if not (snap / "graph.json").exists():
        return {"ok": False, "error": "快照不存在或已淘汰"}
    with _build_lock:
        st = get_build_status(user_id, tenant_id=tenant_id)
        if st.get("state") in ("exporting", "building"):
            return {"ok": False, "error": "图谱正在构建中，待完成后再回滚"}
        # 回滚前留底（09-27 拍板）：当前产物先自动快照再覆盖——此前直接 rmtree，
        # 回滚错了/反悔了无留底可救；trigger=pre-rollback，走 SNAPSHOT_KEEP 同口径淘汰
        snapshot_graph(user_id, tenant_id=tenant_id, trigger="pre-rollback")
        out_dir = _out_dir(user_id, tenant_id)
        shutil.rmtree(out_dir, ignore_errors=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        for name in SNAPSHOT_FILES:
            src = snap / name
            if src.exists():
                shutil.copy2(src, out_dir / name)

    warning: Optional[str] = None
    sync_stats: Optional[Dict[str, int]] = None
    try:
        sync_stats = sync_edges_from_build(db, user_id, tenant_id=tenant_id)
    except Exception as e:
        warning = f"语义边同步失败（图谱文件已回滚）: {e}"
    warning = _post_build_enrichments(db, user_id, warning, tenant_id=tenant_id)

    meta: Dict[str, Any] = {}
    try:
        meta = json.loads((snap / "meta.json").read_text(encoding="utf-8"))
    except Exception:  # meta 缺失只影响状态回填精度
        pass
    st_new: Dict[str, Any] = dict(state="done", has_graph=True, progress=None, error=None,
                                  finished_at=meta.get("created_at")
                                  or datetime.utcnow().isoformat() + "Z")
    if sync_stats is not None:
        st_new["synced_edges"] = sync_stats["created"]
    if warning:
        st_new["warning"] = warning
    _set_build_status(user_id, tenant_id=tenant_id, **st_new)
    return {"ok": True, "snapshot_id": snapshot_id,
            "synced_edges": (sync_stats or {}).get("created"), "warning": warning}


def start_build_background(user_id: str, preferred_model: Optional[str] = None,
                           _auto_resume: bool = False,
                           tenant_id: Optional[str] = None) -> Dict[str, Any]:
    # 检查+置状态+起线程整体持锁：同用户并发调用时第二个拿到的必是「已在构建」，
    # 不得双双通过检查各起一个构建线程（并发竞态：exporting 覆盖写 + 双 CLI 互踩语料目录）
    with _build_lock:
        st = get_build_status(user_id, tenant_id=tenant_id)
        if st.get("state") in ("exporting", "building"):
            return st
        _set_build_status(user_id, tenant_id=tenant_id, state="exporting", progress="正在导出语料…", error=None,
                          preferred_model=preferred_model, auto_resumed=_auto_resume)
        thread = threading.Thread(target=_build_then_flush, args=(user_id, preferred_model, tenant_id), daemon=True)
        thread.start()
        return get_build_status(user_id, tenant_id=tenant_id)


def _build_then_flush(user_id: str, preferred_model: Optional[str] = None,
                      tenant_id: Optional[str] = None) -> None:
    db = SessionLocal()  # 后台线程自建会话，避免跨线程使用请求 Session
    """构建 + 自进化 dirty 补建（构建期间有新内容写入时，成功后自动再建一次）。"""
    try:
        # 开源版 Ollama-only：无会员/云通道门控，自进化模型直用本地模型
        build_graph(db, user_id, preferred_model, tenant_id=tenant_id)
    except Exception as e:
        # 兜底护住 build_graph 之前的前置步骤（门控降级等）：状态不得永停 exporting/building
        logger.exception("Graph build crashed user=%s tenant=%s", user_id, tenant_id)
        _set_build_status(user_id, tenant_id=tenant_id, state="failed", error=f"图谱构建异常中断: {e}")
    finally:
        try:
            flush_evolve_dirty(user_id, tenant_id=tenant_id)
        except Exception:
            logger.exception("Graph auto-evolve dirty flush failed user=%s", user_id)
        # 会话泄漏修复：后台线程自建会话必须归还连接（close 隐含 rollback，
        # 同时清掉 sync_edges_from_build 失败遗留的悬挂事务）
        try:
            db.close()
        except Exception:
            pass


def load_graph(user_id: str, tenant_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    # 产物目录随空间（09-12）：个人=graphify_data/{user_id}，团队=tenant_{tenant_id}/
    path = _graph_json_path(user_id, tenant_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def load_community_labels(user_id: str, tenant_id: Optional[str] = None) -> Dict[str, str]:
    """Community id -> human-readable name, written by `graphify cluster-only`."""
    path = _out_dir(user_id, tenant_id) / ".graphify_labels.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def parse_source_from_node(node: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Recover {type, id} from a node's source file path (file name `{type}__{id}.md`)."""
    for key in ("source", "file", "path", "source_file", "origin"):
        val = node.get(key)
        if not isinstance(val, str):
            continue
        m = re.search(r"(note|clip|knowledge|document)__([A-Za-z0-9_-]+)\.md", val)
        if m:
            return {"type": m.group(1), "id": m.group(2)}
    return None


# graphify edge confidence -> graph_edges.weight, same 0-1 scale the other
# auto-link rules use (tag=0.5, similar=0.6, support=0.9, ...)
CONFIDENCE_WEIGHT = {"EXTRACTED": 0.9, "INFERRED": 0.6, "AMBIGUOUS": 0.35}

# 置信度网关隔离区（09-17 P2-1b）：低置信边（AMBIGUOUS）默认不进主图/对话扩展，
# 读侧过滤产物不动；图谱页「显示低置信边」开关带 include_quarantined=1 全量返回。
GRAPH_QUARANTINE_SCORE = 0.3  # graph.json link 的 confidence_score 口径（0.2/0.5/1.0）


def is_quarantined_link(link: Dict[str, Any]) -> bool:
    """隔离判定：confidence_score 低于阈值；老产物缺数值字段时按 confidence 文本档判。"""
    score = link.get("confidence_score")
    if isinstance(score, (int, float)):
        return score < GRAPH_QUARANTINE_SCORE
    return (link.get("confidence") or "").upper() == "AMBIGUOUS"

def _match_evidence_chunks(db, doc_id: str, label_a: str, label_b: str,
                           relation: str = "", cap: int = 3) -> list:
    """证据子块（09-17 GraphRAG P1②）：该文档 embeddings 子块里两端 label 共现者
    （relation 词命中加权），取前 cap 个 content_id。无匹配/无子块落 []，不阻塞入库。"""
    from app.models.content import Embedding

    la, lb = (label_a or "").strip(), (label_b or "").strip()
    if not doc_id or not la or not lb:
        return []
    rows = db.query(Embedding.content_id, Embedding.chunk_text).filter(
        Embedding.content_id.like(f"{doc_id}::chunk::%"),
        Embedding.chunk_text.isnot(None),
    ).all()
    if not rows:
        return []
    rel_terms = [t for t in re.split(r"[^A-Za-z0-9一-鿿]+", relation or "")
                 if len(t) >= 2]
    scored = []
    for cid, text in rows:
        if not text or la not in text or lb not in text:
            continue
        s = 1 + sum(1 for t in rel_terms if t in text)
        scored.append((s, cid))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [cid for _, cid in scored[:cap]]


def _evidence_from_link(db, link, node_labels) -> tuple:
    """link → (evidence_doc_id, evidence_chunk_ids)：source_file 用 parse_source_from_node
    同款正则解析 doc_id，再查双 label 共现子块；无 source_file 落 (None, [])。"""
    sf = link.get("source_file")
    if not isinstance(sf, str):
        return None, []
    m = re.search(r"(note|clip|knowledge|document)__([A-Za-z0-9_-]+)\.md", sf)
    if not m:
        return None, []
    doc_id = m.group(2)
    chunks = _match_evidence_chunks(
        db, doc_id,
        node_labels.get(link.get("source")) or "",
        node_labels.get(link.get("target")) or "",
        link.get("relation") or "",
    )
    return doc_id, chunks


def backfill_edge_evidence(db, user_id: str, tenant=None) -> dict:
    """存量边证据血缘回填（手动端点触发，不进启动链）：重读产物 graph.json links，
    按 (source_id, target_id, relation) 匹配既有 graphify 边，只补
    evidence_doc_id IS NULL 的行（幂等，二跑零新增）。"""
    graph = load_graph(user_id, tenant_id=tenant.id if tenant else None)
    if not graph:
        logger.warning("backfill edge evidence: graph.json 缺失/损坏 user=%s tenant=%s",
                       user_id, getattr(tenant, "id", None))
        return {"updated": 0, "skipped": 0, "reason": "no_graph"}
    nodes = graph.get("nodes", [])
    node_labels = {n.get("id"): n.get("label") for n in nodes}
    node_docs = {}
    for node in nodes:
        src = parse_source_from_node(node)
        if src:
            node_docs[node.get("id")] = [src["id"]]
    edge_scope = GraphEdge.tenant_id == tenant.id if tenant else and_(
        GraphEdge.user_id == user_id, GraphEdge.tenant_id.is_(None))
    updated = skipped = 0
    for link in graph.get("links", []):
        a_ids = node_docs.get(link.get("source")) or []
        b_ids = node_docs.get(link.get("target")) or []
        if not a_ids or not b_ids:
            skipped += 1
            continue
        ev_doc_id, ev_chunks = _evidence_from_link(db, link, node_labels)
        if not ev_doc_id:
            skipped += 1
            continue
        relation = link.get("relation") or "related"
        rows = db.query(GraphEdge).filter(
            edge_scope,
            GraphEdge.edge_type == "graphify",
            GraphEdge.evidence_doc_id.is_(None),
            GraphEdge.source_id.in_(a_ids),
            GraphEdge.target_id.in_(b_ids),
            GraphEdge.context.contains(f"graphify 语义关联：{relation}"),
        ).all()
        for e in rows:
            e.evidence_doc_id = ev_doc_id
            e.evidence_chunk_ids = json.dumps(ev_chunks, ensure_ascii=False)
            updated += 1
        if not rows:
            skipped += 1
    db.commit()
    return {"updated": updated, "skipped": skipped}


# Hub concepts synthesized across documents have no single source_file; they are
# grounded back to content by text matching. Grounding is approximate, so edges
# touching a hub get this weight multiplier, and at most this many docs per hub.
HUB_GROUNDING_DISCOUNT = 0.8
HUB_MAX_DOCS = 3


def _ground_hub_concepts(user_id: str, nodes: List[Dict[str, Any]],
                         tenant_id: Optional[str] = None) -> Dict[str, List[str]]:
    """Map hub-concept node ids (source_file=None) to up to HUB_MAX_DOCS content
    ids whose exported document text mentions the concept label.
    语料目录随空间（09-12）：团队空间的接地只读团队语料。"""
    hubs = [n for n in nodes if n.get("source_file") is None and (n.get("label") or "").strip()]
    if not hubs:
        return {}
    docs: Dict[str, str] = {}
    for md in _corpus_dir(user_id, tenant_id).glob("*.md"):
        m = re.match(r"(?:note|clip|knowledge|document)__([A-Za-z0-9_-]+)\.md", md.name)
        if m:
            try:
                docs[m.group(1)] = md.read_text(encoding="utf-8").lower()
            except OSError:
                continue
    grounded: Dict[str, List[str]] = {}
    for hub in hubs:
        label = (hub.get("norm_label") or hub.get("label") or "").strip().lower()
        if len(label) < 2:
            continue
        matches = [cid for cid, text in docs.items() if label in text]
        if matches:
            grounded[hub["id"]] = matches[:HUB_MAX_DOCS]
    return grounded


def sync_edges_from_build(db: Session, user_id: str,
                          tenant_id: Optional[str] = None) -> Dict[str, int]:
    """Write the built graphify graph back into graph_edges so the rest of the
    product (collision pairing, brain stats, graph APIs) can use deepseek's
    semantic relations instead of only keyword/embedding heuristics.

    graphify links connect concept nodes; both endpoints are resolved back to
    content ids via their source file. Old synced edges are replaced wholesale
    (a rebuild reflects current content); duplicates of edges created by other
    rules are skipped via _create_edge's bidirectional check.

    整删口径（09-12 空间化）：只删本空间的 graphify 自动边——个人=user_id+
    tenant_id 空，团队=tenant_id=T 不限作者；团队构建不再误删个人边，反之亦然。
    新建边的 tenant 戳由 _create_edge 按出处内容行自动盖（团队内容 → tenant_id=T）。
    """
    # Deferred import: endpoints.graph is the canonical home of _create_edge and
    # nine modules already import its helpers; importing at module level would
    # risk a cycle through the router.
    from app.api.v1.endpoints.graph import _create_edge, _resolve_node_brain_side

    graph = load_graph(user_id, tenant_id=tenant_id)
    if not graph:
        return {"created": 0, "skipped": 0}

    edge_scope = GraphEdge.tenant_id == tenant_id if tenant_id else and_(
        GraphEdge.user_id == user_id, GraphEdge.tenant_id.is_(None))
    db.query(GraphEdge).filter(
        edge_scope,
        GraphEdge.edge_type == "graphify",
        GraphEdge.auto_created.is_(True),
    ).delete(synchronize_session=False)

    nodes = graph.get("nodes", [])
    # node id -> [(content_id, hub_label_or_None)]: anchored nodes map 1:1, hub
    # concepts (no source_file) map to up to HUB_MAX_DOCS docs by text grounding.
    node_labels = {n.get("id"): n.get("label") for n in nodes}
    node_docs: Dict[str, List[tuple]] = {}
    for node in nodes:
        src = parse_source_from_node(node)
        if src:
            node_docs[node.get("id")] = [(src["id"], None)]
    for hub_id, content_ids in _ground_hub_concepts(user_id, nodes, tenant_id=tenant_id).items():
        hub_label = next((n.get("label") for n in nodes if n.get("id") == hub_id), None)
        node_docs[hub_id] = [(cid, hub_label) for cid in content_ids]

    created = skipped = 0
    seen: set = set()
    try:
        for link in graph.get("links", []):
            endpoints_a = node_docs.get(link.get("source"), [])
            endpoints_b = node_docs.get(link.get("target"), [])
            if not endpoints_a or not endpoints_b:
                skipped += 1
                continue
            relation = link.get("relation") or "related"
            confidence = link.get("confidence") or ""
            # 证据血缘（09-17）：link 级算一次，所有展开 (a,b) 边共用
            ev_doc_id, ev_chunks = _evidence_from_link(db, link, node_labels)
            base_weight = CONFIDENCE_WEIGHT.get(confidence, 0.35)
            for a, hub_a in endpoints_a:
                for b, hub_b in endpoints_b:
                    if a == b:
                        skipped += 1
                        continue
                    key = (a, b) if a < b else (b, a)
                    if key in seen:
                        skipped += 1
                        continue
                    seen.add(key)
                    hubs = [h for h in (hub_a, hub_b) if h]
                    weight = base_weight * (HUB_GROUNDING_DISCOUNT if hubs else 1.0)
                    context = f"graphify 语义关联：{relation}"
                    if confidence:
                        context += f"（{confidence}）"
                    if hubs:
                        context += f"·经概念「{'、'.join(hubs)}」"
                    edge = _create_edge(
                        db, user_id, a, b,
                        _resolve_node_brain_side(db, a),
                        _resolve_node_brain_side(db, b),
                        "graphify",
                        round(weight, 3),
                        context=context,
                        auto_created=True,
                    )
                    if edge:
                        edge.evidence_doc_id = ev_doc_id
                        edge.evidence_chunk_ids = json.dumps(ev_chunks, ensure_ascii=False)
                        created += 1
                    else:
                        skipped += 1
        db.commit()
    except Exception as e:
        # _create_edge 抛错必须回滚：开头的整表 DELETE 还挂在事务里，
        # 不回滚会把悬挂 DELETE 留给调用方会话，下次 commit 误删旧边
        db.rollback()
        logger.warning("graphify edge sync failed user=%s tenant=%s: %s", user_id, tenant_id, e)
        raise
    return {"created": created, "skipped": skipped}


def _run_query(user_id: str, args: List[str], tenant_id: Optional[str] = None) -> Dict[str, Any]:
    # graph 路径与 cwd 随空间（09-12）：团队空间的 query/path/explain 打团队图
    graph = _graph_json_path(user_id, tenant_id)
    if not graph.exists():
        return {"ok": False, "error": "图谱尚未构建，请先点击「重建图谱」"}
    try:
        proc = _run_cli([*args, "--graph", str(graph)], cwd=_space_dir(user_id, tenant_id), timeout=120)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "查询超时"}
    out = (proc.stdout or "").strip()
    if proc.returncode != 0:
        err = (proc.stderr or out or "查询失败")[-500:]
        return {"ok": False, "error": err}
    return {"ok": True, "result": out}


def _rag_snippet(text: str, limit: int = 600) -> str:
    t = " ".join((text or "").split())
    return t[:limit]


async def _rag_fallback_answer(user_id: str, question: str, preferred_model: Optional[str] = None,
                               tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """图谱不可用时的回落：走产品自己的混合检索问答（FTS + 向量 + 融合），带引用。

    10-01 首次体验修复（审计观察-4）：新用户/示例内容只有物理图与 graph_edges，
    没有语义图谱 graph.json —— 原行为是问答页直接死路（只显示「尚未构建」）。
    回落复用 chat 链路的检索（_retrieve_knowledge_sources），本地模型零成本；
    返回体保持 query_graph 同形状，多带 mode="rag" 供前端标注口径。
    """
    from app.api.v1.endpoints.llm import _retrieve_knowledge_sources
    from app.core.database import SessionLocal
    from app.models.base import Tenant
    from app.services.llm_service import chat_completion

    db = SessionLocal()
    try:
        q = (question or "").strip()
        if not q:
            return {"ok": False, "error": "问题不能为空", "sources": []}
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first() if tenant_id else None
        try:
            hits = await _retrieve_knowledge_sources(
                db, user_id, q, top_k=8)
        except Exception as e:  # 检索异常不吞成 500：退回「无内容」口径
            logger.warning("rag fallback retrieval failed user=%s: %s", user_id, e)
            hits = []
        if not hits:
            return {"ok": True, "result": "知识库中没有检索到与问题相关的内容。", "evidence": "",
                    "sources": [], "mode": "rag"}

        # 前端只认 note/knowledge/clip 三种可跳转来源；其余类型（文档/百科/指南）
        # 只进 prompt 不进 sources，避免渲染出打不开的链接
        _linkable = {"note": "note", "clip": "clip"}
        lines: List[str] = []
        sources: List[Dict[str, Any]] = []
        for i, h in enumerate(hits[:8]):
            stype = str(h.get("source_type") or h.get("stype") or "note")
            title = (h.get("title") or "").strip() or "未命名"
            body = _rag_snippet(h.get("content") or h.get("content_raw") or "", 600)
            lines.append("[{0}] {1} 《{2}》：{3}".format(i + 1, stype, title, body))
            hid = h.get("id")
            ctype = _linkable.get(stype, "knowledge")
            if hid and stype not in ("document", "wiki", "guide"):
                sources.append({"content_type": ctype, "id": hid, "title": title})

        prompt = (
            "用户问题：" + q + "\n\n"
            "以下是从用户知识库中检索到的相关条目：\n" + "\n".join(lines) + "\n\n"
            "请基于以上条目回答用户的问题。要求：\n"
            "- 只使用以上条目里的信息，不要编造或补充外部知识\n"
            "- 引用具体条目名称（用书名号《》标出）\n"
            "- 若以上条目与问题无关，如实说明知识库中暂未找到相关内容\n"
            "- 回答控制在 300 字以内，条理清晰\n"
        )
        try:
            answer = await chat_completion(
                prompt=prompt,
                task_type="graph_query",
                system_prompt="你是个人知识库问答助手，只根据给定的检索结果回答，答案必须带条目引用。",
                preferred_model=preferred_model,
            )
        except Exception as e:
            return {"ok": False, "error": f"检索问答失败：{e}", "sources": sources, "mode": "rag"}
        answer = (answer or "").strip()
        if not answer or answer.lstrip().startswith("[Error"):
            return {"ok": False, "error": "模型返回为空或调用失败，请重试", "sources": sources, "mode": "rag"}
        return {"ok": True, "result": answer, "evidence": "", "sources": sources, "mode": "rag",
                "notice": "知识图谱尚未构建，本次用全文检索问答；到「知识网络」点「重建图谱」可启用关系推理。"}
    finally:
        db.close()


async def query_graph(user_id: str, question: str, preferred_model: Optional[str] = None,
                      tenant_id: Optional[str] = None) -> Dict[str, Any]:
    retrieval = _run_query(user_id, ["query", question], tenant_id=tenant_id)
    if not retrieval.get("ok"):
        # 图谱不存在/不可用时回落全文检索问答（10-01 首次体验：原行为是死路）
        return await _rag_fallback_answer(user_id, question, preferred_model, tenant_id)
    trace = (retrieval.get("result") or "").strip()
    if not trace:
        return {"ok": True, "result": "图谱中没有检索到与问题相关的内容。", "evidence": ""}

    # graphify CLI 的 query 只做检索（节点/边列表），自然语言答案由这里
    # 用 LLM 基于检索结果组织——要求引用具体条目，不允许编造
    from app.services.llm_service import chat_completion
    from app.core.database import SessionLocal

    prompt = (
        f"用户问题：{question}\n\n"
        f"以下是从用户的个人知识图谱中检索到的相关条目（NODE）和关系（EDGE）：\n"
        f"{trace[:4000]}\n\n"
        "请基于以上检索结果回答用户的问题。要求：\n"
        "- 只使用检索结果里的信息，不要编造或补充外部知识\n"
        "- 引用具体条目名称（用书名号《》标出）\n"
        "- 若检索结果与问题无关，如实说明知识库中暂未找到相关内容\n"
        "- 回答控制在 300 字以内，条理清晰\n"
    )
    # 把检索 trace 的 NODE 行解析成可跳转来源（内链直达）：
    # 形如 NODE 标题 [src=note__<uuid>.md ...]，按 id 核库后带出，
    # 前端把《标题》渲染成直达链接，而不是让用户自己回去找
    import re as _re
    from app.models.base import Note, BrowserClip, KnowledgeUnit
    _src_models = {"note": Note, "knowledge": KnowledgeUnit, "clip": BrowserClip}

    db = SessionLocal()
    try:
        sources = []
        seen = set()
        for m in _re.finditer(
            r"^NODE\s+(.+?)\s+\[src=(note|knowledge|clip)__([0-9a-fA-F-]{36})\.md",
            trace, _re.M,
        ):
            title, ctype, cid = m.group(1).strip(), m.group(2), m.group(3)
            if cid in seen:
                continue
            seen.add(cid)
            model = _src_models[ctype]
            # 来源核库按空间（09-12）：团队空间的 trace 来源是全团内容，不限作者
            if tenant_id:
                hit = db.query(model.id).filter(model.id == cid, model.tenant_id == tenant_id).first()
            else:
                hit = db.query(model.id).filter(
                    model.id == cid, model.user_id == user_id, model.tenant_id.is_(None)).first()
            if hit:
                sources.append({"content_type": ctype, "id": cid, "title": title})

        answer = await chat_completion(
            prompt=prompt,
            task_type="graph_query",
            system_prompt="你是个人知识库问答助手，只根据给定的检索结果回答，答案必须带条目引用。",
            preferred_model=preferred_model,
        )
    except Exception as _gq_err:
        # 计费/模型异常不能吞成 500（9/4 外测实捕「扣费但不渲染」）：真实原因带回前端展示
        return {"ok": False, "error": f"图谱问答失败：{_gq_err}", "sources": sources}
    finally:
        db.close()
    answer = (answer or "").strip()
    if not answer:
        return {"ok": False, "error": "模型返回为空，请重试", "sources": sources}
    if answer.lstrip().startswith("[Error"):
        # [Error 文本 = 模型不通（血泪#34），不许当答案渲染——失败要摆在明面上
        return {"ok": False, "error": f"模型调用失败：{answer.lstrip()[:200]}", "sources": sources}
    return {"ok": True, "result": answer, "evidence": trace, "sources": sources}


def path_graph(user_id: str, a: str, b: str, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    return _run_query(user_id, ["path", a, b], tenant_id=tenant_id)


def explain_graph(user_id: str, node: str, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    return _run_query(user_id, ["explain", node], tenant_id=tenant_id)


def graph_report_path(user_id: str, tenant_id: Optional[str] = None) -> Optional[Path]:
    p = _out_dir(user_id, tenant_id) / "GRAPH_REPORT.md"
    return p if p.exists() else None


# ── 自进化（user.settings["graphify"]["auto_evolve"]，不动表结构） ──
# 事件驱动：内容（笔记/剪藏/知识单元）写入提交后即触发重建；
# 构建中有新内容则置 dirty，构建成功完成后补建一次（自动收敛，无需定时器）。

def _load_user_settings(user: User) -> Dict[str, Any]:
    try:
        return json.loads(user.settings or "{}")
    except json.JSONDecodeError:
        return {}


def get_auto_evolve_config(user: User) -> Dict[str, Any]:
    cfg = ((_load_user_settings(user).get("graphify") or {}).get("auto_evolve") or {})
    return {
        "enabled": bool(cfg.get("enabled")),
        "model": cfg.get("model") or None,
    }


def set_auto_evolve_config(user: User, enabled: bool, model: Optional[str], db: Session) -> Dict[str, Any]:
    settings_data = _load_user_settings(user)
    graphify_cfg = dict(settings_data.get("graphify") or {})
    graphify_cfg["auto_evolve"] = {
        "enabled": enabled,
        "model": model,
    }
    settings_data["graphify"] = graphify_cfg
    user.settings = json.dumps(settings_data, ensure_ascii=False)
    db.commit()
    db.refresh(user)
    return get_auto_evolve_config(user)


def last_built_mtime(user_id: str, tenant_id: Optional[str] = None) -> Optional[float]:
    """最近一次成功构建时间（graph.json mtime，epoch 秒）；无图返回 None。
    按空间取（09-12）：团队空间看团队目录的产物时间。"""
    p = _graph_json_path(user_id, tenant_id)
    return p.stat().st_mtime if p.exists() else None


_evolve_lock = threading.Lock()
_evolve_dirty: Dict[str, bool] = {}
_evolve_listener_registered = False  # 监听挂在全局 SessionLocal 类上，重复注册会叠加触发


# 防抖口径（0.2.44 改）：写入不再立即重建——全量重建 = 全语料逐篇 LLM 提取，
# 本地小模型跑几十分钟、云端按量烧钱。停笔 _EVOLVE_QUIET_SECONDS 且距上次
# 成功构建 ≥ _EVOLVE_MIN_INTERVAL 才真正起建；期间所有写入只置 dirty 并重排计时器。
_EVOLVE_QUIET_SECONDS = 300        # 停笔静默期
_EVOLVE_MIN_INTERVAL = 1800        # 距上次成功构建的最小间隔
_evolve_timers: Dict[str, threading.Timer] = {}


def _fire_evolve(user_id: str, tenant_id: Optional[str] = None) -> None:
    """防抖计时器到期：复核状态后真正起建。

    dirty 标记只在查库成功后才清除：查询异常时保留 dirty（等下次写入触发
    或启动恢复补排），否则排定的重建会随异常静默消失。"""
    key = _space_key(user_id, tenant_id)
    with _evolve_lock:
        _evolve_timers.pop(key, None)
        dirty = _evolve_dirty.get(key, False)
    if not dirty:
        return
    db = None
    try:
        db = SessionLocal()
        user = db.query(User).filter(User.id == user_id).first()
    except Exception as e:
        logger.warning("Graph auto-evolve fire failed user=%s tenant=%s: %s", user_id, tenant_id, e)
        return  # 保留 dirty：查库失败不清标记，排定的重建不得静默消失
    finally:
        if db is not None:
            try:
                db.close()  # close 隐含 rollback
            except Exception:
                pass
    # 查库成功：清 dirty（内存 + 持久态）后按配置决定是否起建
    with _evolve_lock:
        _evolve_dirty.pop(key, None)
    _set_build_status(user_id, tenant_id=tenant_id, evolve_dirty=False)
    if not user:
        return
    cfg = get_auto_evolve_config(user)
    if not cfg["enabled"]:
        return
    if get_build_status(user_id, tenant_id=tenant_id).get("state") in ("exporting", "building"):
        with _evolve_lock:
            _evolve_dirty[key] = True
        _set_build_status(user_id, tenant_id=tenant_id, evolve_dirty=True)
        return  # 构建中，dirty 留给 flush
    start_build_background(user_id, preferred_model=cfg["model"], tenant_id=tenant_id)
    logger.info("Graph auto-evolve build fired user=%s tenant=%s model=%s (debounced)", user_id, tenant_id, cfg["model"])


def _bump_evolve_pending(user_id: str, tenant_id: Optional[str] = None) -> None:
    """写入事件累计待进化条数（构建成功清零）——/graphify/status 透出给前端显示排队量。

    读内存态/直接水合，不走 get_build_status（调用方时序对状态读取次数敏感）。
    """
    key = _space_key(user_id, tenant_id)
    with _build_lock:
        st = _build_status.get(key)
    if st is None:
        st = _hydrate_build_status(user_id, tenant_id) or {}
    cur = int(st.get("evolve_pending") or 0)
    _set_build_status(user_id, tenant_id=tenant_id, evolve_pending=cur + 1)


def maybe_trigger_evolve(user_id: str, tenant_id: Optional[str] = None) -> bool:
    """写入触发：置 dirty 并重排防抖计时器；返回是否排上了构建计划。

    供内容写入事件（before_commit 捕获 → after_commit 投递）与测试调用。
    手动 /graphify/build 不经过这里，随点随建。

    tenant_id（09-12）：状态行/dirty/计时器/产物 mtime 全部按空间各一份；
    团队空间的自进化用触发写入者本人的配置（enabled+model，配置是个人级，
    见模块 docstring 拍板口径）。
    """
    key = _space_key(user_id, tenant_id)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return False
        cfg = get_auto_evolve_config(user)
        if not cfg["enabled"]:
            return False
        now = time.time()
        last = last_built_mtime(user_id, tenant_id=tenant_id) or 0
        _bump_evolve_pending(user_id, tenant_id=tenant_id)
        with _evolve_lock:
            _evolve_dirty[key] = True
        _set_build_status(user_id, tenant_id=tenant_id, evolve_dirty=True)
        if get_build_status(user_id, tenant_id=tenant_id).get("state") in ("exporting", "building"):
            return False  # 构建中，dirty 留给 flush
        delay = max(_EVOLVE_QUIET_SECONDS, _EVOLVE_MIN_INTERVAL - (now - last))
        with _evolve_lock:
            old = _evolve_timers.get(key)
            if old:
                old.cancel()
            t = threading.Timer(delay, _fire_evolve, args=(user_id, tenant_id))
            t.daemon = True
            _evolve_timers[key] = t
            t.start()
        logger.info("Graph auto-evolve scheduled user=%s tenant=%s in %ds", user_id, tenant_id, delay)
        return True
    except Exception as e:
        logger.warning("Graph auto-evolve trigger failed user=%s tenant=%s: %s", user_id, tenant_id, e)
        try:
            db.rollback()
        except Exception:
            pass
        return False
    finally:
        db.close()


def flush_evolve_dirty(user_id: str, tenant_id: Optional[str] = None) -> None:
    """构建完成后调用：若期间有新内容（dirty）且最终构建成功，走防抖补排一次。"""
    key = _space_key(user_id, tenant_id)
    with _evolve_lock:
        dirty = _evolve_dirty.pop(key, False)
    if not dirty:
        return
    _set_build_status(user_id, tenant_id=tenant_id, evolve_dirty=False)
    if get_build_status(user_id, tenant_id=tenant_id).get("state") != "done":
        return  # 失败不补建，避免失败循环
    logger.info("Graph auto-evolve dirty flush user=%s tenant=%s", user_id, tenant_id)
    maybe_trigger_evolve(user_id, tenant_id)


def recover_interrupted_builds() -> None:
    """启动恢复（lifespan 调用）：进程重启时正在构建的自动断点续建。

    - state 停在 exporting/building 的行 = 进程死时正在构建：auto_resumed=False 的
      重起构建（看门狗已把已完成 chunk 的缓存同步到持久目录，播种后增量续跑，
      不重复抽取/扣费）；auto_resumed=True 的（上次续建又被杀）置 failed 交人工，
      防崩溃循环。
    - evolve_dirty=True 的行：重排防抖计时器，把重启丢掉的排定重建补回来。
    - 逐空间处理（09-12）：每行带自己的 tenant_id——团队空间有构建任务恢复团队的
      （tenant_id=T 共享行），个人的恢复个人的（'' 占位行 → None），互不串扰。
    任何失败只记 warning，不阻塞启动。"""
    if os.environ.get("ENV") == "test":
        return  # 测试环境每个 TestClient 都过 lifespan，全局引擎指向真实文件库，禁自动续建
    try:
        db = SessionLocal()
        try:
            # 会话关闭前取值，避免 DetachedInstanceError（0.2.61 的坑）
            interrupted = [
                (r.user_id, r.tenant_id or None, r.preferred_model, bool(r.auto_resumed))
                for r in db.query(GraphBuildState).filter(
                    GraphBuildState.state.in_(("exporting", "building"))).all()
            ]
            dirty_rows = [
                (r.user_id, r.tenant_id or None)
                for r in db.query(GraphBuildState).filter(
                    GraphBuildState.evolve_dirty.is_(True)).all()
            ]
        finally:
            db.close()
    except Exception as e:
        logger.warning("graphify build recovery scan failed: %s", e)
        return

    for uid, tid, model, already_resumed in interrupted:
        try:
            if already_resumed:
                _set_build_status(uid, tenant_id=tid, state="failed", progress=None, auto_resumed=False,
                                  error="构建多次被进程重启中断，请手动重新构建（已完成部分命中缓存，不会重复抽取）")
                continue
            # 先清掉在途状态，否则 start_build_background 会误判「构建中」而跳过
            _set_build_status(uid, tenant_id=tid, state="idle", progress=None, error=None)
            start_build_background(uid, preferred_model=model, _auto_resume=True, tenant_id=tid)
            logger.info("graphify interrupted build auto-resumed user=%s tenant=%s model=%s", uid, tid, model)
        except Exception as e:
            logger.warning("graphify interrupted build resume failed user=%s tenant=%s: %s", uid, tid, e)

    for uid, tid in dirty_rows:
        try:
            threading.Thread(target=maybe_trigger_evolve, args=(uid, tid), daemon=True).start()
        except Exception as e:
            logger.warning("graphify evolve-dirty recovery failed user=%s tenant=%s: %s", uid, tid, e)


def register_evolve_listener() -> None:
    """挂写入监听：任何路径写入笔记/剪藏/知识单元
    （API/批量导入/剪藏扩展/插件同步/管线）提交后都触发自进化。

    注意：after_commit 钩子里 session.new/dirty/deleted 已被清空，必须在
    before_commit 捕获、after_commit 投递（0.2.44 冒烟发现的坑——此前本监听
    从未真正触发，自进化实际处于静默失效状态）。"""
    global _evolve_listener_registered
    if _evolve_listener_registered:
        # lifespan 重入（测试里每个 TestClient 一次）不得重复挂，否则一次提交触发 N 次自进化
        return
    _evolve_listener_registered = True

    from sqlalchemy import event
    from app.core.database import SessionLocal as _SessionLocal
    from app.models.base import Note, BrowserClip, KnowledgeUnit

    _pending: dict = {}

    @event.listens_for(_SessionLocal, "before_commit")
    def _capture(session) -> None:
        # 覆盖新增/更新/删除，符合“任何写入提交后触发自进化”的语义
        # 09-12 产物目录空间化落地：捕 (user_id, tenant_id) 对——个人内容触发个人
        # 空间自进化，团队内容触发团队空间自进化（用写入者本人的配置，配置仍是
        # 个人级，见模块 docstring 拍板口径）；两空间语料/产物/状态全链各走各的
        targets = {
            (obj.user_id, getattr(obj, "tenant_id", None) or None)
            for state in (session.new, session.dirty, session.deleted)
            for obj in state
            if isinstance(obj, (Note, BrowserClip, KnowledgeUnit)) and getattr(obj, "user_id", None)
        }
        if targets:
            _pending[id(session)] = targets

    @event.listens_for(_SessionLocal, "after_commit")
    def _on_content_commit(session) -> None:
        targets = _pending.pop(id(session), None)
        if not targets:
            return
        for uid, tid in targets:
            # 独立线程+新会话，不占用已提交的请求会话
            threading.Thread(target=maybe_trigger_evolve, args=(uid, tid), daemon=True).start()


# ── 平台模型构建成本预估与余额门 ─────────────────────────────

def estimate_build_cost(db: Session, user_id: str, model_id: str,
                        tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """平台模型构建成本预估：语料 token 量 × 目录单价。

    口径：提取调用 ≈ 每篇一次，输入 = 语料估算 token，输出 ≈ 400/篇；
    价格取 llm_models 目录（管理后台可改）。模型不在目录时 cost 为 None。
    语料范围按空间（09-12，与 export_user_corpus 同口径）：团队空间估全团内容，
    个人空间只估本人个人行——估价必须对准实际会进语料的内容，否则余额门误判。
    """
    from app.models.llm_billing import LLMModel
    from app.services.llm_service import LLMRouterService

    def _scope(model):
        if tenant_id:
            return model.tenant_id == tenant_id
        return and_(model.user_id == user_id, model.tenant_id.is_(None))

    from app.core.tenant_scope import semantic_visible

    texts: List[str] = []
    # 仓库模式（index_only）不进图谱语料，估算口径与实际构建一致
    for note in db.query(Note).filter(_scope(Note), Note.status == "active", semantic_visible(Note)).all():
        texts.append(note.content or "")
    for clip in db.query(BrowserClip).filter(_scope(BrowserClip), BrowserClip.status == "active", semantic_visible(BrowserClip)).all():
        texts.append(clip.full_text or clip.excerpt or "")
    for ku in db.query(KnowledgeUnit).filter(
        _scope(KnowledgeUnit),
        KnowledgeUnit.status == "active",
        or_(
            KnowledgeUnit.verification_status != "debunked",
            KnowledgeUnit.verification_status.is_(None)
        ),
    ).all():
        texts.append(ku.content_raw or "")

    input_tokens = sum(LLMRouterService.estimate_tokens(t) for t in texts if t)
    output_tokens = len(texts) * 400
    row = db.query(LLMModel).filter(LLMModel.id == model_id).first()
    cost = None
    if row:
        price_in = float(row.price_input_per_1k or 0)
        price_out = float(row.price_output_per_1k or 0)
        cost = round(input_tokens * price_in / 1000 + output_tokens * price_out / 1000, 2)
    return {
        "model": model_id,
        "docs": len(texts),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost": cost,
        "cost_note": "提取调用按每篇一次估算，实际随分块数量上下浮动",
    }


def start(app) -> None:
    """启动钩子：图谱目录迁移 + 自进化监听 + 中断构建恢复。

    从 app.main 的 lifespan 抽出（零行为变化搬运，注释随代码走）。
    """
    # 图谱数据目录迁移：安装目录（旧默认）→ 用户数据目录（自动更新会清空安装目录）
    migrate_legacy_data_root()

    # 图谱自进化：事件驱动（内容写入 after_commit → 自动重建），无定时器
    register_evolve_listener()

    # 图谱构建恢复：重启时正在构建的自动断点续建（缓存命中增量续跑）+ 自进化 dirty 补排
    recover_interrupted_builds()
