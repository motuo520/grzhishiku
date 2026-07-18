# 贡献指南

感谢你愿意为「个人第二大脑」贡献力量！

## 开发流程

1. Fork 仓库。
2. 从 `main` 创建功能分支：`git checkout -b feat/short-description`
3. 提交改动，遵循 [Conventional Commits](https://www.conventionalcommits.org/)。
4. 推送分支并创建 Pull Request。

## 提交规范

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具链 |

## 代码规范

- 后端：PEP 8，使用 `black` / `ruff`。
- 前端：ESLint + TypeScript 严格模式。
- 新功能请尽量附带测试。

## 报告问题

提交 Issue 前请先搜索是否已存在。Bug 报告请包含：

- 复现步骤
- 期望行为与实际行为
- 运行环境（OS、Python/Node 版本、浏览器）
- 相关日志或截图

## 安全漏洞

请不要公开提交安全 Issue，请发邮件至 security@grzhishiku.com。
