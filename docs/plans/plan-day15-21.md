# Day 15-21 开发计划：双脑融合搜索 + 图谱完善 + 双脑感知优化

## 阶段 1：后端 - 图谱数据完善
- 修改 `backend/app/models/base.py`：给 User 添加 `active_brain`；给 GraphEdge 添加 `weight` 字段（或复用 `strength`）
- 修改 `backend/app/api/v1/endpoints/graph.py`：添加 auto-link 端点、stats 端点、delete auto edges 端点；修改 nodes/edges 返回 weight
- 修改 `backend/app/api/v1/endpoints/notes.py`：在 create/update 时自动创建边（引用剪藏、标签相同、内容相似）
- 修改 `backend/app/api/v1/endpoints/knowledge.py`：在 add/verify 时自动创建边（支持笔记、反驳知识）
- 修改 `backend/app/api/v1/endpoints/clips.py`：在 create 时自动创建边（同源知识）
- 修改 `backend/app/main.py`：启动时检查并添加 `active_brain` 列到 users 表

## 阶段 2：后端 - 双脑融合搜索 + 状态持久化
- 修改 `backend/app/api/v1/endpoints/brain.py`：
  - `switch_brain` 持久化到数据库
  - `status` 从数据库读取 `active_brain`
  - 添加 `stats` 端点
  - 完善 `fusion-search`：混合 FTS5 + 语义搜索
  - 添加 `search/suggestions` 端点
- 修改 `backend/app/schemas/brain.py`：添加新的 schema 定义

## 阶段 3：前端 - 知识图谱可视化
- 重写 `frontend/src/pages/graph/GraphPage.tsx`：D3 力导向图、节点交互、控制栏、统计面板
- 修改 `frontend/src/api/graph.ts`：添加 graph API 调用（如果不存在则新建）

## 阶段 4：前端 - 全局搜索页
- 新建 `frontend/src/pages/search/SearchPage.tsx`
- 修改 `frontend/src/App.tsx`：添加 `/search` 路由
- 修改 `frontend/src/layouts/AppLayout.tsx` 或 `TopNavigation.tsx`：搜索框跳转
- 修改 `frontend/src/api/brain.ts`：添加搜索/suggestions接口

## 阶段 5：前端 - 双脑感知优化
- 修改 `frontend/src/components/brain/BrainSwitcher.tsx`：动画过渡
- 修改 `frontend/src/components/navigation/Sidebar.tsx`：双脑感知菜单、顶部徽章、底部统计
- 修改 `frontend/src/components/navigation/ChatInputBar.tsx`：左侧 brain 徽章、brain_side 参数

## 阶段 6：验证
- 后端：`cd backend && python -c "import app.main; print('ok')"`
- 前端：`cd frontend && tsc --noEmit`
