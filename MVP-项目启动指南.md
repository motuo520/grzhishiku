# Personal Second Brain - MVP 项目启动指南

> 从 0 到可运行的 MVP，预计 3 周完成核心功能：时间胶囊、注意力管家、反脆弱知识库、浏览器剪藏、LLM 路由。

---

## Week 1: 基础架构与核心数据

### Day 1: 项目脚手架搭建

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 创建目录结构，初始化前端 (Vite + React + TS) | `frontend/` 可运行 `npm run dev` | 浏览器访问 `http://localhost:5173` 看到默认页面 |
| 下午 | 初始化后端 (FastAPI + SQLAlchemy) | `backend/` 可运行 `uvicorn app.main:app --reload` | `curl http://localhost:8000/health` 返回 healthy |
| 晚上 | 安装核心依赖，配置 Tailwind + Zustand + React Query | `package.json` / `requirements.txt` 完整 | `npm install` 和 `pip install -r requirements.txt` 无报错 |

**关键命令：**
```bash
# 前端
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install zustand @tanstack/react-query react-router-dom framer-motion lucide-react
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# 后端
mkdir backend && cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install fastapi uvicorn[standard] sqlalchemy alembic pydantic chromadb ollama-python
```

---

### Day 2: 数据库设计与初始化

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 设计核心表：capsules, capsule_dialogues, attention_activities, attention_categories, knowledge_units | `backend/app/models/` 下 5 个模型文件 | `python -c "from app.models import *; print('OK')"` |
| 下午 | 配置 SQLCipher 加密、FTS5 全文搜索、向量索引表 | `database.py` 含加密配置和 FTS5 触发器 | 创建数据库后 `.db` 文件不可直接用文本读取 |
| 晚上 | 初始化 ChromaDB 集合 (knowledge_embeddings, capsule_embeddings) | `backend/app/core/vector_db.py` | 运行 `init_vector_db()` 无报错 |

**检查清单：**
- [ ] SQLite 启用外键约束 (`PRAGMA foreign_keys=ON`)
- [ ] FTS5 虚拟表自动同步触发器
- [ ] 向量表 `vector_embeddings` 可用 BLOB 存储
- [ ] Alembic 初始化迁移脚本

---

### Day 3: API 框架与基础接口

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 配置 FastAPI 路由、CORS、生命周期、依赖注入 | `backend/app/main.py` + `api/v1/router.py` | Swagger UI `/docs` 可访问 |
| 下午 | 实现时间胶囊 CRUD API (POST / GET / unlock / dialogue) | `backend/app/api/v1/endpoints/capsules.py` | `curl` 测试创建/查询/解锁流程 |
| 晚上 | 实现注意力活动记录 API (POST / GET / dashboard) | `backend/app/api/v1/endpoints/attention.py` | `curl` 测试活动记录和仪表盘查询 |

**关键接口：**
```
POST   /api/v1/capsules              创建胶囊
GET    /api/v1/capsules              胶囊列表
GET    /api/v1/capsules/{id}         胶囊详情
POST   /api/v1/capsules/{id}/unlock  解锁胶囊
POST   /api/v1/capsules/{id}/dialogue 提交对话
GET    /api/v1/capsules/events       SSE 实时推送

POST   /api/v1/attention/activities  记录活动
GET    /api/v1/attention/dashboard   仪表盘数据
POST   /api/v1/attention/deep-work   启动深度工作
DELETE /api/v1/attention/deep-work/{id} 结束深度工作
```

---

### Day 4: 前端布局框架

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现 AppLayout: 顶部导航 + 二级菜单平铺 + 状态栏 | `frontend/src/layouts/AppLayout.tsx` | 页面显示 8 个主菜单，点击展开二级菜单 |
| 下午 | 实现 TopNavigation 组件（含 badge、选中状态、响应式） | `frontend/src/components/navigation/TopNavigation.tsx` | 桌面端显示全部，平板可滚动 |
| 晚上 | 实现 SubMenuPanel（平铺卡片 + 动画 + 键盘导航） | `frontend/src/components/navigation/SubMenuPanel.tsx` | 点击主菜单，二级菜单从下方滑出 |

