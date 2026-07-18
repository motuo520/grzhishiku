# 模型配置

## 本地模型（Ollama）

默认使用 Ollama 运行本地模型，无需联网即可对话。

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

## 云模型

在 `.env` 中填写对应厂商 API Key 即可启用：

```ini
DEEPSEEK_API_KEY=your-deepseek-key
KIMI_API_KEY=your-kimi-key
OPENCODE_API_KEY=your-opencode-key
```

当前支持的厂商：

| 厂商 | 用途 |
|------|------|
| DeepSeek | 通用对话 |
| Kimi | 长文本 / 代码 |
| OpenCode | GLM、MiMo、MiniMax、Qwen 等聚合接口 |

## 切换模型

管理员可在 **LLM 控制台** 选择默认模型。选择后所有端口（Web、桌面端、API）会自动同步。

## 计费

云模型按实际 token 消耗计费；本地模型免费。管理员可在后台调整用户额度与等级。
