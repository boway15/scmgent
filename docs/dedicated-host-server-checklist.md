# 服务器本地部署清单（Win11 专用机）

> **适用**：在服务器 `172.16.21.128`（用户 `5N7D2B3`）上**直接**部署，不依赖 SSH / Cursor Remote。  
> **公网域名**：`https://scm.al6s.cn`  
> **日常发布 SOP**： [local-server-release-sop.md](./local-server-release-sop.md)  
> **完整说明**： [dedicated-host-setup-migration.md](./dedicated-host-setup-migration.md)

---

## 部署前准备

- [ ] Cloudflare 已添加域名 `al6s.cn`，NS 已切换
- [ ] Git 仓库地址（或 U 盘拷贝项目）
- [ ] 服务器已插网线、能上网
- [ ] 设置 → 电源 → **睡眠/休眠：从不**
- [ ] Docker Desktop 勾选 **Start when you log in**

---

## 阶段 1：安装基础软件（一次性）

在服务器 PowerShell 逐条执行或按安装包操作。

### 1.1 WSL 2 + Docker

```powershell
wsl --install
# 重启后：
wsl --set-default-version 2
docker version
docker compose version
```

Docker Desktop：https://docs.docker.com/desktop/setup/install/windows-install/

### 1.2 Git

https://git-scm.com/download/win

```powershell
git --version
```

### 1.3 Node 20 + pnpm（build 镜像需要）

https://nodejs.org/ → 安装 LTS

```powershell
node -v
npm install -g pnpm
pnpm -v
```

### 1.4 cloudflared

1. 下载：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. 复制 `cloudflared.exe` 到 `C:\Program Files\cloudflared\`
3. 系统环境变量 **Path** 加入该目录

```powershell
cloudflared --version
```

### 1.5 Cursor（可选，方便 Agent 协助）

https://cursor.com → 安装后在服务器打开项目目录

---

## 阶段 2：获取项目代码

```powershell
cd D:\
git clone <你的仓库URL> scm-agent
cd D:\scm-agent
```

无 Git 时：从开发机拷贝项目到 `D:\scm-agent`（不要拷 `node_modules`）。

---

## 阶段 3：配置公网环境变量

### 3.1 生成密钥

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
# 执行两次，分别作 JWT_SECRET、CRON_SECRET
```

### 3.2 创建 override

```powershell
cd D:\scm-agent
copy docker-compose.public.example.yml docker-compose.public.yml
notepad docker-compose.public.yml
```

**必改项**：

```yaml
APP_BASE_URL: https://scm.al6s.cn
JWT_SECRET: <第1次生成的随机串>
CRON_SECRET: <第2次生成的随机串>
AUTH_REQUIRE_LOGIN: "true"
EMAIL_AUTH_ENABLED: "true"
FEISHU_AUTH_ENABLED: "true"
BOOTSTRAP_ADMIN_PASSWORD: <强密码>
FEISHU_APP_ID: cli_xxxx
FEISHU_APP_SECRET: xxxx
FEISHU_OAUTH_REDIRECT_URI: https://scm.al6s.cn/api/auth/feishu/callback
```

---

## 阶段 4：启动 Docker

```powershell
cd D:\scm-agent
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
```

首次 build 约 5～15 分钟。

### 验证（必须在 Tunnel 之前通过）

```powershell
docker compose ps
curl.exe -s http://localhost:8081/api/health
```

浏览器打开：http://localhost:8081

期望：`/api/health` 返回 JSON，`db` 正常。

---

## 阶段 5：Cloudflare Tunnel

### 5.1 登录并创建 Tunnel

```powershell
cloudflared tunnel login
# 浏览器选 al6s.cn 授权

cloudflared tunnel create scm-al6s
cloudflared tunnel list
# 记下 Tunnel ID
```