**检查清单：**
- [ ] 8 个主菜单全部可点击
- [ ] 二级菜单 6 列网格（桌面），4 列（平板），2 列（移动）
- [ ] 卡片 hover 有上浮效果
- [ ] Cmd/Ctrl + K 打开全局搜索
- [ ] 状态栏显示本地模型状态、同步状态、版本号

---

### Day 5: 全局搜索与状态管理

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现 Zustand 全局状态：导航、搜索、胶囊、注意力 | `frontend/src/store/` 目录 | 状态切换时组件正确响应 |
| 下午 | 实现全局搜索弹窗 (Cmd+K): 语义搜索 + 快捷键导航 | `frontend/src/components/search/GlobalSearch.tsx` | 输入关键词，显示搜索结果，方向键选择 |
| 晚上 | 配置 React Query 客户端、API 封装层、错误处理 | `frontend/src/api/` 目录 + `queryClient.ts` | API 调用成功，缓存生效 |

---

## Week 2: 核心功能开发

### Day 6: 时间胶囊 MVP (前端)

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现 CapsuleCreate 向导（4步：类型选择 → 内容 → 解锁条件 → 确认） | `frontend/src/pages/capsules/CapsuleCreate.tsx` | 可完成完整创建流程，数据到达后端 |
| 下午 | 实现 CapsuleList（时间轴视图 + 筛选 + 状态统计） | `frontend/src/pages/capsules/CapsuleList.tsx` | 列表显示正确，筛选有效 |
| 晚上 | 实现 CapsuleDetail（解锁动画 + 跨时空对话 + AI 洞察） | `frontend/src/pages/capsules/CapsuleDetail.tsx` | 解锁后显示对话界面，可提交回应 |

**检查清单：**
- [ ] 支持 4 种解锁类型：日期、事件、里程碑、条件
- [ ] 情绪快照（情绪类型 + 强度 + 能量）
- [ ] 封存动画（内容被吸入时间漩涡效果）
- [ ] 解锁时显示"过去的你"和"现在的你"对比
- [ ] AI Mediator 自动生成跨时空洞察
- [ ] SSE 实时推送解锁事件

---

### Day 7: 时间胶囊 MVP (后端完善)

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现胶囊解锁检查器（定时任务 + 条件评估） | `backend/app/services/capsule_service.py` | 创建日期胶囊，等待到达后状态变为 unlocked |
| 下午 | 实现对话 AI 集成（调用 LLM Router 生成洞察） | `backend/app/services/capsule_dialogue.py` | 解锁时 LLM 返回有意义的跨时空分析 |
| 晚上 | 胶囊统计、导出、测试覆盖 | 单元测试 + 集成测试 | `pytest` 全部通过 |

---

### Day 8: 注意力管家 MVP (前端)

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现注意力仪表盘（环形图 + 分类进度条 + 实时状态） | `frontend/src/pages/attention/AttentionPage.tsx` | 显示投资组合、实时专注度 |
| 下午 | 实现深度工作守护面板（配置规则 + 启动/结束） | `frontend/src/pages/attention/DeepWorkPanel.tsx` | 可配置屏蔽网站，启动守护 |
| 晚上 | 实现注意力报告（模式发现 + 优化建议） | `frontend/src/pages/attention/AttentionReport.tsx` | 显示本周模式和图表 |

---

### Day 9: 注意力管家 MVP (浏览器插件)

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现插件 AttentionTracker：标签页追踪、活动分类、切换检测 | `browser-extension/modules/attention.js` | 安装插件后，切换标签页数据被记录 |
| 下午 | 实现深度工作守护：declarativeNetRequest 拦截、通知屏蔽 | `browser-extension/background.js` | 启动守护后，访问 Twitter 被拦截并提示 |
| 晚上 | 实现插件 popup 面板（状态显示 + 快捷操作） | `browser-extension/popup.js` + `popup.html` | 点击扩展图标显示当前状态和快捷按钮 |

