# 本地服务器版发布 SOP

> **适用**：scm-agent 运行在 Win11 专用服务器，公网经 Cloudflare Tunnel 访问。  
> **不再同步妙搭**：日常只维护本 SOP，无需 `pnpm zip:miaoda`。  
> **首次安装**：见 [dedicated-host-server-checklist.md](./dedicated-host-server-checklist.md)

---

## 环境常量（请按实际填写并内网保存）

| 项 | 当前值 |
|----|--------|
| 服务器路径 | `D:\projects\scm-agent` |
| Git 仓库 | https://github.com/boway15/scmgent.git |
| 公网地址 | https://scm.al6s.cn |
| 本机地址 | http://localhost:8081 |
| Docker 项目名 | `scm-agent`（`-p scm-agent`） |
| 公网配置 | `docker-compose.public.yml`（不进 Git） |
| Tunnel 配置 | `C:\Users\5N7D2B3\.cloudflared\config.yml` |

---

## 架构一览

```text
开发机改代码 → git push
       ↓
专用服务器 git pull → docker compose build/up
       ↓
localhost:8081 ← cloudflared ← https://scm.al6s.cn
```

---

## 一、日常发布（标准流程）

### 1. 开发机：合并并推送

```powershell
# 开发机
cd d:\Docker\project\scm-agent
git status
git pull
# 自测通过后
git push origin main
```

### 2. 服务器：拉代码并重建

```powershell
cd D:\projects\scm-agent
git pull
docker compose -p scm-agent -f docker-compose.yml -f docker-compose.public.yml up -d --build
```

> 仅改 `docker-compose.public.yml` 环境变量、未改代码时，用 `--force-recreate web` 代替 `--build`（见第三节）。

### 3. 冒烟验收（发布必做）

在**服务器**执行：

```powershell
docker compose -p scm-agent ps
curl.exe -s http://localhost:8081/api/health
curl.exe -s https://scm.al6s.cn/api/health
```

浏览器：

- [ ] https://scm.al6s.cn 首页正常
- [ ] 登录 / 菜单可加载
- [ ] 本次改动涉及的核心页面可操作

**通过标准**：两条 `/api/health` 均返回 JSON，且 `db` 正常；公网与 localhost 行为一致。

---

## 二、仅改配置（无代码变更）

编辑 `docker-compose.public.yml` 后：

```powershell
cd D:\projects\scm-agent
docker compose -p scm-agent -f docker-compose.yml -f docker-compose.public.yml up -d --force-recreate web
curl.exe -s http://localhost:8081/api/health
```

常见变量：

| 变量 | 说明 |
|------|------|
| `APP_BASE_URL` | 必须与公网域名一致，如 `https://scm.al6s.cn` |
| `AUTH_REQUIRE_LOGIN` | `"true"` 必须登录 |
| `EMAIL_AUTH_ENABLED` | `"true"` 邮箱注册/登录 |
| `FEISHU_AUTH_ENABLED` | `"true"` + `FEISHU_APP_ID/SECRET` 启用飞书登录 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 首次 seed 为 `admin@scm.local` 设密码 |
| `JWT_SECRET` / `CRON_SECRET` | 生产强随机，勿用默认值 |

---

## 三、数据库迁移

容器 **entrypoint 会自动 migrate**（`docker compose up` / rebuild web 时触发）。

若菜单缺失或需补 seed（老库）：

```powershell
cd D:\projects\scm-agent
docker compose -p scm-agent exec web sh -c "cd /app/packages/db && pnpm exec drizzle-kit migrate"
docker compose -p scm-agent exec web sh -c "cd /app/packages/db && pnpm exec tsx src/seed.ts"
docker compose -p scm-agent restart web
```

---

## 四、回滚

### 4.1 代码回滚（推荐）

```powershell
cd D:\projects\scm-agent
git log --oneline -5
git checkout <上一个稳定 commit>
docker compose -p scm-agent -f docker-compose.yml -f docker-compose.public.yml up -d --build
curl.exe -s https://scm.al6s.cn/api/health
```

确认稳定后，开发机修复再发新版；必要时 `git checkout main` 继续开发。

### 4.2 仅重启（未改代码/镜像）

```powershell
docker compose -p scm-agent restart web
```

### 4.3 数据库回滚

发布前若有备份（见第五节），可恢复：

```powershell
docker compose -p scm-agent exec -T postgres psql -U scm -d scm_dev < D:\backup\scm_dev_YYYYMMDD.sql
docker compose -p scm-agent restart web
```

> 恢复会覆盖当前库，**先停写、先备份现库**。

---

## 五、备份

