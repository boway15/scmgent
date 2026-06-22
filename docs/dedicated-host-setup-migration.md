# 专用机从零安装与迁移指南（Win11 + Docker + Cloudflare Tunnel）

> **适用**：一台**全新、干净**的 Win11 专用电脑，安装 scm-agent 并对外提供 `https://scm.al6s.cn`（域名示例，可替换）。  
> **包含**：系统准备、代码迁移、数据库策略、Docker 公网配置、**cloudflared 完整配置**、验收与安全。  
> **详细 Tunnel 运维**：见 [win11-cloudflare-tunnel-deploy.md](./win11-cloudflare-tunnel-deploy.md)

---

## 总览：你要完成什么

```text
阶段 0  新电脑系统与安全基线
阶段 1  安装 Docker / Git /（可选）Node+pnpm
阶段 2  迁移项目代码到专用机
阶段 3  配置公网环境变量并启动 Docker
阶段 4  安装 cloudflared、创建 Tunnel、绑定 scm.al6s.cn
阶段 5  Cloudflare Access 门禁 + 验收
阶段 6  开机自启与备份
```

预计耗时：**首次约 1～2 小时**（含 Docker 首次 build）。

---

## 阶段 0：新电脑系统准备

### 0.1 基础设置

| 步骤 | 操作 |
|------|------|
| 激活 Win11 | 完成 OOBE，创建**专用本地账户**（建议非 Microsoft 个人账户，便于服务自启） |
| 网络 | 有线连接；路由器中为该 PC 分配**固定内网 IP**（方便远程维护） |
| 电源 | **设置 → 系统 → 电源** → 屏幕可关，**睡眠/休眠：从不** |
| 自动登录 | **netplwiz** → 取消「要使用本计算机，用户必须输入用户名和密码」→ 设专用账户自动登录（Docker Desktop 需用户会话） |
| 时区 | 设为中国标准时间，避免日志时间错乱 |

### 0.2 安全基线（新电脑建议）

```powershell
# 管理员 PowerShell：检查 Windows 更新
# 设置 → Windows 更新 → 安装全部重要更新后重启

# 可选：启用 BitLocker（专业版）加密系统盘
# 控制面板 → BitLocker → 启用
```

| 项 | 建议 |
|----|------|
| 远程桌面 | 仅内网需要时开启；**不要**把 3389 端口映射到公网 |
| 第三方杀毒 | 将 `D:\scm-agent`、`%USERPROFILE%\.cloudflared` 加入排除项，避免拖慢 Docker build |
| 防火墙 | 默认即可；Tunnel 为出站，**无需**开端口入站 |
| 账户 | 专用机少用日常浏览；不装无关软件 |

### 0.3 需要准备的账号与信息

在开始前准备好：

| 材料 | 用途 |
|------|------|
| Cloudflare 账号 | 管理 `al6s.cn`、Tunnel、Access |
| 域名 `al6s.cn` 已在 Cloudflare | NS 已指向 Cloudflare |
| Git 仓库地址 + 凭据 | `git clone`（或 U 盘拷贝 zip） |
| （可选）飞书开放平台 App ID/Secret | 正式登录 |
| （可选）旧机数据库备份 | 若要保留旧数据，见阶段 2B |

---

## 阶段 1：安装软件

在**专用机**上以管理员或普通用户打开 **PowerShell**。

### 1.1 安装 WSL 2（Docker 依赖）

```powershell
wsl --install
# 重启电脑
wsl --set-default-version 2
wsl --status
```

### 1.2 安装 Docker Desktop

1. 下载：https://docs.docker.com/desktop/setup/install/windows-install/
2. 安装：勾选 **Use WSL 2 based engine**
3. 打开 Docker Desktop → **Settings → General**：
   - ✅ Start Docker Desktop when you log in
4. 验证：

```powershell
docker version
docker compose version
```

### 1.3 安装 Git

https://git-scm.com/download/win

```powershell
git --version
```

### 1.4 安装 Node.js + pnpm（专用机要自行 build 镜像时需要）

```powershell
# Node 20 LTS：https://nodejs.org/
node -v          # >= v20
npm install -g pnpm
pnpm -v
```

> 若只在开发机 build 好镜像再拷到专用机，可跳过 Node/pnpm（进阶，一般不推荐）。

### 1.5 安装 cloudflared

