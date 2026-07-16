# Day 15-21 开发计划

## 阶段 1：后端 - 图谱数据完善
1. `backend/app/models/base.py` — GraphEdge 添加 `weight`，User 添加 `active_brain`
2. `backend/app/api/v1/endpoints/graph.py` — 添加 auto-link、stats、delete auto edges
3. `backend/app/api/v1/endpoints/notes.py` — 笔记创建/更新时自动创建关联边
4. `backend/app/api/v1/endpoints/knowledge.py` — 知识创建/验证时自动创建边
5. `backend/app/api/v1/endpoints/clips.py` — 剪藏创建时自动创建边

## 阶段 2：后端 - 双脑融合搜索 & 双脑感知
6. `backend/app/api/v1/endpoints/brain.py` — 完善 fusion-search、添加 search/suggestions、状态持久化、stats
7. `backend/app/schemas/brain.py` — 扩展 schema（SearchSuggestions、BrainStats）
8. `backend/app/main.py` — 启动时检查并添加 `active_brain` 列

## 阶段 3：前端 - 知识图谱可视化
9. `frontend/src/pages/graph/GraphPage.tsx` — D3.js 力导向图重写

## 阶段 4：前端 - 双脑融合搜索 & 双脑感知优化
10. `frontend/src/pages/search/SearchPage.tsx` — 新建搜索页面
11. `frontend/src/App.tsx` — 添加 `/search` 路由
12. `frontend/src/components/navigation/TopNavigation.tsx` — 搜索跳转 `/search`
13. `frontend/src/components/brain/BrainSwitcher.tsx` — 动画优化
14. `frontend/src/components/navigation/Sidebar.tsx` — 双脑感知
15. `frontend/src/components/navigation/ChatInputBar.tsx` — 双脑感知优化
16. `frontend/src/api/brain.ts` — 扩展 API 调用
17. `frontend/src/hooks/useBrain.ts` — 扩展 hooks
18. `frontend/src/types/index.ts` — 扩展类型

## 验证
- 后端：`python -c "import app.main; print('ok')"`
- 前端：`tsc --noEmit`
