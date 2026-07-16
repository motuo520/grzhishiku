# Phase 5 生产优化计划

## 执行策略
分 5 个阶段串行执行（每个阶段有依赖关系），阶段内可并行处理独立文件。

## Stage 1: 性能优化 (Performance)
- 前端: React.lazy + Suspense 代码分割、react-window 虚拟列表、QueryClient cacheTime、图片优化、Vite 构建优化
- 后端: 数据库索引、SQLite 连接池优化、LLM 缓存（内存 LRU）、GZipMiddleware、静态文件缓存头

## Stage 2: 安全加固 (Security)
- 输入验证: Pydantic Field 长度限制、EmailStr、regex 验证
- XSS 防护: bleach 清理用户输入、安全响应头完善
- CSRF 防护: SameSite Cookie、TrustedHostMiddleware
- Rate Limiting: slowapi 增强限流（安装、配置、规则）
- 密码安全: 复杂度校验、bcrypt 确认
- SQL 注入防护: 确认 ORM 参数化查询

## Stage 3: 测试覆盖 (Testing)
- 后端: tests/conftest.py, test_auth.py, test_notes.py, test_knowledge.py, test_capsules.py, test_llm.py, test_brain.py
- 前端: playwright E2E 框架（auth.spec.ts, notes.spec.ts, admin.spec.ts）

## Stage 4: 部署准备 (Deployment)
- Docker: backend/Dockerfile, frontend/Dockerfile, docker-compose.yml 完善
- CI/CD: .github/workflows/ci.yml
- SSL: nginx.conf 配置
- 监控: /metrics 端点完善、/health 端点完善、日志轮转
- 环境变量: .env.example, config.py 完善

## Stage 5: 文档收尾 (Documentation)
- API 文档: backend/API.md
- 部署文档: docs/DEPLOYMENT.md
- 运维手册: docs/OPERATIONS.md
- 用户手册: docs/USER_GUIDE.md
- README: README.md 重写

## 验证清单
- 前端: tsc --noEmit 通过
- 后端: python -c "import app.main; print('ok')" 通过
- 测试: pytest backend/tests/ 至少基础通过
- Docker: 检查配置文件语法（环境可能无 Docker）
