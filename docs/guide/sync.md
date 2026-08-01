# 云同步与端到端加密

个人第二大脑的「云同步」功能完全免费：你的笔记、剪藏、知识单元和胶囊可以在多台设备间同步，且**服务器只存储密文**。

## 原理

- 客户端用「同步密码」通过 PBKDF2 派生 AES-GCM 密钥。
- 每次同步把变更打包成 JSON，加密后上传到 MinIO/S3。
- 服务端只保存加密后的 blob、盐值和 IV，**无法读取内容**。
- 其他设备拉取 blob 后用同一密码解密并应用变更。

> ⚠️ **密码不保存**：同步密码不会上传，也不会保存在服务器。如果你忘记密码，云端数据将无法解密。

## 开启同步

1. 进入「设置 → 同步」。
2. 设置一个强壮的同步密码，建议与登录密码不同。
3. 点击「立即上传快照」注册当前设备并上传加密数据。
4. 在另一台设备用同一账号登录，输入相同同步密码，点击「从云端恢复」。

## 自托管时配置对象存储

Docker Compose 已内置 MinIO：

```bash
docker compose up -d
```

默认访问：

- MinIO API：`http://localhost:9000`
- MinIO 控制台：`http://localhost:9001`

默认账号密码在 `docker-compose.yml` 中通过 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 设置。启动时会自动创建 `psb-sync` bucket。

如果使用外部 S3/OSS，在 `.env` 中配置：

```ini
S3_ENDPOINT=https://s3.amazonaws.com
S3_ACCESS_KEY=your-key
S3_SECRET_KEY=your-secret
S3_BUCKET=your-bucket
S3_REGION=ap-east-1
S3_USE_SSL=true
S3_PATH_STYLE=false
```

## 冲突策略

当前版本采用「最后写入优先（last-write-wins）」。未来会加入手动合并界面。

## 限制

- 单个 snapshot 建议不超过 50MB；首次全量同步若过大，请分批导出/导入。