1. 下载 Windows amd64：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. 创建目录并放入 PATH：

```powershell
New-Item -ItemType Directory -Force -Path "C:\Program Files\cloudflared"
# 将下载的 cloudflared.exe 复制到上述目录

# 系统环境变量 Path 中加入：C:\Program Files\cloudflared
# 新开 PowerShell 验证：
cloudflared --version
```

---

## 阶段 2：迁移项目代码

推荐目录：`D:\scm-agent`（路径不要有中文和空格）。

### 方案 A：Git 克隆（推荐）

在**开发机**先 push 最新代码，再在**专用机**：

```powershell
cd D:\
git clone <你的仓库 URL> scm-agent
cd D:\scm-agent
```

私有仓库需配置凭据（HTTPS token 或 SSH key）。

### 方案 B：U 盘 / 网盘拷贝

在开发机打包（**不要**拷贝 `node_modules`、`.env`、`docker-compose.public.yml`）：

```powershell
# 开发机执行（示例）
cd d:\Docker\project
# 排除大目录后压缩，或用 git archive
git -C scm-agent archive -o scm-agent.zip HEAD
```

专用机解压到 `D:\scm-agent`。

### 方案 C：仅拷贝 Docker 镜像（不拷源码，进阶）

开发机：

```powershell
cd d:\Docker\project\scm-agent
docker compose build web
docker save scm-agent-web:latest -o scm-agent-web.tar
```

专用机：

```powershell
docker load -i scm-agent-web.tar
# 仍需 docker-compose.yml、docker-compose.public.yml 等同目录文件
```

---

## 阶段 2B：数据库迁移（二选一）

### 选项 1：全新库（最简单，推荐首次专用机部署）

专用机首次 `docker compose up` 时，容器 **entrypoint 会自动 migrate + seed**，无需手动操作。

适合：演示环境、可接受重置数据。

### 选项 2：从旧环境迁移业务数据

在**旧机器**（Docker 正在跑、有数据时）：

```powershell
cd d:\Docker\project\scm-agent
docker compose exec -T postgres pg_dump -U scm scm_dev > D:\backup\scm_dev_backup.sql
```

将 `scm_dev_backup.sql` 拷到专用机，然后：

```powershell
cd D:\scm-agent
# 先启动空库
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d postgres
# 等待 healthy 后导入
Get-Content D:\backup\scm_dev_backup.sql | docker compose exec -T postgres psql -U scm -d scm_dev
# 再启动 web
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d web
```

> 导入后无需再跑 seed（除非菜单缺项，见 `z-docker-ops.md` 排错表）。

---

## 阶段 3：配置应用并启动 Docker

### 3.1 生成密钥

专用机 PowerShell：

```powershell
# JWT_SECRET（复制输出，填入 yml）
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))

# CRON_SECRET（再执行一次，得到另一个值）
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### 3.2 创建公网 override

```powershell
cd D:\scm-agent
copy docker-compose.public.example.yml docker-compose.public.yml
notepad docker-compose.public.yml
```

**必须修改**：

```yaml
services:
  web:
    environment:
      APP_BASE_URL: https://scm.al6s.cn
      AUTH_DEV_MODE: "true"          # 内测；对外改 false + 飞书
      JWT_SECRET: <上一步生成的值>
      CRON_SECRET: <上一步生成的值>
```

启用飞书时 additionally：

```yaml
      AUTH_DEV_MODE: "false"
      FEISHU_APP_ID: cli_xxxx
      FEISHU_APP_SECRET: xxxx
      FEISHU_OAUTH_REDIRECT_URI: https://scm.al6s.cn/api/auth/feishu/callback
```

### 3.3 首次构建启动

```powershell
cd D:\scm-agent
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
```

首次 build 可能 5～15 分钟，视网络与 CPU 而定。

### 3.4 本机验证（Tunnel 之前必过）

```powershell
docker compose ps
# web → 0.0.0.0:8081->8080/tcp

