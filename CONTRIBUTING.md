# Contributing

感谢你对钤记（Qianji）的兴趣！

## 开发环境

```bash
# 后端（Python 3.11+）
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端（Node 20+）
cd frontend && npm install && npm run dev

# 浏览器扩展
cd browser-extension && npm install && npm run build
```

## 提交前自查

- 后端：`cd backend && pytest tests -q` 全绿
- 前端：`cd frontend && npx tsc --noEmit` 无错
- 提交信息：`<type>(<scope>): <摘要>`（feat/fix/docs/chore/refactor/test），中文摘要即可

## 代码约定

- 数据库 schema 唯一来源是 `Base.metadata.create_all` + 手工 FTS5 虚拟表/触发器，**不要引入迁移工具**；新配置一律进 `user.settings` JSON，不加表列
- 检索/图谱语料只读 `status='active'` 的内容；证伪（debunked）知识不进检索与图谱
- 开源版不接任何商业能力（计费/会员/支付/云端绑定）；涉及这些方向的改动请到商业版仓库讨论

## 行为准则

见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可证

贡献即表示同意以 [AGPL-3.0](LICENSE) 发布；商标使用见 [TRADEMARK.md](TRADEMARK.md)。
