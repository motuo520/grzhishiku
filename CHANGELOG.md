# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Auth interceptor deadlock**: a failed `/auth/refresh` (401) used to re-trigger the refresh flow and await itself, leaving the UI on an infinite loading spinner.
- **Anonymous 401 redirect**: guest users hitting a 401 API were force-redirected to `/welcome`; they can now browse the app in guest mode as designed.
- **KnowledgeDetail crash**: the page crashed with `Cannot read properties of undefined (reading 'length')` when a knowledge unit had an empty `content_raw`.

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