**检查清单：**
- [ ] 插件安装后自动创建右键菜单
- [ ] 标签页切换追踪（5秒内切换标记为干扰）
- [ ] 空闲状态检测（60秒无操作）
- [ ] 深度工作守护拦截非工作网站
- [ ] 数据离线缓存，恢复后自动同步
- [ ] 快捷键：Ctrl+Shift+S 剪藏，Ctrl+Shift+N 快速笔记

---

### Day 10: 反脆弱知识库 MVP

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现知识库前端：列表 + 状态筛选 + 验证按钮 | `frontend/src/pages/knowledge/KnowledgePage.tsx` | 显示知识单元，按状态筛选 |
| 下午 | 实现来源追溯面板（血统链 + 可信度评分） | `frontend/src/components/knowledge/ProvenancePanel.tsx` | 点击知识项显示来源链 |
| 晚上 | 实现多模型验证 UI（模型选择 + 进度 + 结果对比） | `frontend/src/components/knowledge/VerificationPanel.tsx` | 触发验证后显示多模型结果 |

**检查清单：**
- [ ] 6 种状态可视化（已确认/验证中/有争议/已过时/已证伪/待验证）
- [ ] 来源血统显示（原始来源 → 引用链）
- [ ] 批量验证队列（显示进度和预计完成时间）
- [ ] 反证收集（自动搜索相关质疑文章）
- [ ] 时效性追踪（新鲜度指示 + 过期提醒）

---

## Week 3: 集成、插件与打磨

### Day 11: LLM 路由服务

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现 LLM Router：配置管理、智能路由策略 | `backend/app/services/llm_service.py` | 根据任务类型选择正确模型 |
| 下午 | 集成 Ollama 本地模型（对话 + 嵌入） | 本地模型可用 | `ollama list` 显示已安装模型，API 调用成功 |
| 晚上 | 集成外部 API（OpenAI / Kimi / 千问） | 配置可切换 | 测试同一问题不同模型的回答 |

**路由策略：**
```python
{
  "sensitive_data": "local",      # 敏感数据 → Ollama
  "coding": "claude/kimi",        # 代码任务 → Claude/Kimi
  "chinese": "qwen",              # 中文内容 → 千问
  "long_context": "kimi",         # 长文本 → Kimi
  "quick_summary": "local",       # 快速摘要 → 本地
  "complex_reasoning": "gpt4"     # 复杂推理 → GPT-4
}
```

---

### Day 12: 浏览器插件完整打包

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 实现内容脚本：页面提取、高亮、快速笔记对话框 | `browser-extension/content.js` | 页面选中文字可高亮，快捷键弹出笔记框 |
| 下午 | 实现剪藏模块：Readability 提取、离线缓存、批量同步 | `browser-extension/modules/clipper.js` | 剪藏页面后数据到达后端知识库 |
| 晚上 | 配置 Vite 构建、manifest 生成、Chrome/Firefox 双打包 | `browser-extension/vite.config.js` | `npm run build` 生成 `dist/` 可加载到浏览器 |

**构建命令：**
```bash
cd browser-extension
npm install
npm run build          # Chrome 版本
npm run build:firefox  # Firefox 版本
```

---

### Day 13: 功能集成与端到端测试

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | 联调：前端 → API → 后端 → 数据库 全链路 | 端到端测试用例 | 创建胶囊 → 解锁 → 对话 → 查看统计 全流程通过 |
| 下午 | 联调：插件 → 后端 → 知识库 → 验证队列 | 集成测试 | 插件剪藏 → 知识库显示 → 触发验证 → 结果更新 |
| 晚上 | 联调：注意力插件 → 后端 → 前端仪表盘 | 实时数据流测试 | 插件记录活动 → 前端仪表盘实时更新 |

**测试场景：**
1. 用户安装浏览器插件
2. 浏览网页 → 使用插件剪藏 → 内容出现在知识库
3. 触发批量验证 → 查看验证进度 → 结果更新状态
4. 创建时间胶囊 → 设置解锁条件 → 到达后收到通知
5. 启动深度工作 → 访问被屏蔽网站 → 收到拦截提示
6. 查看注意力仪表盘 → 分析模式 → 获得优化建议

