# 部署清单 — 国内云服务器（Ubuntu 24.04 / 8C8G / 50GB）

> 场景：阿里云/腾讯云国内节点，域名**未备案**。
> 关键约束：未备案域名在国内云上访问 80/443 会被拦截，过渡期用 **IP + 8080** 直连；
> 备案下来后再切 80/443 + HTTPS（见文末「备案后切换」）。

---

## 1. 安全组（云控制台）

| 端口 | 用途 | 说明 |
|---|---|---|
| 22 | SSH | 建议限自己 IP |
| 8080 | Web（过渡期） | 对 0.0.0.0/0 开放 |
| 80/443 | 备案后再开 | 先不开 |

**未备案期间不要把域名解析到这台服务器**（会被拦截，还可能影响后续备案）。

## 2. 装 Docker（Ubuntu 24.04）

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER && newgrp docker
docker version && docker compose version
```

配镜像加速（国内必做）——`/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.net"
  ]
}
```

```bash
sudo systemctl restart docker
```

## 3. 拉代码

```bash
sudo mkdir -p /opt/psb && sudo chown $USER /opt/psb
# 二选一：
git clone <你的仓库地址> /opt/psb
# 或本地打包上传：
# tar czf psb.tar.gz --exclude=node_modules --exclude=.venv --exclude=dist --exclude=release .  （在 E:/个人第二大脑 下）
# scp psb.tar.gz user@服务器IP:/opt/psb/  然后 tar xzf psb.tar.gz -C /opt/psb --strip-components=1
```

## 4. 配置 `backend/.env`（服务器上新建/修改）

```ini
ENV=production
DEBUG=false

# 三个密钥：用 openssl rand -hex 32 各生成一个
SECRET_KEY=
ADMIN_SECRET_KEY=
DATABASE_ENCRYPT_KEY=

# 对外地址（决定虎皮椒回调、邮件链接里的地址）
API_BASE_URL=http://服务器IP:8080
FRONTEND_URL=http://服务器IP:8080
ALLOWED_ORIGINS=http://服务器IP:8080

# 邮箱验证码（注册需要）：SMTP 配置，QQ/163 邮箱用授权码
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=你的邮箱
SMTP_PASSWORD=授权码
SMTP_FROM=你的邮箱

# 虎皮椒（迅虎支付）
XUNHUPAY_APP_ID=201906146088
XUNHUPAY_APP_SECRET=15a90fa214540fb5b09d3131fce0f75e

# 云端模型 Key（按需）
DEEPSEEK_API_KEY=
KIMI_API_KEY=
OPENCODE_API_KEY=
```

注意：虎皮椒回调地址不用手填——`API_BASE_URL` 设好后自动拼出
`http://服务器IP:8080/api/v1/billing/webhook/xunhupay`。
**如果以后把本地 psb.db 拷到服务器**，`system_configs` 表里的 localhost 回调要改，全新库则没这问题。

## 5. 端口过渡调整

`docker-compose.yml` 里 frontend 的端口改成 8080（备案后再改回 80）：

```yaml
  frontend:
    ports:
      - "8080:80"
```

## 6. 启动

```bash
cd /opt/psb
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8080/health        # 应返回 {"status":"ok"}
curl http://127.0.0.1:8080/              # 应返回前端 HTML
```

浏览器访问 `http://服务器IP:8080`，注册第一个账号，登录后台 `/admin`（用 admin 账号体系另建管理员）。

## 7. Ollama（可选，8G 内存跑得动）

```bash
curl -fsSL https://ollama.com/install.sh | bash
ollama pull qwen2.5:0.5b      # ~400MB
# smollm2:135m 可选
```

后端默认连 `http://localhost:11434`，同机即通，无需改配置。

## 8. SQLite 备份（每天一次，留 14 天）

```bash
sudo mkdir -p /opt/psb-backups
cat > /opt/psb/backup.sh <<'EOF'
#!/bin/bash
set -e
TS=$(date +%Y%m%d-%H%M%S)
DEST=/opt/psb-backups/$TS
mkdir -p "$DEST"
docker exec psb-backend-1 python -c "import sqlite3; c=sqlite3.connect('/data/psb.db'); sqlite3.connect('/data/backup-tmp.db').close(); c.backup(sqlite3.connect('/data/backup-tmp.db'))" 2>/dev/null || true
tar czf "$DEST/server-data.tar.gz" -C /opt/psb server-data
find /opt/psb-backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "backup done: $DEST"
EOF
chmod +x /opt/psb/backup.sh
( crontab -l 2>/dev/null; echo "17 3 * * * /opt/psb/backup.sh >> /var/log/psb-backup.log 2>&1" ) | crontab -
```

数据全在 `/opt/psb/server-data/`，整目录拷走就是全量备份。

## 9. 备案后切换

1. 域名 A 记录解析到服务器 IP；
2. `docker-compose.yml` 端口改回 `"80:80"`；
3. 用 `nginx/ssl.conf` + certbot 签证书（参考 `docker-compose.prod.yml` 的 certbot 服务），或先 `apt install certbot python3-certbot-nginx -y && certbot --nginx` 一把梭；
4. `backend/.env` 把 `API_BASE_URL` / `FRONTEND_URL` / `ALLOWED_ORIGINS` 改成 `https://域名`，`docker compose up -d` 重启；
5. 虎皮椒后台把回调域名也换 https（回调地址由 `API_BASE_URL` 自动拼接，改 env 即可）。

## 常见坑

- **502 Bad Gateway**：后端没起来，`docker compose logs backend --tail 50`；多半是密钥没配（production 会校验三个 KEY 必须改）
- **注册收不到验证码**：SMTP 没配或授权码错；也可临时在日志里看验证码（`logs/app.log`）
- **支付成功没到账**：查回调可达性 `curl http://服务器IP:8080/api/v1/billing/webhook/xunhupay -X POST`（应 400 而不是超时）
- **镜像拉不动**：确认第 2 步加速器已重启 docker
