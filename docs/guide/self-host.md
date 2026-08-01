# 自托管部署

## 最小配置

fresh clone 后无需任何配置即可启动，`docker-compose.yml` 已内置全部默认值。

如需覆盖默认密钥，在仓库根目录创建 `.env`（compose 会自动读取用于变量插值）：

```ini
SECRET_KEY=<随机字符串，至少 32 字节>
ADMIN_SECRET_KEY=<另一组随机字符串>
DATABASE_ENCRYPT_KEY=<数据库加密密钥>
```

可以使用以下命令生成密钥：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Docker Compose

```bash
docker compose up -d
```

默认会启动：Ollama（内部网络）、前端（80）、后端（经前端 nginx 代理）、MinIO（9000/9001）。
首次启动自动拉取模型 `qwen2.5:0.5b` 与 `nomic-embed-text`。云同步依赖 MinIO，无需额外配置。

## 反向代理与 SSL

推荐使用 Nginx 或 Traefik 反代，并申请 Let's Encrypt 证书。

示例 Nginx 配置：

```nginx
server {
    listen 443 ssl http2;
    server_name grzhishiku.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端容器已内置 /api/ 到 backend:8000 的代理，直接反代 80 端口即可
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 备份

默认使用 SQLite，数据统一落在 `./server-data/`，定期备份该目录即可：

- `server-data/psb.db` — SQLite 数据库
- `server-data/graphify_data/` — 图谱数据

## 更新

```bash
git pull
docker compose up -d --build
```
