# 依赖许可证清单 / Dependency License Report

> 口径（2026-10-01 刷新）：本清单覆盖开源精简版 `backend/requirements.txt` 的**直接依赖**（30 项），
> 许可证为各项目官方声明的标准 License。传递依赖（transitive）请以实际安装环境重新生成：
> `pip-licenses --format=markdown --with-urls`。
>
> 历史版本曾混入主仓商业版环境的依赖（alipay-sdk / stripe / wechatpayv3 / pyinstaller 等），
> 开源精简版不含这些包，已从清单移除。

## 合规摘要

本项目核心采用 **AGPL-3.0** 许可证。经审查，当前后端直接依赖全部使用与 AGPL-3.0 兼容的许可证：

- MIT / BSD / ISC / 0BSD / The Unlicense
- Apache-2.0
- PSF-2.0（Python 标准库相关）

如果你添加新的依赖，请重新审查许可证兼容性。

## 直接依赖列表（backend/requirements.txt）

| Name | License | 用途 |
|------|---------|------|
| fastapi | MIT | Web 框架 |
| starlette | BSD-3-Clause | ASGI 基础（FastAPI 依赖） |
| uvicorn | BSD-3-Clause | ASGI 服务器 |
| sqlalchemy | MIT | ORM |
| alembic | MIT | 迁移工具（保留兼容；当前 schema 以 create_all 为准） |
| pydantic | MIT | 数据校验 |
| pydantic-settings | MIT | 配置管理 |
| email-validator | The Unlicense | 邮箱校验 |
| python-jose | MIT | JWT |
| cryptography | Apache-2.0 OR BSD-3-Clause | 加密（胶囊正文/同步） |
| bcrypt | Apache-2.0 | 密码哈希 |
| python-multipart | Apache-2.0 | 文件上传 |
| httpx | BSD-3-Clause | HTTP 客户端（Ollama/RSS 抓取） |
| python-dotenv | BSD-3-Clause | .env 加载 |
| prometheus-client | Apache-2.0 | /metrics 指标 |
| psutil | BSD-3-Clause | 系统监控 |
| mcp | MIT | MCP 服务器（可选，默认关） |
| bleach | Apache-2.0 | XSS 输入清洗 |
| markupsafe | BSD-3-Clause | 模板安全 |
| pypdf | BSD-3-Clause | PDF 文本提取 |
| python-docx | MIT | DOCX 文本提取 |
| openpyxl | MIT | XLSX 文本提取 |
| python-pptx | MIT | PPTX 文本提取 |
| readability-lxml | Apache-2.0 | 网页正文提取 |
| requests | Apache-2.0 | HTTP（同步/插件） |
| lxml | BSD-3-Clause | HTML/XML 解析 |
| apscheduler | MIT | 定时任务（RSS 刷新等） |
| graphifyy | MIT | 知识图谱构建引擎 |
| boto3 | Apache-2.0 | S3/MinIO 对象存储（同步快照） |
| openai | Apache-2.0 | Ollama OpenAI 兼容端点客户端 |

## 开发/测试依赖

`backend/requirements-dev.txt`（如存在）与测试链（pytest 等）为 MIT/Apache-2.0，不影响分发合规。

## 前端依赖

前端 `frontend/package.json` 依赖（React/vite/tailwind 等）均为 MIT/Apache-2.0 系，
以 `npm ls` 输出为准。