---

### Day 14: 打磨、文档与演示准备

| 时间 | 任务 | 交付物 | 验证方式 |
|------|------|--------|----------|
| 上午 | UI 打磨：动画优化、空状态、错误提示、响应式适配 | 全平台测试通过 | 桌面/平板/移动端均可正常使用 |
| 下午 | 性能优化：虚拟滚动、懒加载、缓存策略、防抖 | Lighthouse 评分 | 首屏加载 < 2s，交互延迟 < 100ms |
| 晚上 | 编写 README、API 文档、部署指南 | `README.md` + `docs/` | 新开发者可按文档 10 分钟内跑起项目 |

---

## 技术栈总览

```
前端 (Frontend)
├── React 19 + TypeScript + Vite
├── Tailwind CSS + CSS Variables (主题系统)
├── Zustand (状态管理)
├── React Query (数据同步)
├── Framer Motion (动画)
├── D3.js / React-Flow (图谱可视化)
├── TipTap (富文本编辑器)
└── Dexie.js (IndexedDB 前端缓存)

后端 (Backend)
├── FastAPI + SQLAlchemy + Alembic
├── SQLite + SQLCipher (加密数据库)
├── ChromaDB (向量数据库)
├── Redis (缓存 + 队列 + SSE)
├── Ollama (本地 LLM)
└── JWT + Argon2 (认证)

浏览器插件 (Browser Extension)
├── Manifest V3 (Chrome/Edge)
├── Manifest V2 兼容 (Firefox)
├── Vite 构建系统
├── Readability.js (内容提取)
└── declarativeNetRequest (网络拦截)

桌面端 (Desktop - 可选)
└── Tauri (Rust + WebView) - 第三阶段

基础设施
├── Docker + Docker Compose
├── Traefik (API 网关)
├── Prometheus + Grafana (监控)
└── GitHub Actions (CI/CD)
```

---

## 验证里程碑

| 里程碑 | 截止时间 | 验证标准 |
|--------|----------|----------|
| **M1: 基础架构** | Day 5 | 前后端可独立运行，数据库可读写，API 文档可访问 |
| **M2: 时间胶囊** | Day 7 | 可创建/解锁/对话，SSE 推送正常，AI 洞察生成 |
| **M3: 注意力管家** | Day 9 | 插件可追踪活动，深度工作守护可拦截网站，仪表盘显示数据 |
| **M4: 反脆弱知识库** | Day 10 | 可剪藏入库，显示来源，触发验证，查看状态 |
| **M5: LLM 路由** | Day 11 | 本地模型可运行，外部 API 可切换，路由策略生效 |
| **M6: 插件打包** | Day 12 | 可构建 Chrome/Firefox 扩展包，安装后功能正常 |
| **M7: 端到端** | Day 13 | 完整用户旅程测试通过，无明显阻塞 Bug |
| **M8: MVP 完成** | Day 14 | 文档完整，性能达标，可对外演示 |

---

## 目录结构

