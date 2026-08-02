# 开源发布前全站审查报告

> 审查日期：2026-08-01
> 范围：后端安全 / 后端代码质量 / 前端生产就绪 / 前端路由一致性 / 文档与开源就绪
> 结论：**2 个致命安全问题 + 一批发布阻断项，修复后方可公开发布。**
>
> **修复状态（2026-08-01 更新）：本报告全部问题已修复并验证**（后端 102 项测试通过、前端 lint 0 error / typecheck 通过 / build 成功、`docker compose config` 解析通过）。两个例外需人工处理：
> 1. `screenshots/` 四张截图需用无个人标识的账号重新拍摄替换；
> 2. `review_report.md`（旧）与本报告含安全细节，公开发布前建议从仓库移除（`git rm --cached` 或删除后提交）。
>
> 修复要点：MCP 默认关闭且需 JWT 认证（`MCP_ENABLED`）；密钥改为首次启动自动生成并持久化到 `./server-data/.secrets/`（compose 不再携带公开默认密钥，ENV=production）；备份包移出无鉴权的 `/uploads` 静态目录；OAuth state 加 HMAC 签名；上传限 100MB；SSRF 内网拦截；邮箱/网盘凭证 Fernet 加密落库；Dockerfile 补 COPY scripts；README/docs/扩展端口修正；前端两处 hooks 崩溃修复；17 个死文件删除；CHANGELOG 合并重写。


---

## 一、致命（发布前必须修复）

| # | 位置 | 问题 |
|---|------|------|
| F1 | `backend/app/mcp/server.py:16-19`、`backend/app/mcp/tools.py:14-150` | MCP SSE 服务挂载在 `/api/v1/mcp` 且**完全无认证**，`user_id` 只是普通入参——任何人可读写任意用户的笔记/知识单元，等于全站认证绕过 |
| F2 | `docker-compose.yml:55-57` + `app/core/config.py:95-104` | compose 从未设置 `ENV=production`，SECRET_KEY/ADMIN_SECRET_KEY/DATABASE_ENCRYPT_KEY 均带公开硬编码默认值——按默认 compose 部署的实例，任何人可用仓库里公开的密钥伪造任意用户乃至 admin 的 JWT |

## 二、严重（发布阻断）

### 安全
- `app/api/v1/endpoints/storage.py:168-193`：网盘 OAuth callback 直接把 `state` 当 `user_id` 绑定凭证，无签名/nonce——CSRF 式账号绑定
- `app/main.py:259`：`/uploads` 整目录无认证静态托管，用户文档、聊天导出、**含全部用户数据的备份 ZIP** 都在其下，仅靠 uuid 文件名不可猜兜底

### 打包/开箱即用
- `backend/Dockerfile:48`：镜像只 `COPY app/`，缺 `scripts/`——README 教的 `docker compose exec backend python -m scripts.create_admin` 在容器内必然失败（新用户创建管理员的核心路径走不通）
- `README.md:24,50`、`docs/guide/getting-started.md:12`：快速开始 `cd personal-second-brain` 目录名错误，实际为 `grzhishiku`，第一条命令即失败
- `browser-extension/api-client.js:11`、`options.html:52`：扩展默认 API 指向 `http://localhost:8002`，实际后端为 8000——开箱剪藏必失败，且与同目录 `modules/sync.js:12`、`capsule-bridge.js:10` 的 8000 自相矛盾

### 前端运行时
- `src/components/mascot/MascotWidget.tsx:258-262`：早退之后才调用 hooks——登出或切换吉祥物开关时 hooks 数量不一致，**直接崩溃**
- `src/components/navigation/ModuleLayout.tsx:57`：pipeline kill-switch 早退位于 `useEffect` 之前，管理员禁用 pipeline 后二次渲染 hook 数减少，同样崩溃
- `src/components/auth/LoginModal.tsx:80`：登录失败兜底硬编码 `fetch('http://localhost:8000/...')` 并 `window.location.reload()`，非 localhost 部署下行为错误
- `src/components/search/FusionSearch.tsx:18`：结果全是写死的 6 条假数据（且含经典版专属路径）；`AppLayout.tsx:18,33` 中 `searchOpen` 永远为 false 不可触发——要么接通已存在的 `brainApi.fusionSearch`，要么删除
- `src/pages/LoginPage.tsx:72`：`console.log` 明文打印密码（虽已无路由的死代码，但源码随仓库公开）

### 内容/合规
- `screenshots/demo.gif`、`dashboard.png`、`chat-citation.png`、`knowledge-personal.png`：右上角含疑似 QQ 号的用户标识 `253700750`，且展示 DeepSeek 付费 UI（余额 ¥0.98/充值）——泄露个人标识，并与「开源版仅本地模型、无计费」矛盾
- `docs/promotion/v0.1.0-launch.md:16,47,91`：对外发布文案仍写「购买存储会员/订阅后多端同步」，与 CHANGELOG「同步免费、支付已剥离」直接矛盾
- `.github/FUNDING.yml:4-10`：全部为 `your-github-username` 占位符

## 三、警告（建议发布前处理）

