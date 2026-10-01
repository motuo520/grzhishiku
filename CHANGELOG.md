# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **同步主仓至 0.2.137 口径**：共享的 backend app/ 与 frontend src/ 漂移文件整体追齐主仓当前形态（目录级权限、X-Request-ID、软删向量残留根修、审计补强等）。剥离面保持不变——计费/BYOK/云代理/桌面安装/群组/回收站/分享/语音/租户/wiki 端点与服务、agent_*/memory/wiki/llm 等包形态服务均未带入；llm.py / cognitive.py / pipeline.py / llm_service.py / sync_service.py / sync_storage_service.py 等合并形态单文件保持开源版现版。
- **模型口径升级**：默认对话模型 qwen2.5:0.5b → qwen3.5:0.8b，嵌入模型 nomic-embed-text → bge-m3（1024d）；README/docker-compose/.env.example/docs 同步。存量库启动时按维度不一致自动后台重嵌（dimension migration）；embedding_service 保留旧嵌入模型的在场降级过渡（主仓同款）。

### Fixed

- **同步附带的剥离面接续**：被拷文件中指向剥离模块的 import 全部最小化修复——LLM 计费通道回调本地 `chat_completion`、配额改走 `user.storage_limit`、FTS/vec 影子索引调用移除（embeddings 表暴力余弦唯一路径）、OCR/自动打标/相似度物理图/回收站快照/实体消歧等入口按开源版口径闸停或报错。
- **存量库通用增量列迁移**：模型新增列在启动时自动 ALTER TABLE 补齐（只加不改不删），修复旧库升级后 `no such column` 启动失败。

### Documentation

- **文档全面翻新（对码口径）**：README/USER_GUIDE/DEPLOYMENT/OPERATIONS/comparison/guide×4 逐篇按同步后实际代码改实——简化版五动作口径（采集/自动理好/知识进化/知识地图/问答）、移除 ChromaDB 残留（向量为 SQLite embeddings 表暴力余弦+关键词混合检索）、MinIO 回环绑定、密钥 .secrets 持久化兜底、管理端命令（create_admin/system config/status 枚举）、快捷键表按实际实现重写；删除已剥离能力的描述（回收站/自动打标/多模型交叉验证/胶囊事件解锁/注意力屏蔽/隐私加密级别/自动同步间隔/Cmd+K/应用内工单入口）；设计稿三篇加「主仓商业版设计稿，开源精简版不含此能力」声明；依赖许可证清单改为开源版 requirements.txt 直接依赖口径（移除混入的商业版支付 SDK）。
- **screenshots/ 重拍**：欢迎页/仪表盘/引用问答/知识库四张 + demo.gif 按当前界面更新。

### Added

- **RSS 定时自动刷新**：单源可配自动刷新（30 分钟/1/6/24 小时），后端 sweeper 每 15 分钟扫描到期源，重启自动恢复。
- **图谱自进化（事件驱动）**：笔记/剪藏/知识单元写入提交后自动重建图谱；构建中置 dirty、成功后补建；后台构建线程独立会话（修复跨线程 Session 隐患）。
- **批量导入前置目标选择**：导入前先选目标类型——笔记 / 剪藏 / 稍后读 / RSS 源 / 知识单元；非目标类型条目预览置灰跳过、可切换续导。
- **反证处置闭环**：证伪（debunked）知识单元退出检索与图谱语料；存疑（disputed）检索降权 ×0.7；反证墙处置台（修正重验/保留观察/移除）。
- **注卡钩子**：已精修/登记践行的知识单元检索加权 ×1.15；管线总览「注卡之后」侧线导引。
- **浏览器扩展增强**：右键菜单（剪藏此页/选中内容）；token 来源校验；更新不再清空本地数据；同步检查 HTTP 状态码。
- **内置插件随包**：notion-import / pocket-sync / readwise-sync / mcp-server；插件目录补全 `__init__.py`（打包收集修复）。

### Fixed

