# Personal Second Brain — 生产部署文档

## 系统要求

- Docker 20.10+ / Docker Compose 2.0+
- 4GB RAM 最小（推荐 8GB）
- 20GB 磁盘空间
- Python 3.11+（开发模式）
- Node.js 20+（开发模式）

## 快速启动（Docker）

```bash
# 1. 克隆仓库
git clone <repo-url>
cd personal-second-brain

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置 SECRET_KEY 和 ADMIN_SECRET_KEY

# 3. 启动全部服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f backend

# 5. 访问服务
# 前端: http://localhost:3000
# API: http://localhost:8000
# Swagger: http://localhost:8000/docs
# Prometheus: http://localhost:9090
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SECRET_KEY` | JWT 签名密钥 | 必填 |
| `ADMIN_SECRET_KEY` | Admin JWT 签名密钥 | 必填 |
| `DATABASE_URL` | SQLite 数据库路径 | `sqlite:///data/psb.db` |
| `OLLAMA_BASE_URL` | Ollama 服务地址 | `http://ollama:11434` |
| `REDIS_URL` | Redis 连接地址 | `redis://redis:6379` |

## 生产安全清单

- [ ] 修改所有默认密钥（SECRET_KEY, ADMIN_SECRET_KEY）
- [ ] 启用 HTTPS（使用反向代理如 Nginx/Traefik）
- [ ] 配置防火墙（仅开放 80/443）
- [ ] 设置自动备份（数据库 + 附件）
- [ ] 配置日志轮转（防止磁盘占满）
- [ ] 启用监控告警（Prometheus + Alertmanager）

## 备份策略

```bash
# 手动备份
docker-compose exec backend cp /app/data/psb.db /app/data/psb.db.backup.$(date +%Y%m%d)

# 自动备份（添加到 crontab）
# 0 2 * * * cd /opt/psb && docker-compose exec -T backend cp /app/data/psb.db /app/data/psb.db.backup.$(date +\%Y\%m\%d)
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| 前端无法连接 API | CORS 配置错误 | 检查 `allow_origins` |
| 数据库锁定 | SQLite 并发写入 | 重启服务，考虑迁移到 PostgreSQL |
| Ollama 响应慢 | 模型过大 | 切换轻量模型或增加内存 |
| 磁盘空间不足 | 日志膨胀 | 配置日志轮转，清理旧备份 |

## 监控端点

- `/health` — 系统健康状态
- `/api/admin/monitoring/prometheus` — Prometheus 指标
- `/api/admin/dashboard/stats` — 业务统计

## 升级步骤

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 构建新镜像
docker-compose build

# 3. 执行数据库迁移
docker-compose run --rm backend alembic upgrade head

# 4. 重启服务
docker-compose up -d
```
