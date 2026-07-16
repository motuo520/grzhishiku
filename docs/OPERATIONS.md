# 运维手册

## 日常运维检查清单

### 每日
- [ ] 检查 `/health` 端点响应状态
- [ ] 审查错误日志（grep ERROR /var/log/psb/app.log）
- [ ] 检查磁盘使用率（告警阈值：80%）
- [ ] 检查内存和 CPU 使用率

### 每周
- [ ] 数据库备份验证
- [ ] 审查 Prometheus 告警（响应时间 > 2s，错误率 > 1%）
- [ ] 检查安全日志（异常登录、限流触发）
- [ ] 更新依赖（检查安全漏洞）

### 每月
- [ ] 全量数据备份归档
- [ ] SSL 证书有效期检查
- [ ] 性能基准测试
- [ ] 清理过期日志和临时文件

## 常见问题排查

### 数据库连接失败
```bash
# 检查 SQLite 文件权限
ls -la data/psb.db
# 检查 WAL 模式
sqlite3 data/psb.db "PRAGMA journal_mode;"
# 修复 WAL
sqlite3 data/psb.db "PRAGMA wal_checkpoint;"
```

### LLM 服务不可用
```bash
# 检查 Ollama 状态
curl http://localhost:11434/api/tags
# 检查后端 LLM 健康端点
curl http://localhost:8000/api/v1/llm/health
```

### 内存不足
- 检查 Redis 内存使用：`redis-cli info memory`
- 限制 LLM 并发请求数
- 增加容器内存限制

## 数据备份和恢复

### SQLite 备份
```bash
# 在线备份
sqlite3 data/psb.db ".backup '/backup/psb-$(date +%Y%m%d).db'"
# 导出 SQL
sqlite3 data/psb.db ".dump" > /backup/psb-$(date +%Y%m%d).sql
```

### 恢复
```bash
# 停止服务
docker-compose stop backend
# 替换数据库
cp /backup/psb-20240101.db data/psb.db
# 重启服务
docker-compose up -d backend
```

## 用户管理

### 创建管理员
```bash
curl -X POST http://localhost:8000/api/admin/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"newadmin@example.com","password":"SecurePass123","name":"New Admin"}'
```

### 重置密码
直接修改数据库（仅限紧急情况）：
```bash
python -c "
from app.core.security import get_password_hash
print(get_password_hash('NewPassword123'))
"
# 然后更新 users 表的 password_hash 字段
```

### 禁用用户
```bash
curl -X PATCH http://localhost:8000/api/admin/users/<user_id> \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"suspended"}'
```

## 系统维护窗口

### 维护模式开关
```bash
# 开启维护模式（通过系统配置）
curl -X PUT http://localhost:8000/api/admin/config/maintenance_mode \
  -H "Authorization: Bearer <admin_token>" \
  -d '{"value":"true"}'
# 用户会收到 503 响应，前端显示维护页面
```

## 告警处理流程

| 告警 | 阈值 | 处理步骤 |
|------|------|----------|
| 响应时间 > 2s | P95 > 2s | 1. 检查数据库慢查询 2. 增加缓存 3. 扩展后端实例 |
| 错误率 > 1% | 5分钟窗口 | 1. 查看错误日志 2. 回滚最近部署 3. 检查外部依赖 |
| 磁盘 > 80% | 使用率 > 80% | 1. 清理日志 2. 归档旧数据 3. 扩容磁盘 |
| 内存 > 85% | 使用率 > 85% | 1. 重启服务 2. 检查内存泄漏 3. 增加实例内存 |
| LLM 不可用 | 连续 3 次失败 | 1. 检查 Ollama 服务 2. 切换备用模型 3. 查看网络连接 |
