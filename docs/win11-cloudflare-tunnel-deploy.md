# Win11 专用机 + Cloudflare Tunnel 公网部署指南

> **场景**：不买云服务器，用一台长期开机的 Win11 专用电脑跑 scm-agent，经 Cloudflare Tunnel 让同事通过已备案域名（如 `scm.al6s.cn`）访问。  
> **不装虚拟机**：Docker 与 cloudflared 均运行在 Win11 宿主机。  
> **全新专用机从零安装与迁移**：见 [dedicated-host-setup-migration.md](./dedicated-host-setup-migration.md)

---

## 一、架构

```text
同事浏览器
    │  HTTPS
    ▼
Cloudflare Edge（自动 HTTPS、可选 Access 门禁）
    │  Cloudflare Tunnel（出站加密，无需公网 IP / 端口映射）
    ▼
Win11 专用机
    ├── cloudflared（Windows 服务，开机自启）
    └── Docker Compose
            ├── postgres:16（仅内网，不暴露公网）
            └── web:8081 → 容器 8080（scm-agent）
```

| 组件 | 作用 |
|------|------|
| **Docker** | 跑 Postgres + Web，与本地开发同一套 `docker-compose.yml` |
| **cloudflared** | 把 `https://scm.al6s.cn` 转发到 `http://localhost:8081` |
| **Cloudflare DNS** | 子域名 CNAME 指向 Tunnel |
| **Cloudflare Access**（推荐） | 邮箱白名单，防止公网裸奔 |

**不需要**：云服务器、公网 IP、路由器端口转发、Win11 虚拟机。

---

## 二、前置条件

| 项 | 要求 |
|----|------|
| 硬件 | 建议 8GB+ 内存、100GB+ 磁盘；有线网络更稳 |
| 系统 | Windows 11（家庭版/专业版均可） |
| 域名 | `al6s.cn` 已在 Cloudflare 添加，Nameserver 已切换 |
| 备案 | `.cn` 域名已完成 ICP 备案（你方已具备） |
| 软件 | Docker Desktop、Git；构建代码时需 Node 20+ / pnpm |
| 账号 | Cloudflare 账号（免费套餐即可） |

---

## 三、Win11 系统准备（一次性）

### 3.1 电源与更新

1. **设置 → 系统 → 电源**：屏幕可关，**睡眠/休眠设为「从不」**（专用机 7×24 在线）。
2. **设置 → 账户**：配置自动登录（无人值守重启后能进桌面；Docker Desktop 依赖用户会话）。
3. **Windows Update**：建议「活跃时段」外更新，或暂停自动重启；更新后检查 Docker / Tunnel 服务是否自启。

### 3.2 安装 Docker Desktop

1. 下载：https://docs.docker.com/desktop/setup/install/windows-install/
2. 安装时勾选 **Use WSL 2 based engine**（推荐）。
3. 若提示启用 WSL：管理员 PowerShell 执行 `wsl --install`，重启。
4. **Docker Desktop → Settings → General**：勾选 **Start Docker Desktop when you log in**。
5. 验证：

```powershell
docker version
docker compose version
```

### 3.3 安装 Git（拉代码）

https://git-scm.com/download/win

### 3.4 （可选）Node.js + pnpm

仅在专用机需要 **改代码并 rebuild 镜像** 时安装：

```powershell
# Node 20 LTS：https://nodejs.org/
npm install -g pnpm
node -v    # >= 20
pnpm -v
```

若专用机只跑现成镜像、不在其上开发，可在开发机 build 后推镜像或拷贝 `scm-agent-web:latest`（进阶，一般直接在专用机 clone + build 即可）。

### 3.5 防火墙

Tunnel 为**出站**连接，通常无需开端口。  
**不要**把 Postgres `5432` 暴露到局域网外；当前 compose 映射 5432 仅供本机维护，路由器侧勿做端口转发。

---

## 四、部署 scm-agent

### 4.1 获取代码

```powershell
# 示例路径，按实际磁盘调整
cd D:\
git clone <你的仓库地址> scm-agent
cd scm-agent
```

若从开发机拷贝：复制整个项目目录，保留 `docker-compose.yml`、`Dockerfile`、`packages/` 等。

### 4.2 公网环境变量

复制示例并按域名修改：

```powershell
copy docker-compose.public.example.yml docker-compose.public.yml
# 编辑 docker-compose.public.yml：
#   APP_BASE_URL → https://scm.al6s.cn
#   JWT_SECRET / CRON_SECRET → 强随机串
#   AUTH_DEV_MODE → 演示 true；正式 false + 飞书
```

**关键变量**（`docker-compose.yml` 中 `web.environment`）：