curl.exe -s http://localhost:8081/api/health
curl.exe -s http://localhost:8081/api/me
```

浏览器：http://localhost:8081 → 应能进系统（dev 模式自动 admin）。

查看日志：

```powershell
docker compose logs -f web
# 应看到 [entrypoint] migrations / seed / Starting web server
```

---

## 阶段 4：cloudflared 完整配置

以下在**专用机**执行。若 Tunnel 曾在其他电脑创建，建议在专用机**新建 Tunnel**（旧机停用），避免 credentials 泄露或冲突。

### 4.1 登录 Cloudflare

```powershell
cloudflared tunnel login
```

浏览器打开 → 选择 **al6s.cn** → 授权。  
成功后生成：`C:\Users\<你>\.cloudflared\cert.pem`

### 4.2 创建 Tunnel

```powershell
cloudflared tunnel create scm-al6s
```

记录输出，例如：

```text
Created tunnel scm-al6s with id a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

credentials 文件路径：

```text
C:\Users\<你>\.cloudflared\a1b2c3d4-e5f6-7890-abcd-ef1234567890.json
```

查看已有 Tunnel：

```powershell
cloudflared tunnel list
```

### 4.3 编写 config.yml

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cloudflared"
notepad "$env:USERPROFILE\.cloudflared\config.yml"
```

内容（**按实际替换** `<USERNAME>`、`<TUNNEL-ID>`）：

```yaml
tunnel: scm-al6s
credentials-file: C:\Users\<USERNAME>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: scm.al6s.cn
    service: http://localhost:8081
  - service: http_status:404
```

项目内模板副本：`deploy/dedicated-host/cloudflared.config.example.yml`

校验配置：

```powershell
cloudflared tunnel ingress validate
```

### 4.4 绑定 DNS

```powershell
cloudflared tunnel route dns scm-al6s scm.al6s.cn
```

Cloudflare 控制台 **DNS → Records** 应出现：

| 类型 | 名称 | 内容 |
|------|------|------|
| CNAME | scm | `<TUNNEL-ID>.cfargotunnel.com` |

### 4.5 试跑 Tunnel

```powershell
cloudflared tunnel run scm-al6s
```

保持窗口打开，手机或同事电脑访问：**https://scm.al6s.cn**

同时检查：

```powershell
curl.exe -s https://scm.al6s.cn/api/health
```

### 4.6 安装 Windows 服务（长期运行）

**先关闭** 4.5 的手动窗口，再执行：

```powershell
cloudflared service install
cloudflared service start
Get-Service cloudflared
# Status: Running
```

服务读取的配置即为 `%USERPROFILE%\.cloudflared\config.yml`。

> **注意**：`cloudflared service install` 以**当前用户**身份安装；专用账户应使用**自动登录**的同一账户执行，避免重启后服务找不到 credentials。

### 4.7 迁移 Tunnel 时旧机处理

若旧电脑曾跑过同名 Tunnel：

1. 旧机：`cloudflared service stop` → `cloudflared service uninstall`（或删除旧 config）
2. 专用机：按 4.1～4.6 新建；或复制 `.cloudflared\<TUNNEL-ID>.json` + `config.yml` 到专用机**相同路径结构**（需同一 Cloudflare 账号）

**不要**把 `cert.pem` 和 tunnel json 提交到 Git。

---

## 阶段 5：安全与 Cloudflare Access

### 5.1 为什么必须做

默认 `AUTH_DEV_MODE=true` 时，**知道 URL 即超级管理员**。公网务必加一道门禁。

### 5.2 配置 Access（推荐，约 5 分钟）

1. https://one.dash.cloudflare.com → **Access → Applications → Add**
2. **Self-hosted** → Application name: `scm-agent`
3. **Session Duration**: 24h（按需）
4. **Application domain**: `scm.al6s.cn`
5. **Add a policy** → Action: **Allow**
   - Include: **Emails** → 同事邮箱，或 **Emails ending in** → `@yourcompany.com`
6. **Identity providers**: 启用 **One-time PIN**（邮箱验证码）

保存后，同事访问会先看到 Cloudflare 登录页。

### 5.3 飞书 OAuth（与 Access 可叠加）

1. 飞书开放平台 → 应用 → 安全设置 → **重定向 URL**：
   `https://scm.al6s.cn/api/auth/feishu/callback`
2. `docker-compose.public.yml` 设 `AUTH_DEV_MODE: "false"` 并填 `FEISHU_*`
3. 重建：

```powershell
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --force-recreate web
```

---

## 阶段 6：开机自启与备份

### 6.1 自启检查清单

| 组件 | 如何自启 |
|------|----------|
| Docker Desktop | Settings → Start when you log in |
| Windows 用户 | 自动登录（阶段 0） |
| cloudflared | `cloudflared service install`（阶段 4.6） |
| 容器 | `docker-compose.yml` 中 `restart: unless-stopped`（已配置） |

