# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-19

### Added

- **Cloud Sync (paid layer)**: end-to-end encrypted multi-device sync powered by MinIO/S3-compatible storage.
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

- Switched default secret placeholders to empty values with dev-only ephemeral fallbacks and production validation.
- Rewrote `README.md` to focus on the three core actions: capture → organize → retrieve.
- `storage` plan now unlocks `cloud_sync`; `free` plan explicitly disables it.
- Payment page now highlights end-to-end encrypted cloud sync.
- Docker Compose now includes MinIO by default.

### Security

- Removed old placeholder secrets and test passwords from current code and git history using `git filter-repo`.
- E2E sync encryption ensures the server never sees plaintext user data.

[Unreleased]: https://github.com/your-org/personal-second-brain/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/personal-second-brain/releases/tag/v0.1.0
