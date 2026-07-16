# API 文档

## 概述

Base URL: `http://localhost:8000/api/v1`
Admin Base URL: `http://localhost:8000/api/admin`

认证方式：Bearer Token（JWT），在请求头中携带 `Authorization: Bearer <token>`

---

## 认证 (Auth)

### POST /auth/register
- **描述**: 用户注册
- **请求**: `{ "email": "user@example.com", "password": "Pass1234", "name": "User" }`
- **响应**: `TokenResponse { access_token, token_type, expires_in }`
- **认证**: 无

### POST /auth/login
- **描述**: 用户登录
- **请求**: `{ "email": "user@example.com", "password": "Pass1234" }`
- **响应**: `TokenResponse`
- **认证**: 无

### POST /auth/refresh
- **描述**: 刷新访问令牌
- **请求**: 在 Authorization 头中携带旧 token
- **响应**: `TokenResponse`
- **认证**: Bearer

### POST /auth/logout
- **描述**: 用户登出（客户端丢弃 token）
- **响应**: `{ success: true }`
- **认证**: Bearer

### POST /auth/change-password
- **描述**: 修改密码
- **请求**: `{ "current_password": "...", "new_password": "..." }`
- **响应**: `{ success: true }`
- **认证**: Bearer

---

## 用户 (Users)

### GET /users/me
- **描述**: 获取当前用户信息
- **响应**: `UserResponse`
- **认证**: Bearer

### PATCH /users/me
- **描述**: 更新用户信息
- **请求**: `UserUpdate { name?, avatar?, display_name?, username? }`
- **响应**: 更新后的用户信息
- **认证**: Bearer

### GET /users/me/settings
- **描述**: 获取用户设置
- **响应**: 设置 JSON 对象
- **认证**: Bearer

### PUT /users/me/settings
- **描述**: 更新用户设置
- **请求**: `SettingsUpdate`
- **响应**: 更新后的设置
- **认证**: Bearer

### POST /users/me/avatar
- **描述**: 上传头像
- **请求**: multipart/form-data (file)
- **响应**: `{ avatar_url, filename }`
- **认证**: Bearer

### DELETE /users/me/account
- **描述**: 删除账户（软删除）
- **请求**: `{ password: "...", confirmation: "删除我的账户" }`
- **响应**: `{ success: true }`
- **认证**: Bearer

---

## 笔记 (Notes)

### GET /notes
- **描述**: 列出当前用户的笔记
- **查询参数**: `q` (搜索), `tag_ids` (标签筛选), `brain_side`
- **响应**: `NoteResponse[]`
- **认证**: Bearer

### POST /notes
- **描述**: 创建笔记
- **请求**: `NoteCreate { title, content, brain_side?, tags? }`
- **响应**: `NoteResponse`
- **认证**: Bearer

### GET /notes/{id}
- **描述**: 获取笔记详情
- **响应**: `NoteResponse`
- **认证**: Bearer

### PATCH /notes/{id}
- **描述**: 更新笔记
- **请求**: `NoteUpdate`
- **响应**: `NoteResponse`
- **认证**: Bearer

### DELETE /notes/{id}
- **描述**: 删除笔记
- **响应**: 204 No Content
- **认证**: Bearer

---

## 剪藏 (Clips)

### GET /clips
- **描述**: 列出浏览器剪藏
- **响应**: `ClipResponse[]`
- **认证**: Bearer

### POST /clips
- **描述**: 创建剪藏
- **请求**: `ClipCreate { title, url, domain, excerpt?, full_text? }`
- **响应**: `ClipResponse`
- **认证**: Bearer

---

## 知识库 (Knowledge)

### GET /knowledge
- **描述**: 列出知识单元
- **响应**: `KnowledgeUnitResponse[]`
- **认证**: Bearer

### POST /knowledge
- **描述**: 创建知识单元
- **请求**: `KnowledgeUnitCreate`
- **响应**: `KnowledgeUnitResponse`
- **认证**: Bearer

### POST /knowledge/{id}/verify
- **描述**: 触发知识验证
- **响应**: `VerificationResponse`
- **认证**: Bearer

### GET /knowledge/{id}/source
- **描述**: 获取知识来源信息
- **响应**: `SourceInfoResponse`
- **认证**: Bearer

### GET /knowledge/domain/{domain}
- **描述**: 获取域名可信度
- **响应**: `DomainCredibilityResponse`
- **认证**: Bearer

---

## 时间胶囊 (Capsules)

### GET /capsules
- **描述**: 列出胶囊
- **响应**: `CapsuleResponse[]`
- **认证**: Bearer

