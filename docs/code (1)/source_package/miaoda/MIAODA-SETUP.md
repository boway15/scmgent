# scm-agent 妙搭新建应用 · 快速配置（约 10–15 分钟）

> **新建应用 → 导入 ZIP → 运行一次同步脚本 → 环境变量 → SQL → 发布**

## 架构说明（只读）

妙搭导入后 ZIP 内容在 `source_package/`，平台 `nest build` 只编译根级 `server/**/*`。  
`pnpm zip:miaoda` 已打好 `server/hono-app`、`scm-hono` 模块等，**同步脚本**会自动复制到平台编译树并 patch `app.module.ts`。

---

## 第 1 步：导入并等待构建

1. 妙搭 → **新建应用** → 导入 `scm-agent-miaoda.zip`
2. 等待首次构建（约 3–10 分钟）

---

## 第 2 步：一键同步（替代原手工复制 1–3 步）

在妙搭 **终端** 或 **构建前命令** 执行 **一次**：

```bash
node source_package/scripts/miaoda-sync-to-server.js
```

脚本会自动：

| 操作 | 源 → 目标 |
|------|-----------|
| 复制 Hono 业务 | `source_package/server/hono-app/` → `server/hono-app/` |
| 复制挂载模块 | `source_package/server/modules/scm-hono/` → `server/modules/scm-hono/` |
| 复制数据库包 | `source_package/packages/db/` → `packages/db/` |
| 注册模块 | patch `server/app.module.ts`（`ScmHonoModule` 在 `ViewModule` 前） |
| 后续构建 | 尝试向平台 `package.json` 写入 `prebuild`（之后每次构建自动同步） |

然后 **重新构建** → 日志应出现：

```
CLIENT_BASE_PATH=/app/app_xxx
SCM Hono loaded from .../server/hono-app/index.js
```

> **首次导入后必做**：ZIP 的 `prebuild` 写在 `source_package/package.json`，平台构建未必执行。请**手动跑一次同步脚本再构建**。

---

## 第 3 步：环境变量

| 变量 | 内测推荐值 |
|------|------------|
| `SERVE_STATIC` | `false` |
| `AUTH_DEV_MODE` | `true` |
| `ENFORCE_RBAC` | `true` |
| `APP_BASE_URL` | `https://你的域名/app/app_xxx` |
| `JWT_SECRET` | 随机长字符串 |
| `CRON_SECRET` | 随机长字符串 |

`CLIENT_BASE_PATH`、`DATABASE_URL`、`MIAODA_*` **不要改**。

> **401 Unauthorized**：请求已进 Hono，但飞书 OAuth 已启用且未登录。内测务必设 **`AUTH_DEV_MODE=true`**（完整拼写，非 `AUTH_DEV_MOD`），保存后重新发布。妙搭可能自带 `FEISHU_APP_ID`，不设 dev 模式会走飞书鉴权。

**保存 → 发布**。

---

## 第 4 步：数据库

SQL 控制台 → 粘贴 `source_package/drizzle/miaoda-init-all.sql` → 运行。

---

## 验收（应用内 F12）

| 请求 | 期望 |
|------|------|
| `/api/auth/config` | 200 JSON，`devMode: true` |
| `/api/me` | `admin@scm.local` |
| `/api/health` | `db: connected` |

> 若 Response 为 `Forbidden: csrf token not found in header`，需在 `base-path.ts` 使用 `apiFetch`（自动带 `x-suda-csrf-token`）。

---

## 正式环境（可选）

`AUTH_DEV_MODE=false` + 飞书 `FEISHU_*` 环境变量。

详细清单：`docs/miaoda-import-checklist.md`。
