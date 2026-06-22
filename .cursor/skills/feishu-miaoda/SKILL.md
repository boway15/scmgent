---
name: feishu-miaoda
description: >-
  飞书妙搭平台开发、迁移与部署指南。Use when working with 飞书妙搭/秒搭/Miaoda,
  importing projects to Feishu, PostgreSQL ORM on Miaoda, fullstack NestJS shell,
  ScmHonoModule, server/hono-app, CLIENT_BASE_PATH, or preparing ZIP export for Miaoda deployment.
---

# 飞书妙搭开发指南

## 官方规范 vs scm-agent（必读）

妙搭 AI 默认指南针对 **平台原生全栈模板**（NestJS Controller + `axiosForBackend`）。**本仓库**走 **Hono 桥接**：本地 ESM 开发 → ZIP 导入 → **`server/hono-app/`** + **ScmHonoModule** 挂到 NestJS 外壳。

| 官方/通用建议 | scm-agent 实际做法 | 说明 |
|----------|-------------------|------|
| 打包排除 `server/`，后端改 NestJS Controller | **保留 Hono**，迁入 `server/hono-app/` | `nest build` 只编 `server/**/*` |
| `axiosForBackend` | `apiFetch()` + `apiUrl()`（`base-path.ts`） | 自动带妙搭 `x-suda-csrf-token` |
| 移除 RequireAuth / 自定义认证 | **保留** RequireAuth + `AUTH_DEV_MODE` | 内测自动 admin |
| 消除 `file:./packages/db` | **根级 `packages/db/` 必须保留** | Hono 运行时依赖 `@scm/db` |
| 禁止 `import.meta.env` | **保留** `import.meta.env.BASE_URL` | 前端子路径必需 |
| 业务在 `source_package/server/` | 仅归档；**生产入口 `server/hono-app/`** | `source_package` 不参与 nest build |

### 仍适用的官方检查项

- 禁止业务数据 `fs` 持久化
- 禁止 `index.html` 外链 CDN
- 避免 `alert()` / `confirm()`（FOB 页少量遗留）
- shadcn/ui、Tailwind `hsl()`（v4 差异见 checklist）

### scm-agent 推荐工作流

```
1. 本地验收 → pnpm zip:miaoda（含 server/hono-app CJS + scm-hono 模块）
2. 妙搭「新建应用」→ 导入 ZIP
3. 等妙搭自动迁移/依赖安装结束 → 运行 miaoda-sync-to-server 覆盖平台改动
4. 构建 server/client → 反 Mock + Hono import 验证 → env → SQL → 发布
5. F12：/api/auth/config 为 JSON（非 HTML），业务接口 200
```

详见 `docs/miaoda-new-app-release.md`、`apps/web/miaoda/hono-app-checklist.md`。

## 成功导入 SOP（必须）

妙搭导入 ZIP 后会自动迁移前端，可能把真实 API 改成 Mock（`api.ts` 返回演示数据、`useAuth` 返回演示用户、`RequireAuth` 直通、`base-path.ts` 移除 CSRF）。**不要保留这些改动**。等自动任务结束、终端回到 prompt 后执行：

```bash
npm install --include=dev
node source_package/scripts/miaoda-sync-to-server.js
npm run build:server
NODE_ENV=production npm run build:client
```

发布前必须验证：

```bash
grep -n '演示用户\|conv-mock\|mock: true\|mockDelay' client/src/lib/api.ts client/src/hooks/useAuth.ts client/src/components/RequireAuth.tsx || echo "OK: no mock runtime"
grep -n 'apiFetch\|x-suda-csrf-token' client/src/lib/base-path.ts
node -e 'import("./dist/server/hono-app/index.js").then(m=>console.log("OK", !!m.default?.fetch)).catch(e=>{console.error(e.stack||e); process.exit(1)})'
```

必须看到 `OK: no mock runtime`、`apiFetch` / `x-suda-csrf-token` 存在、`OK true`。否则不要发布。

## 五大根因（服务不可用）