### POST /capsules
- **描述**: 创建胶囊
- **请求**: `CapsuleCreate`
- **响应**: `CapsuleResponse`
- **认证**: Bearer

### GET /capsules/{id}
- **描述**: 获取胶囊详情
- **响应**: `CapsuleResponse`
- **认证**: Bearer

### POST /capsules/{id}/unlock
- **描述**: 尝试解锁胶囊
- **响应**: 解锁结果
- **认证**: Bearer

### POST /capsules/{id}/dialogue
- **描述**: 与胶囊对话
- **请求**: `{ message: "..." }`
- **响应**: 对话流（SSE）
- **认证**: Bearer

---

## LLM 服务

### GET /llm/health
- **描述**: LLM 服务健康检查
- **响应**: `HealthStatusResponse`
- **认证**: Bearer

### POST /llm/chat
- **描述**: 流式对话
- **请求**: `ChatRequest { message, history?, brain_side?, sensitivity? }`
- **响应**: SSE 文本流
- **认证**: Bearer

### POST /llm/summarize
- **描述**: 文本摘要
- **请求**: `SummarizeRequest { text, length? }`
- **响应**: `SummarizeResponse`
- **认证**: Bearer

### POST /llm/extract-tags
- **描述**: 提取标签
- **请求**: `ExtractTagsRequest { text, max_tags? }`
- **响应**: `ExtractTagsResponse`
- **认证**: Bearer

### POST /llm/embed
- **描述**: 文本嵌入
- **请求**: `EmbedRequest { text, store?, content_type? }`
- **响应**: `EmbedResponse`
- **认证**: Bearer

### POST /llm/route-test
- **描述**: 测试模型路由
- **请求**: `RouteTestRequest`
- **响应**: `RouteTestResponse`
- **认证**: Bearer

---

## 双脑 (Brain)

### GET /brain/status
- **描述**: 获取当前大脑状态
- **响应**: `BrainStatus`
- **认证**: Bearer

### POST /brain/switch
- **描述**: 切换活跃大脑
- **请求**: `BrainSwitchRequest { target_brain }`
- **响应**: 切换结果
- **认证**: Bearer

### GET /brain/search
- **描述**: 融合搜索
- **查询参数**: `q`, `brain_side?`, `limit?`
- **响应**: `FusionSearchResponse`
- **认证**: Bearer

### POST /brain/search
- **描述**: 融合搜索（POST 方式）
- **请求**: `FusionSearchRequest`
- **响应**: `FusionSearchResponse`
- **认证**: Bearer

### GET /brain/stats
- **描述**: 双脑统计
- **响应**: `BrainStatsResponse`
- **认证**: Bearer

### GET /brain/cross-links
- **描述**: 跨脑链接
- **响应**: `CrossBrainGraph`
- **认证**: Bearer

---

## 注意力 (Attention)

### GET /attention/activities
- **描述**: 获取活动记录
- **响应**: 活动列表
- **认证**: Bearer

### POST /attention/activities
- **描述**: 记录活动
- **认证**: Bearer

### GET /attention/categories
- **描述**: 获取分类
- **响应**: 分类列表
- **认证**: Bearer

### GET /attention/deep-work
- **描述**: 深度工作会话列表
- **响应**: 会话列表
- **认证**: Bearer

### POST /attention/deep-work
- **描述**: 开始深度工作
- **认证**: Bearer

---

## 知识图谱 (Graph)

### GET /graph
- **描述**: 获取图数据
- **响应**: 节点和边列表
- **认证**: Bearer

### POST /graph/edges
- **描述**: 创建边
- **认证**: Bearer

---

## 管理后台 (Admin)

### POST /api/admin/auth/login
- **描述**: 管理员登录
- **响应**: 管理员 token

### GET /api/admin/dashboard
- **描述**: 仪表盘数据
- **认证**: Admin Bearer

### GET /api/admin/users
- **描述**: 用户列表
- **认证**: Admin Bearer

### GET /api/admin/content
- **描述**: 内容管理
- **认证**: Admin Bearer

### GET /api/admin/system
- **描述**: 系统配置
- **认证**: Admin Bearer

### GET /api/admin/logs
- **描述**: 审计日志
- **认证**: Admin Bearer

---

## 健康检查

### GET /
- **描述**: 根端点
- **响应**: `{ message, version }`
- **认证**: 无

### GET /health
- **描述**: 健康检查
- **响应**: `{ status: "ok", timestamp }`
- **认证**: 无

### GET /metrics
- **描述**: Prometheus 指标
- **响应**: Prometheus 文本格式
- **认证**: 无（或基础认证）
