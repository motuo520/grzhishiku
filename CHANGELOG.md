# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
