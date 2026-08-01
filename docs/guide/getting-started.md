# 快速开始

## 环境要求

- Docker + Docker Compose（推荐）
- 或 Node.js 20+ + Python 3.11+

## Docker 一键启动

```bash
git clone https://github.com/motuo520/grzhishiku.git
cd personal-second-brain
docker compose up -d
```

首次启动会自动拉取 Ollama 模型 `qwen2.5:0.5b` 与 `nomic-embed-text`（需联网），模型就绪后后端才开始服务。

访问：

- 前端：`http://localhost`
- API：由前端 nginx 以 `/api/` 前缀代理到后端
- API 文档：在 `docker-compose.yml` 中放开 backend 的 `8000:8000` 端口映射后访问 `http://localhost:8000/docs`

## 创建管理员

注册一个普通账号后，将其提升为管理员：

```bash
docker compose exec backend python -m scripts.create_admin user@example.com
```

本地开发环境则使用：

```bash
cd backend
./.venv/bin/python -m scripts.create_admin user@example.com
```

Windows：

```bash
.venv\Scripts\python.exe -m scripts.create_admin user@example.com
```

## 本地开发

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。

> **界面版本**：应用默认进入「简化版」（只保留"存进来 / 自动理好 / 一句话问出来"三个动作）。点顶栏主题按钮旁的版本图标，或在「设置 → 外观 → 界面版本」里可切换到「经典版」（完整 12 个模块）。两种模式共用同一套数据，选择会被记住，随时可切回。

### 浏览器扩展

```bash
cd browser-extension
npm install
npm run build
```

在 Chrome 扩展管理页加载 `dist/` 目录。
