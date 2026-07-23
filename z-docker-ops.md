# 本地 Docker 运维速查

项目根目录：`d:\Docker\project\scm-agent`  
访问地址：http://localhost:8081（需邮箱登录，默认超管 `admin@scm.local` / `admin123456`）

### 局域网访问

同网段其他设备可用 **本机局域网 IP** 访问，例如 `http://172.16.5.11:8081`（IP 以 `ipconfig` 中「以太网 / WLAN」的 IPv4 为准）。

| 项 | 说明 |
|----|------|
| 端口 | 宿主机 `8081` → 容器 `8080`，已绑定 `0.0.0.0` |
| 登录 | 邮箱登录可用；`COOKIE_SECURE=false` 已适配 HTTP 局域网 |
| 飞书登录 | 若启用，须把 `APP_BASE_URL` 改为 `http://<本机IP>:8081` 并重建 web 容器 |
| 防火墙 | Win11 需放行入站 TCP 8081（可用 `netsh advfirewall firewall add rule name="scm-agent 8081" dir=in action=allow protocol=TCP localport=8081`） |
| 开发模式 | `pnpm dev` 时 Vite 已 `host: true`，局域网访问 `http://<本机IP>:5173` |

> **本地服务器版发布 SOP（日常更新/回滚/备份）**：见 [docs/local-server-release-sop.md](docs/local-server-release-sop.md)  
> **全新专用机安装与迁移（Win11 + Docker + cloudflared + al6s.cn）**：见 [docs/dedicated-host-setup-migration.md](docs/dedicated-host-setup-migration.md)  
> **服务器本地部署清单（推荐，不依赖 SSH）**：见 [docs/dedicated-host-server-checklist.md](docs/dedicated-host-server-checklist.md)  
> Tunnel 运维详解：[docs/win11-cloudflare-tunnel-deploy.md](docs/win11-cloudflare-tunnel-deploy.md)

> 宿主机端口映射为 `8081:8080`。若本机 8080 已被其他项目占用（如 Dify / mail-guide 的 `8080:80`），scm-agent 会使用 8081，避免冲突。

---

## 登录账号（本地 Docker）

| 项 | 值 |
|----|-----|
| 登录页 | http://localhost:8081/login |
| 注册页 | http://localhost:8081/register |
| 超管邮箱 | `admin@scm.local` |
| 超管密码 | `admin123456`（`BOOTSTRAP_ADMIN_PASSWORD`，仅本地） |
| 飞书登录 | **关闭**（`FEISHU_AUTH_ENABLED=false`） |

新注册用户默认 **待分配** 权限，需超管在「用户管理」分配角色。

线上环境见 [docs/local-server-release-sop.md](docs/local-server-release-sop.md)，启用 `FEISHU_AUTH_ENABLED=true` + 飞书凭证。

---

pnpm db:migrate   # 应用最新迁移
pnpm db:seed      # 补全菜单与演示数据（可选）
pnpm docker:up    # 构建 + 启动（改代码后）
pnpm docker:start # 仅启动，不构建（代码未改时几秒完成）


## 首次启动

```powershell
cd d:\Docker\project\scm-agent
pnpm docker:up
```



```powershell
cd d:\Docker\project\scm-agent
pnpm docker:build   # 或 docker compose build web
pnpm docker:start   # 或 docker compose up -d
```

---

## 改了什么 → 跑什么

| 改了什么 | 改哪里 | 命令 |
|----------|--------|------|
| **前端** | `apps/web/src/**` | `pnpm docker:build` → `pnpm docker:start`，浏览器 **Ctrl+F5** |
| **后端 API** | `apps/web/server/**` | `pnpm docker:build` → `pnpm docker:start` |
| **数据库 Schema** | `packages/db/**` | 先 `pnpm db:generate`（如有新 migration），再 `pnpm db:migrate` 或 `pnpm docker:up`（容器 entrypoint 会自动 migrate） |
| **环境变量** | `docker-compose.yml` → `web.environment` | `docker compose up -d --force-recreate web`（不必 rebuild） |
| **RSSHub** | `docker-compose.yml` → `rsshub` | `docker compose up -d rsshub`；`web` 已注入 `RSSHUB_BASE_URL=http://rsshub:1200`；调试页 http://localhost:1200 |
| **Dockerfile / 依赖** | `Dockerfile`、`package.json` 等 | `pnpm docker:rebuild` |

