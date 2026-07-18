# 自托管部署

## 最小配置

复制示例环境文件并修改：

```bash
cp backend/.env.example .env
```

生产环境必须设置：

```ini
ENV=production
SECRET_KEY=<随机字符串，至少 32 字节>
ADMIN_SECRET_KEY=<另一组随机字符串>
DATABASE_ENCRYPT_KEY=<数据库加密密钥>
```

可以使用以下命令生成密钥：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Docker Compose

```bash
docker compose -f docker-compose.prod.yml up -d
```

## 反向代理与 SSL

推荐使用 Nginx 或 Traefik 反代，并申请 Let's Encrypt 证书。

示例 Nginx 配置：

```nginx
server {
    listen 443 ssl http2;
    server_name grzhishiku.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 备份

默认使用 SQLite，定期备份以下目录即可：

- `backend/psb.db`
- `backend/chroma_db/`
- 用户上传文件目录（若配置）

## 更新

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
