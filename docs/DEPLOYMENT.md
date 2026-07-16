# 部署文档

## 环境要求

- **Python**: 3.11+
- **Node.js**: 20+
- **数据库**: SQLite（默认）或 PostgreSQL 14+
- **缓存**: Redis（可选，推荐生产环境）
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

### 1. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，设置 SECRET_KEY、ADMIN_SECRET_KEY 等敏感配置
```

### 2. 构建并启动
```bash
docker-compose up -d --build
```

服务映射：
- 前端: http://localhost:3000
- 后端 API: http://localhost:8000
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001

### 3. 查看日志
```bash
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 4. 停止服务
```bash
docker-compose down
# 包含数据卷清理
docker-compose down -v
```

## 环境变量说明

| 变量 | 说明 | 默认值 | 必需 |
|------|------|--------|------|
| ENV | 运行环境 | development | 是 |
| DATABASE_URL | 数据库连接 | sqlite:///./psb.db | 是 |
| SECRET_KEY | JWT 密钥 | - | 是 |
| ADMIN_SECRET_KEY | 管理员 JWT 密钥 | - | 是 |
| REDIS_URL | Redis 缓存地址 | - | 否 |
| OLLAMA_BASE_URL | 本地 LLM 地址 | http://localhost:11434 | 否 |
| API_BASE_URL | 后端 URL | http://localhost:8000 | 是 |
| FRONTEND_URL | 前端 URL | http://localhost:3000 | 是 |
| ALLOWED_ORIGINS | CORS 白名单 | - | 是 |

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

- Prometheus 抓取配置在 `prometheus.yml`
- Grafana 仪表盘在 `monitoring/grafana/`
- 后端日志轮转：10MB 最大，保留 5 个备份

## 升级和回滚

升级：
```bash
git pull
docker-compose up -d --build
```

回滚：
```bash
git checkout <previous-tag>
docker-compose up -d --build
```
