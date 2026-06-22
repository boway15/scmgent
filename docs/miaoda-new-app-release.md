# 新版本发布到妙搭（新建应用）

目标：**每个版本用新 ZIP 新建一个妙搭应用，按规范完成 Hono 挂载后即可给同事使用**。

```
本地验收 → pnpm zip:miaoda → 妙搭新建应用导入 → hono-app 迁移 + 注册模块 → env → SQL → 发布
```

预计耗时：**20–40 分钟**（含构建与 hono-app 迁入）。

---

## 一、发布前（本地）

```bash
pnpm install
pnpm db:migrate && pnpm db:seed   # 本地冒烟
pnpm dev                          # 确认 FOB 分账等核心功能
pnpm zip:miaoda                   # 自动生成 seed SQL + 合并 init SQL + ZIP
# 产出: apps/web/scm-agent-miaoda.zip
```

`zip:miaoda` 会自动：

1. `pnpm db:seed:sql` — 更新角色/菜单 seed
2. `pnpm miaoda:init-sql` — 生成 `drizzle/miaoda-init-all.sql`
3. 打包 ZIP，含：
   - **`server/hono-app/`** — 从 `apps/web/server/` 生成 CJS 副本（`miaoda-cjs-transform.js`）
   - **`server/modules/scm-hono/scm-hono.module.ts`**
   - `packages/db/`、`drizzle/`、前端 `src/`、妙搭文档

---

## 二、妙搭侧配置（五步）

ZIP 内附 **`miaoda/MIAODA-SETUP.md`**、**`miaoda/hono-app-checklist.md`** 可作现场速查。

### 步骤 1 · 新建并导入

| 操作 | 说明 |
|------|------|
| 新建应用 | **必须新建**，不能向旧应用重新导入 ZIP |
| 上传 ZIP | `apps/web/scm-agent-miaoda.zip` |
| 等待构建 | 3–10 分钟，确认无构建失败 |

### 步骤 2 · 确认 `server/hono-app/`（P0）

ZIP 已含 **`server/hono-app/`**（CJS）与 **`server/modules/scm-hono/`**。

导入后确认这些路径在平台 **`server/` 编译树**内（参与 `nest build`）。若仅出现在 `source_package/`，按 `hono-app-checklist.md` 复制到 `server/hono-app/` 与根 `packages/db/`，然后 `npm install`。

### 步骤 3 · 注册 ScmHonoModule（P0）

1. 确认 `server/modules/scm-hono/scm-hono.module.ts` 已在平台 `server/` 下（ZIP 已含）
2. 打开 `server/app.module.ts`，按 `miaoda/app-module.snippet.txt`：
   - `ScmHonoModule` 加入 `business-modules`
   - **必须在 `ViewModule` 之前**（否则 `/api/*` 返回 HTML）
3. 重新构建 → 日志 **`SCM Hono mounted from .../hono-app/index.js`**

### 步骤 4 · 环境变量 + 发布

先发布一次或从预览 URL 拿到 `app_id`，再填 `APP_BASE_URL`。

**内测（同事快速试用）**

```env
SERVE_STATIC=false
AUTH_DEV_MODE=true
ENFORCE_RBAC=true
APP_BASE_URL=https://你的域名/app/app_xxxxxxxx
JWT_SECRET=<随机32位以上>
CRON_SECRET=<随机32位以上>
```

| 注意 | |
|------|--|
| `SERVE_STATIC` 必须 **`false`** | NestJS 托管前端 |
| 勿写 `AUTH_DEV_MOD` | 必须 `AUTH_DEV_MODE` |
| 平台变量勿改 | `CLIENT_BASE_PATH`、`DATABASE_URL`、`MIAODA_*` 等 |

**保存 → 重新发布**。

### 步骤 5 · 数据库（空库一次）

数据库 → SQL 执行 → 粘贴 ZIP 内 **`drizzle/miaoda-init-all.sql`** 全文 → 运行。

---

## 三、验收（2 分钟）

1. 打开 `https://域名/app/app_xxx`（不要直接访问 `/api/*`）
2. F12 → Network：
   - `GET .../api/auth/config` → **200 JSON**（非 HTML），`devMode: true`
   - `GET .../api/me` → `admin@scm.local`
   - `GET .../api/health` → `db: connected`
3. 侧边栏有菜单，**FOB 分账**可打开

**若 `/api/auth/config` 响应为 HTML** → ScmHonoModule 未注册或排在 ViewModule 之后。

---

## 四、版本与环境管理建议

| 场景 | 做法 |
|------|------|
| 新版本给同事试用 | **新建应用** + 新 ZIP，旧应用可保留 |
| 内测 URL 变更 | 更新 `APP_BASE_URL` 并重新发布 |
| 生产切飞书登录 | 同应用改 `AUTH_DEV_MODE=false` + FEISHU_* |
| 已有数据的旧应用升级 | **不能** ZIP 覆盖；在线同步 `server/hono-app/` + `client/` |

建议命名：`scm-agent-v0.3-内测`、`scm-agent-v0.3-生产`。

---

## 五、与旧文档关系

| 文档 | 用途 |
|------|------|
| 本文 | **新版本新建应用**（主流程） |
| [miaoda-import-checklist.md](miaoda-import-checklist.md) | 完整验收、飞书 OAuth、Cron、演示 CSV |
| [hono-app-checklist.md](../apps/web/miaoda/hono-app-checklist.md) | Hono 迁入与五大根因 |
| [.cursor/skills/feishu-miaoda/SKILL.md](../.cursor/skills/feishu-miaoda/SKILL.md) | 避坑与架构说明 |

---

## 六、仍无法省略的配置

1. **新建应用** — 无 API 可脚本化
2. **hono-app 迁入 + ScmHonoModule** — 平台 `nest build` 不编译 `source_package/`
3. **app.module.ts 注册顺序** — ScmHonoModule 必须在 ViewModule 之前
4. **6 项环境变量** — 含 `APP_BASE_URL`
5. **SQL 初始化** — 控制台执行 `miaoda-init-all.sql`