### 5.1 发布前备份（建议每次大版本前）

```powershell
mkdir D:\backup -ErrorAction SilentlyContinue
$date = Get-Date -Format "yyyyMMdd_HHmm"
docker compose -p scm-agent exec -T postgres pg_dump -U scm scm_dev > "D:\backup\scm_dev_$date.sql"
```

### 5.2 需备份的非 Git 文件

| 路径 | 内容 |
|------|------|
| `docker-compose.public.yml` | 域名、密钥 |
| `%USERPROFILE%\.cloudflared\config.yml` | Tunnel |
| `%USERPROFILE%\.cloudflared\*.json` | Tunnel 凭证 |
| `D:\backup\scm_dev_*.sql` | 数据库 |

---

## 六、Cloudflare / Tunnel 运维

### 6.1 查看 Tunnel 服务

```powershell
Get-Service cloudflared
Restart-Service cloudflared
```

### 6.2 改 Tunnel 后

编辑 `config.yml` 后：

```powershell
Restart-Service cloudflared
curl.exe -s https://scm.al6s.cn/api/health
```

### 6.3 公网 502

1. `docker compose -p scm-agent ps` — web 是否 Up  
2. `curl.exe -s http://localhost:8081/api/health` — 本机是否正常  
3. `Get-Service cloudflared` — Tunnel 是否 Running  
4. 确认 `config.yml` 指向 `http://localhost:8081`

---

## 七、常用运维命令

```powershell
cd D:\projects\scm-agent

# 状态
docker compose -p scm-agent ps
docker compose -p scm-agent logs -f web
docker compose -p scm-agent logs --tail 100 web

# 停止（保留数据）
docker compose -p scm-agent down

# 完全重建镜像（依赖/Dockerfile 变更）
docker compose -p scm-agent -f docker-compose.yml -f docker-compose.public.yml build --no-cache web
docker compose -p scm-agent -f docker-compose.yml -f docker-compose.public.yml up -d

# 看资源
docker stats
```

---

## 八、发布检查清单（Copy 使用）

**发布前**

- [ ] 开发机自测通过  
- [ ] 已 `git push` 到远程  
- [ ] （大版本）已备份 `D:\backup\scm_dev_*.sql`  
- [ ] 服务器 Docker Desktop / cloudflared 服务正常  

**发布中**

- [ ] 服务器 `git pull` 无冲突  
- [ ] `docker compose ... up -d --build` 成功  
- [ ] 容器 entrypoint migrate 无报错（见 logs）  

**发布后**

- [ ] http://localhost:8081/api/health OK  
- [ ] https://scm.al6s.cn/api/health OK  
- [ ] 核心页面冒烟通过  
- [ ] （若对外）Cloudflare Access / 飞书登录正常  

---

## 九、故障速查

| 现象 | 处理 |
|------|------|
| 页面旧 | `--build` + 浏览器 Ctrl+F5 |
| 502 公网 | 本机 8081 → Docker；Tunnel 服务 |
| API 混用 localhost | 检查 `APP_BASE_URL`，`--force-recreate web` |
| 菜单空 / 403 | migrate/seed（第三节） |
| Docker 引擎挂 | 打开 Docker Desktop；`wsl -l -v` |
| 重启后不可用 | 自动登录 + Docker 自启 + cloudflared 服务 |
| 磁盘满 | `docker system prune`（慎用 `-a`）；清理旧 backup |

---

## 十、安全提醒

- 公网勿使用 `AUTH_BYPASS_LOGIN=true` 或 `BOOTSTRAP_ADMIN_PASSWORD_FORCE=true`  
- 启用 **Cloudflare Access** 或飞书 OAuth  
- 勿将 `docker-compose.public.yml`、Tunnel 凭证提交 Git  
- Postgres **5432 不要**映射到公网路由器  
- 定期 Windows 更新后检查 Docker + cloudflared 自启  

---

## 十一、与妙搭的关系

| 项 | 本地服务器 | 妙搭（已停用） |
|----|------------|----------------|
| 发布 | git pull + docker compose | zip:miaoda + 导入 |
| API 入口 | Hono 直连 8081 | NestJS + hono-app |
| 文档 | 本文 + z-docker-ops.md | miaoda-import-checklist.md（归档） |

---

## 相关文档

- [dedicated-host-server-checklist.md](./dedicated-host-server-checklist.md) — 首次安装  
- [win11-cloudflare-tunnel-deploy.md](./win11-cloudflare-tunnel-deploy.md) — Tunnel 详解  
- [../z-docker-ops.md](../z-docker-ops.md) — 改代码 / 重建速查  