```
personal-second-brain/
├── frontend/                  # React + Vite 前端
│   ├── src/
│   │   ├── api/               # API 封装层
│   │   ├── components/        # 通用组件
│   │   │   ├── navigation/    # 导航相关
│   │   │   ├── search/        # 搜索相关
│   │   │   └── ui/            # 基础 UI 组件
│   │   ├── layouts/           # 页面布局
│   │   ├── pages/             # 页面级组件
│   │   │   ├── capsules/      # 时间胶囊
│   │   │   ├── attention/     # 注意力管家
│   │   │   ├── knowledge/     # 反脆弱知识库
│   │   │   ├── graph/         # 知识图谱
│   │   │   └── settings/      # 设置
│   │   ├── store/             # Zustand 状态管理
│   │   ├── hooks/             # 自定义 Hooks
│   │   ├── utils/             # 工具函数
│   │   ├── types/             # TypeScript 类型定义
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                   # FastAPI 后端
│   ├── app/
│   │   ├── main.py            # FastAPI 入口
│   │   ├── core/              # 核心配置
│   │   │   ├── config.py      # 配置管理
│   │   │   ├── database.py    # 数据库连接
│   │   │   ├── security.py    # 安全认证
│   │   │   └── vector_db.py   # ChromaDB 配置
│   │   ├── api/               # API 路由
│   │   │   └── v1/
│   │   │       ├── router.py      # 路由聚合
│   │   │       └── endpoints/     # 业务端点
│   │   │           ├── auth.py
│   │   │           ├── capsules.py
│   │   │           ├── attention.py
│   │   │           ├── knowledge.py
│   │   │           ├── graph.py
│   │   │           ├── llm.py
│   │   │           └── sync.py
│   │   ├── models/            # SQLAlchemy 模型
│   │   │   ├── base.py
│   │   │   ├── capsule.py
│   │   │   ├── attention.py
│   │   │   ├── knowledge.py
│   │   │   ├── user.py
│   │   │   └── sync.py
│   │   ├── schemas/           # Pydantic 模型
│   │   ├── services/          # 业务逻辑
│   │   │   ├── capsule_service.py
│   │   │   ├── attention_service.py
│   │   │   ├── knowledge_service.py
│   │   │   ├── llm_service.py
│   │   │   └── sync_service.py
│   │   └── utils/             # 工具函数
│   ├── tests/                 # 测试用例
│   ├── alembic/               # 数据库迁移
│   ├── Dockerfile
│   └── requirements.txt
│
├── browser-extension/         # 浏览器插件
│   ├── manifest.json
│   ├── background.js          # Service Worker
│   ├── content.js               # 内容脚本
│   ├── content.css
│   ├── popup.html
│   ├── popup.js
│   ├── options.html
│   ├── options.js
│   ├── capsule-create.html
│   ├── modules/
│   │   ├── attention.js         # 注意力追踪
│   │   ├── clipper.js           # 剪藏功能
│   │   ├── capsule-bridge.js    # 胶囊桥接
│   │   └── sync.js              # 同步管理
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon32.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   ├── vite.config.js
│   ├── package.json
│   └── scripts/
│       └── patch-manifest.js
│
├── desktop/                   # 桌面端 (Tauri - 第三阶段)
│   └── src-tauri/
│
├── docker-compose.yml         # Docker 编排
├── Makefile                   # 常用命令
├── README.md                  # 项目说明
└── LICENSE
```

---

## 快速启动命令

```bash
# 1. 克隆项目后，一键启动全部服务
make dev          # 启动前端 + 后端 + 插件热更新

# 2. 手动启动
# 前端
cd frontend && npm run dev

# 后端
cd backend && uvicorn app.main:app --reload --port 8000

# 插件 (开发模式)
cd browser-extension && npm run dev

# 3. 构建
cd frontend && npm run build
cd backend && docker build -t psb-backend .
cd browser-extension && npm run build

# 4. 部署
docker-compose up -d
```

---

## 风险评估与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| Ollama 本地模型性能不足 | 中 | 高 | 准备云端模型降级方案，优先实现路由层 |
| SQLite 大数据量性能下降 | 低 | 中 | 预设 PostgreSQL 迁移路径，当前加索引优化 |
| 浏览器插件 Manifest V3 限制 | 中 | 中 | 保持 Firefox V2 兼容，使用 declarativeNetRequest |
| 跨域/安全策略冲突 | 中 | 中 | 开发环境配置 CORS，生产环境使用同源部署 |
| 第三方 API 不可用 | 低 | 高 | 本地模型兜底，优雅降级，队列重试 |

---

> **MVP 完成标准：** 用户可以在浏览器中安装插件，剪藏网页内容，这些内容自动进入知识库并触发验证；用户可以创建时间胶囊并在解锁时与过去的自己对话；用户可以启动深度工作模式，插件会拦截干扰网站；用户可以在仪表盘查看注意力使用情况和知识健康度。

> **MVP 后规划：** 认知镜像、涌现工作室、知识图谱可视化、团队协作、移动端 App、桌面端 Tauri 应用。