> Docker 模式**不挂载源码**，改代码后必须重新 build 才会生效。`docker compose restart web` 不会加载新代码。

---

## 分场景命令

### 改前端（页面、样式、组件）

```powershell
# 1. 改 apps/web/src 下文件
# 2. 重新构建并启动（依赖未变时仅 vite build，比旧版快很多）
pnpm docker:build
pnpm docker:start
# 3. 浏览器强制刷新
#    Ctrl + F5  →  http://localhost:8081
```

日常开发想热更新，不用 Docker 全栈：

```powershell
docker compose up -d postgres
pnpm dev
# 访问 http://localhost:5173
```

### 改后端（Hono 路由、业务逻辑）

```powershell
# 1. 改 apps/web/server 下文件
# 2. 重新构建并启动
pnpm docker:build
pnpm docker:start

# 验证 API
curl.exe -s http://localhost:8081/api/me
```

### 改环境变量

编辑 `docker-compose.yml` 里 `web.environment`，例如：

| 变量 | 作用 |
|------|------|
| `AUTH_REQUIRE_LOGIN` | `"true"` 必须登录（默认） |
| `EMAIL_AUTH_ENABLED` | `"true"` 邮箱注册/登录 |
| `FEISHU_AUTH_ENABLED` | 本地 `"false"`；线上 `"true"` + `FEISHU_APP_ID/SECRET` |
| `BOOTSTRAP_ADMIN_PASSWORD` | seed 时为 `admin@scm.local` 设密码 |
| `AUTH_BYPASS_LOGIN` | `"true"` 紧急跳过登录（勿用于生产） |
| `DATABASE_URL` | 数据库连接（一般不用改） |

改完后：

```powershell
docker compose up -d --force-recreate web
```

本地 `pnpm dev` 模式用 `.env`（从 `.env.example` 复制），改完重启 `pnpm dev` 即可，**不用** rebuild Docker。

---

## 常用命令

```powershell
pnpm docker:build   # 仅构建 web 镜像（改代码后用）
pnpm docker:start   # 仅启动，不构建（秒级）
pnpm docker:up      # build + start 一条龙
pnpm docker:down    # 停止（数据库保留）
pnpm docker:logs    # 看 web 日志

docker compose ps   # 容器状态
docker compose down -v   # 清空数据库重来（慎用）
```

与 mail-guide 同类用法：

```powershell
pnpm docker:build
pnpm docker:start
```

---

## 出问题时

| 现象 | 处理 |
|------|------|
| 页面还是旧的 | `pnpm docker:build && pnpm docker:start` + 浏览器 Ctrl+F5 |
| 8081 打不开 / 端口冲突 | `docker compose ps` 看 web 是否 `0.0.0.0:8081->8080`；若只有 `8080/tcp` 说明宿主机 8080/8081 被占，改 `docker-compose.yml` 的 `ports` 或停掉占用容器 |
| 启动失败 | `pnpm docker:logs` 看迁移/Seed 是否报错 |
| `pnpm db:migrate` ECONNREFUSED | 先 `docker compose up -d postgres`（需映射 5432）；或直接用 `pnpm docker:up` 让容器内自动 migrate |
| 经营看板/合规页 403 或空白 | 老库缺菜单：执行 `pnpm db:migrate`（0009）或 `pnpm db:seed`；然后 `pnpm docker:start` + Ctrl+F5 |
| 角色管理与菜单配置重复 | 已合并为「角色与菜单」；`/system/menus` 自动跳转到 `/system/roles` |
| 依赖/Docker 异常 | `docker compose build --no-cache web` → `docker compose up -d web` |