| # | 根因 | 处理 |
|---|------|------|
| 1 | ScmHonoModule 未注册 / 在 ViewModule 之后 | app.module.ts；顺序 |
| 2 | 模块在 `source_package/`，未编译 | `server/modules/scm-hono/` |
| 3 | 根 `packages/db/` 缺失 | 复制 + `npm install` |
| 4 | `import.meta.url` in CJS | hono-app 用 `__dirname` |
| 5 | Hono 不在 dist | `server/hono-app/` |
| 6 | Hono 入口旧快照 / 子模块 TS 未转译 | 最新 `miaoda-build-hono-app.cjs`，确认 `route/lib/_db .js` |

## 部署决策

```
已有妙搭项目？
├─ 是 → 在线同步 server/hono-app/ + client/ + scm-hono 模块 + app.module 顺序
└─ 否 → pnpm zip:miaoda → 新建应用 → hono-app 迁入 → 配置 → 发布
```

**妙搭限制**：ZIP **仅新建应用时**可导入。

## 导入后的目录结构（目标）

```
client/                              # 前端
server/
  main.ts                            # 禁止修改
  app.module.ts                      # ScmHonoModule 在 ViewModule 之前
  modules/
    view/                            # 平台内置
    scm-hono/scm-hono.module.ts
  hono-app/                          # ★ Hono 业务（nest build 编译）
    index.ts, routes/, middleware/, lib/, ...
packages/db/                         # ★ 根级 @scm/db
drizzle/                             # SQL 控制台
source_package/                      # ZIP 归档，不参与编译
```

## ScmHonoModule（核心）

`server/modules/scm-hono/scm-hono.module.ts`：

1. `dotenv` 加载 `.env`
2. `import('server/hono-app/index.js')`（dist 路径）
3. `getRequestListener(honoApp.fetch)` 挂到 Express

**必须在 ViewModule 之前**，否则 `/api/*` 落入 View HTML fallback。

日志：`SCM Hono mounted from ...` / `Hono entry not found` / `Failed to mount SCM Hono`

模板：`apps/web/miaoda/scm-hono.module.snippet.ts`

## CLIENT_BASE_PATH 四件套

| 层 | 文件 |
|----|------|
| Vite | `vite.config.ts` → `base` |
| Router | `App.tsx` → `basename` |
| 前端 API | `base-path.ts` → `apiUrl()` |
| Hono | `server/hono-app/index.ts` → `basePath()` |

## 404 / 响应诊断

| 响应 | 含义 | 处理 |
|------|------|------|
| **HTML** | View fallback | ScmHonoModule 顺序 |
| NestJS `Cannot GET /api/...` | hono 加载失败 | 构建日志 |
| `{ "message": "Not Found" }` | Hono 已挂载 | 查路由 |
| URL 缺 `/app/app_xxx` | 前端 base | apiUrl / vite |

## 本地 vs 妙搭路径对照

| 本地 | 妙搭 |
|------|------|
| `apps/web/server/index.ts`（ESM） | `server/hono-app/index.ts`（CJS） |
| `apps/web/server/modules/scm-hono.module.ts` | `server/modules/scm-hono/`（更新 candidates） |
| `packages/db/` | 根 `packages/db/` |

## @scm/db 生产注意

`nest build` 不编译 `node_modules` 内 `.ts`。若 `require('@scm/db')` 失败，将 db 核心复制到 `server/hono-app/db/` 改相对引用。

## 环境变量陷阱

| 陷阱 | 正确 |
|------|------|
| `AUTH_DEV_MOD` | `AUTH_DEV_MODE` |
| `SERVE_STATIC=true` | **`false`** |
| 改 env 不发布 | 保存 → 重新发布 |
| 地址栏开 `/api/*` | 应用内 F12 |
| 妙搭自动 Mock API | 跑 `miaoda-sync-to-server.js` 覆盖并做反 Mock 校验 |

## 相关文件

- 规则：`.cursor/rules/miaoda-stack.mdc`
- 清单：`docs/miaoda-import-checklist.md`
- 发布 SOP：`docs/miaoda-new-app-release.md`
- Hono 迁入：`apps/web/miaoda/hono-app-checklist.md`
- 本地 Hono 开发：`apps/web/server/index.ts`
- Seed SQL：`packages/db/scripts/generate-miaoda-seed-sql.ts`
