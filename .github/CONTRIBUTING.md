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

## 贡献者许可 / Contributor License Agreement

向本仓库提交 Pull Request 即表示你同意：

- 你拥有提交内容的全部版权，或已获得合法授权；
- 你授予项目维护者永久的、全球范围的、免版税的、不可撤销的版权与专利许可，允许维护者在当前项目（包括开源版及未来可能推出的商业版/双许可版）中使用、修改、分发你的贡献；
- 你的贡献将按本仓库的 AGPL-3.0 协议向社区发布；
- 你的贡献不侵犯任何第三方的知识产权或其他合法权益。

建议每次提交使用 `git commit -s` 进行签名（DCO），即表示你确认上述条款。

---

By submitting a Pull Request, you agree that:

- You own or have sufficient rights to the content you submit;
- You grant the project maintainers a perpetual, worldwide, royalty-free, irrevocable copyright and patent license to use, modify, and distribute your contribution in this project, including any future commercial or dual-licensed versions;
- Your contribution will be released to the community under the AGPL-3.0 license used by this repository;
- Your contribution does not infringe any third-party intellectual property or other legal rights.

We encourage you to sign off your commits with `git commit -s` (DCO).

## 安全漏洞

请不要公开提交安全 Issue，请发邮件至 security@grzhishiku.com。
