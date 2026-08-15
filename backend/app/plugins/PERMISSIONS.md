# 插件权限声明（Permissions）

插件在其 `manifest.json` 中通过 `permissions` 字段声明自己会用到的能力。
这是**权限边界声明**，不是沙箱：项目口径是「防君子不防小人」（本地优先 + AGPL），
插件代码与后端同进程执行，超声明能力**不做运行时拦截**；
声明的价值在于可读可查——安装/启用/列表接口都会带出该清单，前端可展示给用户决策。

## 枚举口径

| 权限 | 含义 |
| --- | --- |
| `files.read` | 读本地文件 |
| `files.write` | 写本地文件 |
| `network.outbound` | 发起出站网络请求（调第三方 API 等） |
| `llm.call` | 调用 LLM（会产生 token 消耗） |
| `storage.read` | 读应用数据（知识库 / 笔记 / 标签等） |
| `storage.write` | 写应用数据（创建知识单元 / 笔记等） |
| `mcp.expose` | 通过 MCP 向外部 AI Agent 暴露工具 |

## 约定

- `manifest.json` 里写 `"permissions": ["network.outbound", "storage.write"]` 这样的数组。
- 未声明 `permissions` 字段时按空集合处理，并在服务端日志给出警告（建议补声明）。
- 声明了不在上表中的权限字符串**不会被拒绝**（前向兼容：新版本权限在旧后端上仍可安装），
  但会在 manifest 校验时警告日志。
- 插件作者应按实际用到的能力如实声明；声明即对用户的承诺，超声明能力虽不被拦截，
  但属于违反约定的行为（防君子口径）。
