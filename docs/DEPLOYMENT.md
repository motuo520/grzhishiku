# 部署文档

## 环境要求

- **Python**: 3.11+
- **Node.js**: 20+
- **数据库**: SQLite（默认）或 PostgreSQL 14+
- **容器**: Docker 20.10+ & Docker Compose 2.20+（推荐）

## 本地开发启动

### 后端
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 前端
```bash
cd frontend
npm install
npm run dev
# 打开 http://localhost:3000
```

## Docker 部署

### 1. 配置环境变量（可选）
所有配置均有默认值，fresh clone 即可启动；密钥留空时首次启动自动生成并持久化到 `./server-data/.secrets/`。
如需显式覆盖（公网部署建议）：
```bash
cp .env.example .env
# 编辑 .env 文件，设置 SECRET_KEY、ADMIN_SECRET_KEY、DATABASE_ENCRYPT_KEY 等敏感配置
```

### 2. 构建并启动
```bash
docker compose up -d --build
```

服务映射：
- 前端: http://localhost（80 端口，内置 nginx 将 /api/ 代理到后端）
- 后端 API: 容器内 8000，经前端 nginx 代理，默认不直接暴露
- MinIO: http://127.0.0.1:9000（API）/ http://127.0.0.1:9001（控制台）——仅回环绑定，不暴露公网

### 3. 查看日志
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### 4. 停止服务
```bash
docker compose down
# 包含数据卷清理
docker compose down -v
```

## 环境变量说明

所有变量均有默认值，无必填项；不配置任何 `.env` 也可直接 `docker compose up -d` 启动。

| 变量 | 说明 | 默认值 | 必需 |
|------|------|--------|------|
| ENV | 运行环境 | development | 否 |
| DATABASE_URL | 数据库连接 | sqlite:///./psb.db | 否 |
| SECRET_KEY | JWT 密钥 | 为空自动生成并持久化到数据目录 .secrets/ | 否 |
| ADMIN_SECRET_KEY | 管理员 JWT 密钥 | 同上 | 否 |
| DATABASE_ENCRYPT_KEY | 数据库加密密钥 | 同上 | 否 |
| OLLAMA_BASE_URL | 本地 LLM 地址 | http://localhost:11434（compose 内为 http://ollama:11434） | 否 |
| OLLAMA_MODEL | 对话模型 | qwen3.5:0.8b | 否 |
| OLLAMA_EMBED_MODEL | 嵌入模型（1024 维） | bge-m3 | 否 |
| API_BASE_URL | 后端 URL | http://localhost:8000 | 否 |
| FRONTEND_URL | 前端 URL | http://localhost:3000 | 否 |
| ALLOWED_ORIGINS | CORS 白名单 | http://localhost:3000,http://127.0.0.1:3000（compose 下默认为 http://localhost） | 否 |

## SSL 配置（Let's Encrypt）

使用 certbot 自动获取证书：
```bash
# 安装 certbot
docker run -it --rm \
  -v "./nginx/ssl:/etc/letsencrypt" \
  -v "./nginx/www:/var/www/certbot" \
  certbot/certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  -d your-domain.com
```

配置 nginx 重定向：
```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    # ... proxy config
}
```

## 监控和日志

- 健康检查端点：`/health`
- 后端日志轮转：10MB 最大，保留 5 个备份

## 升级和回滚

升级：
```bash
git pull
docker compose up -d --build
```

回滚：
```bash
git checkout <previous-tag>
docker compose up -d --build
```
