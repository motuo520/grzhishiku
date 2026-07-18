# 快速开始

## 环境要求

- Docker + Docker Compose（推荐）
- 或 Node.js 20+ + Python 3.11+

## Docker 一键启动

```bash
git clone https://github.com/your-org/personal-second-brain.git
cd personal-second-brain
cp backend/.env.example .env
# 编辑 .env：至少设置 SECRET_KEY、ADMIN_SECRET_KEY、DATABASE_ENCRYPT_KEY
docker compose up -d
```

访问：

- 前端：`http://localhost:3000`
- API：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`

## 创建管理员

注册一个普通账号后，将其提升为管理员：

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

### 桌面端

```bash
cd desktop
npm install
npm run dev:embedded
```

打包：

```bash
npm run dist
```

输出在 `desktop/release/`。

### 浏览器扩展

```bash
cd browser-extension
npm install
npm run build
```

在 Chrome 扩展管理页加载 `dist/` 目录。
