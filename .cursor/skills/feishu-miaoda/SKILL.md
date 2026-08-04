---
name: feishu-miaoda
description: >-
  【已归档】飞书妙搭 ZIP/CJS 历史指南。默认不要使用。
  Only use when the user explicitly asks about 飞书妙搭/秒搭/Miaoda, ZIP import,
  ScmHonoModule, server/hono-app, or miaoda CJS export. For normal development
  and Docker deploy, use docs/local-server-release-sop.md instead.
---

# 飞书妙搭开发指南（已归档）

> **状态：已停用（2026-07-24）**  
> 本仓库**不再以妙搭为部署目标**。默认开发 / 发布：  
> - 代码：`apps/web/server`（ESM）+ `apps/web/src`  
> - 运维：`docs/local-server-release-sop.md`、`docs/dedicated-host-server-checklist.md`  
> - 决策：`docs/superpowers/specs/2026-07-24-de-miaoda-docs-baseline-design.md`  
>  
> **仅当用户明确要求妙搭相关操作时**，再继续阅读下文。否则请停止并改用自建 Docker 路径。

---

## 官方规范 vs scm-agent（历史）

妙搭 AI 默认指南针对 **平台原生全栈模板**（NestJS Controller + `axiosForBackend`）。**本仓库历史方案**走 **Hono 桥接**：本地 ESM 开发 → ZIP 导入 → **`server/hono-app/`** + **ScmHonoModule** 挂到 NestJS 外壳。

| 官方/通用建议 | scm-agent 实际做法 | 说明 |
|----------|-------------------|------|
| 打包排除 `server/`，后端改 NestJS Controller | **保留 Hono**，迁入 `server/hono-app/` | `nest build` 只编 `server/**/*` |
| `axiosForBackend` | `apiFetch()` + `apiUrl()`（`base-path.ts`） | 自动带妙搭 `x-suda-csrf-token` |
| 移除 RequireAuth / 自定义认证 | **保留** RequireAuth + `AUTH_DEV_MODE` | 内测自动 admin |
| 消除 `file:./packages/db` | **根级 `packages/db/` 必须保留** | Hono 运行时依赖 `@scm/db` |
| 禁止 `import.meta.env` | **保留** `import.meta.env.BASE_URL` | 前端子路径必需 |
| 业务在 `source_package/server/` | 仅归档；**生产入口 `server/hono-app/`** | `source_package` 不参与 nest build |

### 仍适用的检查项（若被迫走妙搭）

- 禁止业务数据 `fs` 持久化
- 禁止 `index.html` 外链 CDN
- 避免 `alert()` / `confirm()`（FOB 页少量遗留）
- shadcn/ui、Tailwind `hsl()`（v4 差异见 checklist）

### 历史工作流（勿作默认）

```
1. 本地验收 → pnpm zip:miaoda（含 server/hono-app CJS + scm-hono 模块）
2. 妙搭「新建应用」→ 导入 ZIP
3. 等妙搭自动迁移/依赖安装结束 → 运行 miaoda-sync-to-server 覆盖平台改动
4. 构建 server/client → 反 Mock + Hono import 验证 → env → SQL → 发布
5. F12：/api/auth/config 为 JSON（非 HTML），业务接口 200
```

详见 `docs/miaoda-new-app-release.md`、`apps/web/miaoda/hono-app-checklist.md`。

## 成功导入 SOP（历史）

妙搭导入 ZIP 后会自动迁移前端，可能把真实 API 改成 Mock。等自动任务结束、终端回到 prompt 后执行：

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

## 五大根因（服务不可用）

| # | 根因 | 处理 |
|---|------|------|
| 1 | ScmHonoModule 未注册 / 在 ViewModule 之后 | app.module.ts；顺序 |
| 2 | 模块在 `source_package/`，未编译 | `server/modules/scm-hono/` |
| 3 | 根 `packages/db/` 缺失 | 复制 + `npm install` |
| 4 | `import.meta.url` in CJS | hono-app 用 `__dirname` |
| 5 | Hono 不在 dist | `server/hono-app/` |
| 6 | Hono 入口旧快照 / 子模块 TS 未转译 | 最新 `miaoda-build-hono-app.cjs`，确认 `route/lib/_db .js` |

## 相关文件

- 规则（已归档）：`.cursor/rules/miaoda-stack.mdc`
- 清单（已归档）：`docs/miaoda-import-checklist.md`
- 发布 SOP（已归档）：`docs/miaoda-new-app-release.md`
- Hono 迁入（已归档）：`apps/web/miaoda/hono-app-checklist.md`
- **自建默认路径**：`docs/local-server-release-sop.md`、`apps/web/server/index.ts`
