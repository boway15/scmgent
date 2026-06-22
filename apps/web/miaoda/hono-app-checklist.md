# 妙搭 Hono 挂载 · 导入后检查清单

> `pnpm zip:miaoda` 已预生成 `server/hono-app/`（CJS）与 `server/modules/scm-hono/`。  
> 导入后执行 **`node source_package/scripts/miaoda-sync-to-server.js`** 自动同步到平台编译树（替代手工复制 1–3 步）。

## 五大根因（「服务不可用」时按序排查）

| # | 根因 | 现象 | 处理 |
|---|------|------|------|
| 1 | `ScmHonoModule` 未注册 / 未同步 | `/api/*` 返回 **HTML**（View fallback） | 跑 `miaoda-sync-to-server.js` + `ScmHonoModule` 在 ViewModule **之前** |
| 2 | 模块不在 `tsconfig` 编译范围 | 构建无 `SCM Hono mounted` | 模块放 `server/modules/scm-hono/`，非 `source_package/` |
| 3 | 根级 `packages/db/` 不存在 | `Failed to mount`；`@scm/db` 解析失败 | ZIP 已含根 `packages/db/` + hono-app `_db/` 内嵌 |
| 4 | `import.meta.url` ESM/CJS 冲突 | 日志 `import.meta is not defined` | hono-app 入口删 `import.meta`，用 `__dirname` |
| 5 | Hono 入口不在 `dist/` | `Hono entry not found` | 业务代码在 `server/hono-app/`，非 `source_package/server/` |

---

## 目标目录结构（妙搭导入后）

```
server/                              ← nest build 编译此树
├── main.ts                          ← 禁止修改
├── app.module.ts                    ← 注册 ScmHonoModule（ViewModule 之前）
├── modules/
│   ├── view/                        ← 平台内置，禁止修改
│   └── scm-hono/
│       ├── scm-hono.module.ts
│       ├── scm-hono-proxy.middleware.ts
│       ├── scm-hono-app.service.ts
│       └── scm-hono-bridge.ts
└── hono-app/                        ← Hono 业务（从 apps/web/server/ 迁入）
    ├── index.ts
    ├── routes/
    ├── middleware/
    ├── lib/
    ├── integrations/
    └── tasks/

packages/db/                         ← 根级，package.json: file:./packages/db
client/                              ← 前端（平台映射自 ZIP src/）
drizzle/                             ← SQL 控制台执行
source_package/                      ← ZIP 归档参考，不参与 nest build
```

---

## 一次性改动清单

| # | 改动 | 方式 |
|---|------|------|
| 1–5 | hono-app + scm-hono + db + app.module | **`node source_package/scripts/miaoda-sync-to-server.js`** |
| 6 | `npm install` / 构建 | 同步后重新构建 |
| 7 | `miaoda-init-all.sql` | SQL 控制台 |
| 8 | 环境变量 + 发布 | 见 `MIAODA-SETUP.md` |

手工复制仅当无法跑脚本时：见 `MIAODA-SETUP.md` 或 `app-module.snippet.txt`。

---

## 404 / 响应格式排障

| 响应 | 来源 | 含义 |
|------|------|------|
| **HTML**（index.html） | ViewController fallback | Hono 未先于 View 注册 |
| `{ "statusCode": 404, "message": "Cannot GET /api/..." }` | NestJS | 模块已注册但 hono 入口加载失败 |
| `{ "message": "Not Found" }` | Hono | 已挂载，路由未匹配 |
| `{ "message": "Unauthorized" }` | Hono auth | 内测设 `AUTH_DEV_MODE=true` 并重新发布；或完成飞书 OAuth |
| **403** `csrf token not found` | 妙搭 CSRF | `fetch-api.ts` 带 `x-suda-csrf-token` |
| 200 JSON `{"feishuEnabled":...,"devMode":...}` | 正常 | 可继续测 `/api/me` |

---

## ScmHonoModule 入口 candidates（目标）

生产从 `dist/server/main.js` 启动，入口应解析到：

- `dist/server/hono-app/index.js`（优先）
- 或 `server/hono-app/index.js`（开发 watch）

**不要**再依赖 `source_package/server/index.ts` 作为生产入口。

---

## @scm/db 生产编译注意

`zip:miaoda` 已将 `packages/db/src` 嵌入 **`server/hono-app/_db/`**，并将 hono-app 内 `@scm/db` import 改为相对路径，由 nest build 一并编译。

根级 `packages/db/` 仍保留（`file:` 依赖、SQL 工具）。若运行时仍报 `@scm/db` 错误，查 hono-app 是否含 `_db/` 目录。

---

## 禁止修改

| 文件 | 原因 |
|------|------|
| `server/main.ts` | 平台入口 |
| `server/modules/view/*` | 平台 SPA 渲染 |
| `scripts/build.sh`、`scripts/run.sh` | 平台构建/启动 |

---

构建日志关键字：

| 日志 | 含义 |
|------|------|
| `CLIENT_BASE_PATH=/app/app_xxx` | 子路径已注入（勿手改） |
| `SCM Hono mounted (fetch bridge)` | 成功（fetch 桥接，404 非 API 会 next） |
| `Hono entry not found` | hono-app 不在 `server/hono-app/` |
| `Failed to mount SCM Hono` | import 崩溃 |

**勿用** `getRequestListener` 直接 `use()`：Hono 404 会阻断 Express 链，SPA 无法落到 ViewModule。须用 `scm-hono-express-bridge.ts`。

---

## 与本地开发的对应关系

| 本地（`pnpm dev`） | 妙搭生产 |
|--------------------|----------|
| `apps/web/server/index.ts` | `server/hono-app/index.ts`（CJS 副本） |
| `apps/web/server/modules/scm-hono.module.ts` | `server/modules/scm-hono/scm-hono.module.ts`（更新 candidates） |
| `packages/db/`（monorepo） | 根 `packages/db/` |
| ESM：`.js` 后缀、`import.meta.url` | CJS：无 `.js` 后缀、用 `__dirname` |

本地改业务逻辑后，同步到妙搭时需同时更新 `server/hono-app/` 并做 CJS 适配。
