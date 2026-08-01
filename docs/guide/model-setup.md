# 模型配置

开源精简版仅支持 **Ollama 本地模型**，无需联网、无需任何 API Key，数据不出本机。

## Docker 部署（默认）

`docker compose up -d` 会自动完成全部模型配置，无需手动操作：

- 启动 `ollama` 服务（模型持久化在 `ollama-data` volume）
- 首次启动时自动拉取所需模型：
  - `qwen2.5:0.5b` — 对话 / 摘要 / 标签
  - `nomic-embed-text` — 向量化 / 语义搜索
- 模型拉取完成后后端才开始服务

如需更换模型，在 `docker-compose.yml` 中修改 `OLLAMA_MODEL` / `OLLAMA_EMBED_MODEL`，
并同步修改 `ollama-init` 服务中 `ollama pull` 的模型名。

## 本地开发（不使用 Docker）

### 安装 Ollama

访问 [ollama.com](https://ollama.com) 下载并安装。

### 拉取模型

```bash
ollama pull qwen2.5:0.5b
ollama pull nomic-embed-text
```

### 配置环境变量

```ini
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:0.5b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

## 切换模型

管理员可在 **LLM 控制台** 选择默认模型（仅限本地已拉取的 Ollama 模型）。
选择后 Web 与 API 端口会自动同步。本地模型完全免费，无任何计费环节。