### 后端
- `app/services/security_middleware.py:34-37`：非 production 登录限流放宽到 1000 次/分，而部署默认 ENV=development，实际无暴力破解防护；限流器为单进程内存实现、反代后全站共享一个桶
- `app/services/url_metadata.py:38`、`read_later_service.py:155`、`rss.py:89`：服务端抓取用户提供的任意 URL，无内网过滤——SSRF 可探测内网（Ollama 11434、MinIO 9000 等）
- `app/api/v1/endpoints/sync.py:102`：快照上传一次性读入内存，全站上传无大小限制——内存/磁盘 DoS
- `app/services/data_transfer_service.py:116-122`：导入时 id 撞车会"收养并覆盖"其他用户的数据（与无认证 MCP 组合后成跨用户写原语）
- `app/models/messaging.py:68-69`：邮箱 IMAP 密码/OAuth token 注释宣称 "encrypted" 但实际**明文落库**；网盘 token 同样明文
- `app/api/v1/endpoints/auth.py:96-105,133-145`：登录/refresh 不校验 `user.status`；logout 无吊销机制，JWT 硬编码 7 天有效，无视配置的 24h
- `app/services/social_parsers/wechat_parser.py:45-47`：zip 条目名未清洗，`os.path.join(temp_dir, name)` 存在受限任意文件读
- 多处端点（llm.py:323 等）把原始异常/子进程 stderr 放进 4xx/5xx detail 返回客户端，泄露内部路径
- `backend/requirements.txt`：夹带未使用的 `redis`、`chromadb`（重型）、`slowapi`、`openai`；`pytest/black/ruff` 等开发依赖混入生产镜像；`bcrypt` 仅靠 `passlib[bcrypt]` extra 间接带入，清理 passlib 会连带翻车
- `app/api/admin/endpoints/stats.py`：TODO 占位死代码，一旦被挂载即未授权端点
- 14 处 `except` 分支用 `print()` 而非 logger（document_service.py:291 等）

### 前端
- `src/pages/admin/AdminDashboard.tsx:97-110`：后端无数据时用 `Math.random()` 生成假的用户增长曲线
- `src/pages/settings/PrivacySettings.tsx:139`：「敏感数据加密」开关为未实现的 UI 占位
- 简化版孤儿页：`/community`、`/community/guide`（simple 桶列表不含 community）、`/ingest/bookmarks`、`/ingest/email` 无任何菜单入口
- `store/navigation.ts:464-472`：`getMenuIdByPath` 在简化版推导不出 graph/knowledge/capsules 归属，顶部桶不高亮
- 死代码清理（均无引用）：LoginPage、GlobalSearch、chat/ChatPanel+ChatInputBar、TechBackground、VirtualList、BrainSwitcher、RadarMirror、整套动态背景子系统（7 个文件）、`LLMConnectionStatus` 内 5 个未用函数
- `npm run lint` 78 个 error（约 40 处未使用 import/变量），CI `--max-warnings 0` 会红

### 文档
- `CHANGELOG.md`：同版本号 v0.1.0 两段两个日期；写 "Classic mode (default)" 与 README「简化版默认」矛盾；未记录 graphify 图谱功能
- `app/core/config.py:8`：`APP_NAME` 默认值 `"Wenmo"` 旧品牌名残留
- `.env.example:40`：`EMBEDDING_DIMENSION=768` 与代码默认 896 矛盾（nomic-embed-text 实际 768）
- 根 `.env.example` 注释称「可覆盖默认值」，但 compose 对这些变量硬编码不插值，有误导
- `docs/DEPLOYMENT.md`/`OPERATIONS.md`：数据库路径写 `data/psb.db`（实际 `./server-data/psb.db`）、提及未使用的 Redis、命令直连默认不暴露的 8000 端口
- `docs/USER_GUIDE.md:15`：让最终用户打开开发端口 3000 而非 `http://localhost`；:150 支持邮箱为占位符
- `docs/design/` 微服务/订阅计费历史稿未标注「历史文档」
- `review_report.md`（旧）、`ACCEPTANCE.md`：内部文档，不宜随开源发布
- `Makefile`：docker-compose v1 语法 + Windows 专用命令
- `.env.example` 缺 `BAIDU/ALIYUN_NETDISK_*`、`SERVE_FRONTEND_DIR`；compose 未提供 `GRAPHIFY_OLLAMA_MODEL` 插值

## 四、检查后确认无问题的方面

- SQL 注入：全库均为参数化查询，无拼接——无发现
- 子进程命令注入：list 形式调用、无 shell=True——无发现
- git 追踪文件无 db/.env/graphify_data/node_modules——干净
- docker-compose 服务/端口/卷与代码一致（80→nginx→/api→backend:8000，`./server-data:/data`）
- 前端 `tsc --noEmit` 通过；无 TODO/FIXME 残留；无 lorem ipsum
- 路由表与两套菜单一一对应，经典版零死链，简化版专属页均有 RouteFallback 兜底
- admin RBAC（require_permission）主体完善、bcrypt 正常、TRADEMARK.md 自洽

## 五、建议修复顺序

1. **F1 + F2**（两个致命）：MCP 加认证或默认不挂载；compose 注入 `ENV=production` 并要求显式设置密钥（或改为 dev 默认 + 文档强提示）
2. 打包链路：Dockerfile COPY scripts、README/docs 的 `cd grzhishiku`、扩展端口 8002→8000
3. 前端崩溃：MascotWidget、ModuleLayout 两处 hooks 顺序
4. 截图脱敏重拍、FUNDING 填真实账号或删除、launch 文案去掉付费叙述
5. /uploads 鉴权、OAuth state 校验、FusionSearch 接通或删除、死代码清理
6. 警告级按需（SSRF、上传限流、异常脱敏、凭证明文）