- **Auth interceptor deadlock**: a failed `/auth/refresh` (401) used to re-trigger the refresh flow and await itself, leaving the UI on an infinite loading spinner.
- **Anonymous 401 redirect**: guest users hitting a 401 API were force-redirected to `/welcome`; they can now browse the app in guest mode as designed.
- **KnowledgeDetail crash**: the page crashed with `Cannot read properties of undefined (reading 'length')` when a knowledge unit had an empty `content_raw`.
- **Token 续期加固**：access/refresh 双 token 以 `token_use` 声明区分，access token 不再能无限续期；认证瞬时失败（网络抖动/启动竞态）自动重试并聚焦自愈，不再误踢登录。
- **检索关键词 LIKE 转义**：检索词含 `%`/`_` 时不再被当作通配符。
- **Ollama 保活策略**：小模型与嵌入模型常驻内存（keep_alive=-1），大模型 30 分钟闲置自动卸载。

## [0.1.0] - 2026-08-01

首个开源发布版（精简版）。

### Added

- **Dual interface modes (Classic ⇄ Simple)**: one-click switch in the top navigation bar and in Settings → Appearance; the choice is persisted locally.
  - Simple mode (default): the streamlined three-action navigation (capture → organize → retrieve).
  - Classic mode: the full 12-module navigation — capture, pipeline, attention, emergence studio, graph, knowledge base, time capsules, cognitive mirror, social brain, embodied cognition, community, settings.
  - Restored classic-mode pages: attention (6), cognitive mirror (7), emergence studio (7), social brain / jianghu (9+), embodied cognition (4), extra graph pages (5), extra knowledge pages (5), extra capsule pages (4), and the business-plan page.
  - Routes hidden in simple mode redirect to the dashboard; both modes share the same backend and data.
- **Graphify knowledge graph（知识图谱）**: 知识网络可视化、图谱 AI 问答、节点解释与图谱报告；图谱构建使用独立可配的 `GRAPHIFY_OLLAMA_MODEL` 本地模型。
- **Cloud Sync**: end-to-end encrypted multi-device sync powered by MinIO/S3-compatible storage (free in the open-source edition).
  - New sync tables: `sync_devices`, `sync_operations`, `sync_snapshots`.
  - New API endpoints under `/api/v1/sync/*`.
  - Client-side encryption (PBKDF2 + AES-GCM) in `frontend/src/services/syncCrypto.ts`.
  - New `SyncSettings` page for password, manual sync, and device management.
- **Documentation site** (VitePress skeleton): `docs/` with getting-started, self-host, model-setup, comparison, and sync guides.
- **Open-source repository readiness**:
  - AGPL-3.0 license.
  - Bilingual README (Chinese / English).
  - `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates.
- **Admin improvements**: user list/detail now shows sync device count and last sync time.
- **Tests**: `backend/tests/test_sync.py` covering feature gating, device registry, operation log, snapshot upload, and admin stats.

### Changed

- 仅支持 Ollama 本地模型（`qwen2.5:0.5b` 对话 + `nomic-embed-text` 向量化），免费、离线可用。
- 剥离桌面端、外部 LLM 供应商（BYOK）、支付/会员体系（保留在 prod 分支）。
- 云同步等原付费功能免费开放（快照存 MinIO，端到端加密不变）。
- 一行 `docker compose up -d` 自托管：fresh clone 无需任何 .env 配置，首次启动自动拉取模型。
- Switched default secret placeholders to empty values with dev-only ephemeral fallbacks and production validation.
- Rewrote `README.md` to focus on the three core actions: capture → organize → retrieve.
- Docker Compose now includes MinIO by default.

### Security

- Removed old placeholder secrets and test passwords from current code and git history using `git filter-repo`.
- E2E sync encryption ensures the server never sees plaintext user data.

[Unreleased]: https://github.com/motuo520/grzhishiku/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/motuo520/grzhishiku/releases/tag/v0.1.0
