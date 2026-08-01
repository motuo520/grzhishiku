"""Desktop sidecar entry point.

Starts the FastAPI backend embedded in the Electron app. Also used as the
PyInstaller entry script for the frozen psb-backend executable.

Environment variables:
  PSB_DATA_DIR        Data directory (DB, uploads, logs, secrets).
                      Default: ~/.psb-desktop
  PSB_PORT            Port to bind on 127.0.0.1. Default: 18723
  SERVE_FRONTEND_DIR  Optional Vite dist directory; when set, the server
                      also hosts the SPA at "/" (same origin as the API).

The script chdirs into PSB_DATA_DIR so every relative path the backend uses
(uploads/, graphify_data/, logs/, ./chroma_db) lands inside the data dir.
Secrets are generated once and persisted so tokens survive restarts.
"""

import json
import os
import secrets
import sys
from pathlib import Path


def _prepare_environment() -> int:
    data_dir = Path(os.environ.get("PSB_DATA_DIR") or (Path.home() / ".psb-desktop"))
    data_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(data_dir)

    # Database lives in the data dir unless explicitly overridden.
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{data_dir.as_posix()}/psb.db")

    # Desktop runs as a self-contained production app.
    os.environ.setdefault("ENV", "production")
    os.environ.setdefault("DEBUG", "false")
    # 桌面端标记：外部模型会员门（desktop_gate）据此启用
    os.environ.setdefault("PSB_DESKTOP", "1")

    # 本地向量模型：默认用专用 embedding 模型（qwen2.5:0.5b 是聊天模型，
    # Ollama 0.32+ 不支持它做 embedding，会静默降级成 mock 假向量）。
    # 用户机器没拉取该模型时仍会回退 mock，指南页有拉取命令。
    os.environ.setdefault("OLLAMA_EMBED_MODEL", "nomic-embed-text")

    # Generate secrets once, persist them so sessions survive restarts.
    secrets_file = data_dir / ".desktop-secrets.json"
    persisted: dict = {}
    if secrets_file.exists():
        try:
            persisted = json.loads(secrets_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            persisted = {}
    changed = False
    for key in ("SECRET_KEY", "ADMIN_SECRET_KEY", "DATABASE_ENCRYPT_KEY"):
        if os.environ.get(key):
            continue
        if key not in persisted:
            persisted[key] = secrets.token_urlsafe(48)
            changed = True
        os.environ[key] = persisted[key]
    if changed:
        secrets_file.write_text(json.dumps(persisted, indent=2), encoding="utf-8")

    return int(os.environ.get("PSB_PORT") or 18723)


def main() -> None:
    port = _prepare_environment()

    # Ensure the app package is importable when running from source.
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