| 变量 | 公网专用机建议值 |
|------|------------------|
| `APP_BASE_URL` | `https://scm.al6s.cn`（与 Tunnel 子域名一致，**无末尾 /**） |
| `AUTH_DEV_MODE` | 内测演示 `"true"`；对外 `"false"` + 配置飞书 |
| `JWT_SECRET` | 随机 32+ 字符，**勿用默认值** |
| `CRON_SECRET` | 随机字符串 |
| `FEISHU_OAUTH_REDIRECT_URI` | `https://scm.al6s.cn/api/auth/feishu/callback`（启用飞书时） |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书开放平台应用凭证 |

### 4.3 构建并启动

```powershell
cd D:\scm-agent

# 使用公网 override（推荐）
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build

# 或仅本地默认配置（需手动改 docker-compose.yml 里 APP_BASE_URL）
pnpm docker:up
```

### 4.4 本机验证（Tunnel 之前必做）

```powershell
docker compose ps
# web 应显示 0.0.0.0:8081->8080/tcp

curl.exe -s http://localhost:8081/api/health
# 期望 JSON，含 "db":"connected" 或类似

curl.exe -s http://localhost:8081/api/me
# AUTH_DEV_MODE=true 时返回 admin 用户信息
```

浏览器打开 http://localhost:8081，确认页面与菜单正常。

---

## 五、Cloudflare 配置

以下子域名以 **`scm.al6s.cn`** 为例，可换成 `app.al6s.cn` 等。

### 5.1 确认域名在 Cloudflare

1. 登录 https://dash.cloudflare.com
2. 添加站点 `al6s.cn`（若未添加）
3. 按提示把域名注册商的 **Nameserver** 改为 Cloudflare 提供的两个 NS
4. 等待生效（通常几分钟到 48 小时）

### 5.2 安装 cloudflared（Windows）

1. 下载：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. 将 `cloudflared.exe` 放到例如 `C:\Program Files\cloudflared\`，并把该目录加入系统 **PATH**
3. 验证：

```powershell
cloudflared --version
```

### 5.3 登录并创建 Tunnel

```powershell
cloudflared tunnel login
```

浏览器选择域名 **al6s.cn**，授权后在 `%USERPROFILE%\.cloudflared\` 生成 `cert.pem`。

```powershell
cloudflared tunnel create scm-al6s
```

记录输出中的 **Tunnel ID** 与 credentials 文件路径，形如：

`C:\Users\<用户名>\.cloudflared\<TUNNEL-ID>.json`

### 5.4 编写 Tunnel 配置

创建或编辑 `%USERPROFILE%\.cloudflared\config.yml`：

```yaml
tunnel: scm-al6s
credentials-file: C:\Users\<你的用户名>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: scm.al6s.cn
    service: http://localhost:8081
  - service: http_status:404
```

> **注意**：`service` 必须指向宿主机 **8081**（与 `docker-compose.yml` 的 `ports: "8081:8080"` 一致）。

### 5.5 绑定 DNS

```powershell
cloudflared tunnel route dns scm-al6s scm.al6s.cn
```

或在 Cloudflare 控制台：**Zero Trust → Networks → Tunnels → scm-al6s → Public Hostname**，添加：

- Subdomain: `scm`
- Domain: `al6s.cn`
- Service: `HTTP` → `localhost:8081`

### 5.6 手动试跑 Tunnel

```powershell
cloudflared tunnel run scm-al6s
```

保持窗口打开，另开终端或用手机访问：**https://scm.al6s.cn**

期望：页面与 http://localhost:8081 一致；`/api/health` 返回 JSON。

### 5.7 安装为 Windows 服务（长期运行）

**先关闭**上一步手动运行的 `cloudflared` 窗口，再执行：

```powershell
cloudflared service install
cloudflared service start
```

验证服务：

```powershell
Get-Service cloudflared
# Status 应为 Running

# 重启电脑后再次访问 https://scm.al6s.cn
```

卸载服务（如需）：`cloudflared service uninstall`

---

## 六、安全（强烈建议）

当前 Docker 默认 **`AUTH_DEV_MODE=true`**：知道 URL 的任何人以 **超级管理员** 登录。公网部署务必至少做一项：

### 方案 A：Cloudflare Access（推荐，改动最小）

1. Cloudflare 控制台 → **Zero Trust** → **Access → Applications → Add an application**
2. 类型：**Self-hosted**
3. Application domain：`scm.al6s.cn`
4. **Policy**：Allow → Include → 同事 **邮箱** 或 **邮箱域名**（如 `@company.com`）
5. 身份提供商：One-time PIN（邮箱验证码）或 Google/GitHub 等

同事首次访问会先过 Cloudflare 登录页，通过后才到 scm-agent。

### 方案 B：飞书 OAuth（生产向）

1. `docker-compose.public.yml` 中设置：
   - `AUTH_DEV_MODE: "false"`
   - `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
   - `FEISHU_OAUTH_REDIRECT_URI: https://scm.al6s.cn/api/auth/feishu/callback`
2. 飞书开放平台 → 应用 → **重定向 URL** 添加上述 callback
3. 重建 web：`docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --force-recreate web`

### 通用

- 修改 `JWT_SECRET`、`CRON_SECRET` 为强随机值
- 勿将 Postgres 5432 端口转发到公网
- 专用机物理安全：放可信环境，磁盘 BitLocker 可选

---

## 七、日常运维

### 7.1 常用命令

```powershell
cd D:\scm-agent

# 查看状态
docker compose ps
pnpm docker:logs

# 改代码后重新构建
docker compose -f docker-compose.yml -f docker-compose.public.yml build web
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d

# 仅改环境变量
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --force-recreate web

# 停止（保留数据库）
pnpm docker:down

# Tunnel 服务
Get-Service cloudflared
Restart-Service cloudflared
```

### 7.2 数据库备份

```powershell
docker compose exec postgres pg_dump -U scm scm_dev > D:\backup\scm_dev_%date:~0,4%%date:~5,2%%date:~8,2%.sql
```

建议任务计划程序每周自动备份到另一磁盘或 NAS。

### 7.3 更新应用

```powershell
cd D:\scm-agent
git pull
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
```

### 7.4 开机自检清单

| 检查项 | 命令 / 地址 |
|--------|-------------|
| Docker 运行 | 任务栏 Docker 图标正常 |
| 容器 Up | `docker compose ps` |
| 本机 API | http://localhost:8081/api/health |
| Tunnel 服务 | `Get-Service cloudflared` → Running |
| 公网访问 | https://scm.al6s.cn |

---

## 八、验收清单（给同事联调前）

- [ ] https://scm.al6s.cn 打开首页，非 Cloudflare 502
- [ ] https://scm.al6s.cn/api/health 返回 JSON，`db` 正常
- [ ] https://scm.al6s.cn/api/me 行为符合预期（dev 模式或飞书登录）
- [ ] 侧边栏菜单有数据（老库可 `pnpm db:seed` 或 migrate）
- [ ] Cloudflare Access 或飞书登录已启用（若对公网开放）
- [ ] 专用机重启后 5 分钟内公网可访问（Docker + cloudflared 自启）
- [ ] `APP_BASE_URL` 为 `https://scm.al6s.cn`，无 `localhost`

---

## 九、故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| Cloudflare **502** | Docker 未起 / web 挂了 | `docker compose ps`、`pnpm docker:logs` |
| **502** | Tunnel 指错端口 | `config.yml` 应为 `http://localhost:8081` |
| 页面能开，API 失败 / 混用 localhost | `APP_BASE_URL` 未改 | 改 public yml 后 `--force-recreate web` |
| Tunnel 连不上 | credentials 路径错误 | 核对 `config.yml` 中 json 路径 |
| `cloudflared service` 失败 | 手动实例仍在跑 | 关掉手动窗口，重装服务 |
| 飞书登录 redirect 错误 | 回调 URL 不一致 | 飞书后台与 `FEISHU_OAUTH_REDIRECT_URI` 完全一致 |
| 国内访问慢 / 偶发超时 | Cloudflare 免费线路 | 内测可接受；长期可考虑国内 CDN 或云主机 |
| 重启后不可用 | 未自动登录 / Docker 未自启 | 配置自动登录 + Docker「登录时启动」 |
| 菜单空 / 403 | 未 seed | 容器内 migrate/seed 或参考 `z-docker-ops.md` |

**响应诊断**（浏览器 F12 → Network）：

- `/api/auth/config` 返回 **HTML** → 后端未正确挂载（本地 Docker 一般无此问题）
- 返回 **JSON 200** → 正常

---

## 十、与本地开发机的关系

| 机器 | 用途 |
|------|------|
| **开发机** | 改代码、`pnpm dev` 热更新、build 镜像 |
| **Win11 专用机** | 只跑 Docker + Tunnel，给同事稳定访问 |

推荐流程：开发机改完 → push → 专用机 `git pull` + rebuild；或 CI 构建镜像后专用机 `docker pull`（进阶）。

本地 `z-docker-ops.md` 仍适用于开发机；专用机公网部署以本文 + `docker-compose.public.yml` 为准。

---

## 十一、快速命令汇总（复制执行）

```powershell
# === 专用机首次部署 ===
cd D:\scm-agent
copy docker-compose.public.example.yml docker-compose.public.yml
# 编辑 docker-compose.public.yml 中的域名与密钥

docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
curl.exe -s http://localhost:8081/api/health

cloudflared tunnel login
cloudflared tunnel create scm-al6s
# 编辑 %USERPROFILE%\.cloudflared\config.yml（见 5.4）
cloudflared tunnel route dns scm-al6s scm.al6s.cn
cloudflared tunnel run scm-al6s          # 试通后 Ctrl+C
cloudflared service install
cloudflared service start

# === 同事访问 ===
# https://scm.al6s.cn
```

---

## 附录：文件说明

| 文件 | 说明 |
|------|------|
| `docker-compose.yml` | 基础编排，端口 8081，开发/专用机共用 |
| `docker-compose.public.example.yml` | 公网 override 示例，复制为 `docker-compose.public.yml` 后修改 |
| `z-docker-ops.md` | 本地 Docker 日常运维速查 |
| 本文 | Win11 专用机 + Cloudflare Tunnel 完整方案 |