**重启专用机后**（等待 2～3 分钟）验证：

```powershell
docker compose ps
Get-Service cloudflared
curl.exe -s https://scm.al6s.cn/api/health
```

### 6.2 定期备份数据库

```powershell
$date = Get-Date -Format "yyyyMMdd"
docker compose exec -T postgres pg_dump -U scm scm_dev > "D:\backup\scm_dev_$date.sql"
```

建议用 **任务计划程序** 每周执行，备份目录同步到 NAS 或另一台机器。

### 6.3 需要备份的文件（灾难恢复）

| 路径 | 说明 |
|------|------|
| `D:\scm-agent\docker-compose.public.yml` | 含密钥，勿进 Git |
| `%USERPROFILE%\.cloudflared\config.yml` | Tunnel 配置 |
| `%USERPROFILE%\.cloudflared\<TUNNEL-ID>.json` | Tunnel 凭证 |
| `%USERPROFILE%\.cloudflared\cert.pem` | 账号证书 |
| `D:\backup\scm_dev_*.sql` | 数据库 |

---

## 阶段 7：验收清单（交给同事前）

在**专用机**和**同事电脑**各测一遍：

- [ ] https://scm.al6s.cn 可打开（非 502）
- [ ] https://scm.al6s.cn/api/health → JSON，`db` 正常
- [ ] Cloudflare Access 仅允许授权邮箱（若已配置）
- [ ] 菜单、看板、合规等页面无 403 空白
- [ ] 专用机重启后 5 分钟内公网恢复
- [ ] `APP_BASE_URL` 为 `https://scm.al6s.cn`（F12 无 localhost API 请求）
- [ ] Postgres 5432 **未**在路由器做端口转发

---

## 故障速查

| 现象 | 处理 |
|------|------|
| 502 Bad Gateway | `docker compose ps`；`docker compose logs web`；确认 8081 本机可访问 |
| Tunnel 正常、本机 8081 不通 | `docker compose up -d`；看 entrypoint 迁移是否失败 |
| `cloudflared` 服务起不来 | 检查 `config.yml` 路径、credentials json 是否存在；`cloudflared tunnel ingress validate` |
| 服务安装后找不到配置 | 用**自动登录同一用户**执行 `service install` |
| 页面旧 / API 404 | `docker compose ... up -d --build`；浏览器 Ctrl+F5 |
| Access 循环跳转 | Access 应用域名与 `scm.al6s.cn` 完全一致 |
| 飞书 redirect_uri 错误 | 飞书后台 URL 与 `FEISHU_OAUTH_REDIRECT_URI` 字符级一致 |

---

## 一键命令汇总（专用机全新安装）

```powershell
# === 1. 代码 ===
cd D:\
git clone <仓库URL> scm-agent
cd D:\scm-agent

# === 2. 公网配置 ===
copy docker-compose.public.example.yml docker-compose.public.yml
notepad docker-compose.public.yml   # 改 APP_BASE_URL、JWT_SECRET、CRON_SECRET

# === 3. Docker ===
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build
curl.exe -s http://localhost:8081/api/health

# === 4. cloudflared ===
cloudflared tunnel login
cloudflared tunnel create scm-al6s
notepad $env:USERPROFILE\.cloudflared\config.yml   # 见 deploy/dedicated-host/cloudflared.config.example.yml
cloudflared tunnel route dns scm-al6s scm.al6s.cn
cloudflared tunnel run scm-al6s                    # 试通后 Ctrl+C
cloudflared service install
cloudflared service start

# === 5. 公网验证 ===
curl.exe -s https://scm.al6s.cn/api/health
```

---

## 相关文件

| 文件 | 说明 |
|------|------|
| [win11-cloudflare-tunnel-deploy.md](./win11-cloudflare-tunnel-deploy.md) | Tunnel 与运维详解 |
| [../z-docker-ops.md](../z-docker-ops.md) | 日常改代码、重建、排错 |
| [../docker-compose.public.example.yml](../docker-compose.public.example.yml) | 公网环境变量模板 |
| [../deploy/dedicated-host/cloudflared.config.example.yml](../deploy/dedicated-host/cloudflared.config.example.yml) | cloudflared config 模板 |
