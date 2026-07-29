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

## 平台模型计费开关（自托管必读）

「平台模型计费 / 外部模型控制台」默认**关闭**——这是开源版的预期行为：自托管用户使用本地模型（Ollama）或自带 key（BYOK），界面上不会出现余额、充值、模型市场等计费元素，相关 API（`/api/v1/billing/balance`、`/topup`、`/usage`、`/api/admin/llm/*`）返回 404。

如果你自己运营托管服务、想对终端用户按 token 售卖模型调用，在管理员后台的「系统配置 → feature_flags」中把 `platform_billing_enabled` 置为 `true`（或直接改 `system_configs` 表），然后在 LLM 控制台为模型设置价格即可开启完整计费链路（余额冻结/结算、充值订单、用量记录）。