### 5.2 写 config.yml

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cloudflared"
notepad "$env:USERPROFILE\.cloudflared\config.yml"
```

内容（**替换用户名和 Tunnel ID**）：

```yaml
tunnel: scm-al6s
credentials-file: C:\Users\5N7D2B3\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: scm.al6s.cn
    service: http://localhost:8081
  - service: http_status:404
```

模板副本：`deploy/dedicated-host/cloudflared.config.example.yml`

### 5.3 绑定 DNS

```powershell
cloudflared tunnel route dns scm-al6s scm.al6s.cn
```

### 5.4 试跑

```powershell
cloudflared tunnel run scm-al6s
```

另开浏览器访问：https://scm.al6s.cn/api/health

### 5.5 安装 Windows 服务（长期运行）

关闭试跑窗口后：

```powershell
cloudflared service install
cloudflared service start
Get-Service cloudflared
```

---

## 阶段 6：安全（公网必做）

系统默认 **必须登录**（`AUTH_REQUIRE_LOGIN=true`）。邮箱注册/登录 + 飞书登录（`FEISHU_AUTH_ENABLED=true`）需在 `docker-compose.public.yml` 配置。

可选叠加 **Cloudflare Access** 作为额外门禁：

### A. Cloudflare Access（推荐叠加）

1. https://one.dash.cloudflare.com → Access → Applications → Add
2. Self-hosted → Domain: `scm.al6s.cn`
3. Policy → Allow → 同事邮箱 / 邮箱域名
4. Identity: One-time PIN

### B. 飞书 OAuth

`docker-compose.public.yml` 示例见 `docker-compose.public.example.yml`，关键项：

```yaml
FEISHU_AUTH_ENABLED: "true"
FEISHU_APP_ID: cli_xxxx
FEISHU_APP_SECRET: xxxx
FEISHU_OAUTH_REDIRECT_URI: https://scm.al6s.cn/api/auth/feishu/callback
```

飞书开放平台添加相同回调 URL，然后：

```powershell
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --force-recreate web
```

---

## 阶段 7：验收

- [ ] http://localhost:8081 正常
- [ ] https://scm.al6s.cn 正常（非 502）
- [ ] https://scm.al6s.cn/api/health → JSON
- [ ] 侧边栏菜单有数据
- [ ] Cloudflare Access 或飞书登录已启用
- [ ] 重启服务器后 5 分钟内公网可访问

```powershell
docker compose ps
Get-Service cloudflared
curl.exe -s https://scm.al6s.cn/api/health
```

---

## 日常运维

```powershell
cd D:\scm-agent

# 查看状态
docker compose ps
docker compose logs -f web

# 拉代码 + 重建
git pull
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build

# 只改环境变量
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --force-recreate web

# 数据库备份
docker compose exec -T postgres pg_dump -U scm scm_dev > D:\backup\scm_dev_%date:~0,4%%date:~5,2%%date:~8,2%.sql
```

---

## 一键命令汇总（复制用）

```powershell
# === 项目 ===
cd D:\scm-agent
copy docker-compose.public.example.yml docker-compose.public.yml
notepad docker-compose.public.yml

docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
curl.exe -s http://localhost:8081/api/health

# === Tunnel ===
cloudflared tunnel login
cloudflared tunnel create scm-al6s
notepad $env:USERPROFILE\.cloudflared\config.yml
cloudflared tunnel route dns scm-al6s scm.al6s.cn
cloudflared tunnel run scm-al6s
cloudflared service install
cloudflared service start

# === 验收 ===
curl.exe -s https://scm.al6s.cn/api/health
```

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 502 | `docker compose ps`；确认 localhost:8081 可访问 |
| build 失败 | `docker compose logs web`；确认 Docker Desktop 在运行 |
| Tunnel 断 | `Get-Service cloudflared`；`Restart-Service cloudflared` |
| 菜单空 | 容器 entrypoint 会自动 seed；老库执行 `pnpm db:seed` 或见 z-docker-ops.md |
