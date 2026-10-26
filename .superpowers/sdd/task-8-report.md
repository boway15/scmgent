# Task 8 Report: 规则中心 API（参数集 CRUD、审批、试算）

## Status

**DONE**

## Commit

- SHA: `285aa6143aa81bc3af5af06e5b5844b83caefc9a`
- Subject: `feat(rules): rule center API with approval and simulation`
- Branch: `feat/rule-modules-p0`
- Staged only the four brief files (not `git add -A`):
  - `apps/web/server/rules/simulate.ts`
  - `apps/web/server/rules/simulate.test.ts`
  - `apps/web/server/routes/rules.ts`
  - `apps/web/server/index.ts`
- 4 files changed, 396 insertions. This report is not in the commit.

## What changed

- `simulate.ts`：`overlayDraft` 用同 scope 的草稿替换生效参数集；`diffSuggestions` 只保留建议量 / 日期 / 灯色有变化、新增或消失的行；`simulateReplenishment` 对最多 50 个 SKU 并行跑两次 `dryRun` 补货试算后做差。
- `routes/rules.ts`：模块列表、参数集列表、解析结果、草稿创建 / 编辑、试算、提交、审批、驳回、从历史恢复。编辑角色 `pmc_planner`（`super_admin` 由 `requireRole` 放行）。`approve` / `reject` 调用 `requireRole(user)`，只放行 `super_admin`。
- `index.ts`：在 `safetyStockRoutes` 的 import 与 `app.route('/api', safetyStockRoutes)` 之后挂载 `ruleRoutes`。
- 未改补货预测、规划页或 schema。`drizzle-orm` 0.30 导出 `max`，未改用 `sql` 回退。

## RED

先只提交 `simulate.test.ts`，再跑测试。实现文件尚不存在。

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/simulate.test.ts
Exit code: 1
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  'D:\Docker\project\scm-agent\apps\web\server\rules\simulate.js'
  imported from ...\simulate.test.ts
✖ server\rules\simulate.test.ts (398.7847ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 410.5036
```

失败原因是测试导入的 `./simulate.js` 不存在，符合预期 RED。

## GREEN

实现 `overlayDraft` / `diffSuggestions` 后再跑同一命令。

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/simulate.test.ts
Exit code: 0
▶ overlayDraft
  ✔ replaces active set of same scope (0.8521ms)
✔ overlayDraft (1.4018ms)
▶ diffSuggestions
  ✔ reports changed, added and removed rows only (0.2866ms)
✔ diffSuggestions (0.3527ms)
ℹ tests 2
ℹ suites 2
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1567.5934
```

## Step 7 smoke

`apps/web/server/index.ts` 监听 `process.env.PORT ?? 3001`。仓库根 `.env` 为 `PORT=3001`。冒烟前 3001 没有监听进程（仅有无关的 30012）。因此自行启动：

```text
AUTH_BYPASS_LOGIN=true
pnpm --filter @scm/web dev:server
```

日志：`Server running on http://0.0.0.0:3001`。`/api/health` 200，`authBypass: true`，`db: connected`。绕过登录后当前用户是 `admin@scm.local`（`super_admin`），创建与审批都能通过。冒烟结束后已结束该进程树，3001 不再监听。

| 请求 | 结果 |
|---|---|
| `GET /api/rules` | 200。`items[0].code` 为 `replenishment`，`version` 1，`scopes` 为 `global` / `project_group` / `warehouse` |
| `POST /api/rules/replenishment/param-sets` body `{"scopeType":"global","params":{"singleCoverDays":45},"note":"冒烟"}` | 201。`id` `66a80f4f-c6f8-4373-84b3-2fc8d8223d2f`，`status` `draft`，`version` 1，`scopeValue` `*`，`params.singleCoverDays` 45 |
| `POST .../66a80f4f-.../simulate` body `{"skuCodes":["100100201"]}` | 200。`{"rows":[],"changed":0,"total":0,"skuCount":1,"maxSkus":50}`。库中 `simulatedAt` 随后为 `2026-10-26T07:26:26.927Z` |
| `POST .../submit` | 200。`status` `pending_approval` |
| `POST .../approve` | 200。`status` `active`，`approvedBy` 与 `createdBy` 同为 `2c7a2f12-9b80-4322-aa00-b6d54a7c0a6d` |
| `GET /api/rules/replenishment/resolved` | 200。`values.singleCoverDays` 为 45；`sources.singleCoverDays` 为 `{ scopeType: "global", scopeValue: "*", paramSetId: "66a80f4f-c6f8-4373-84b3-2fc8d8223d2f" }` |

试算对 SKU `100100201` 两侧都没有 dry 建议行，所以差分为空。提交仍要求并读到了 `simulatedAt`，审批后的解析值来自这套参数集。

## Smoke cleanup

当时表里只有这一行冒烟数据（审批没有归档其他 active 行）。

```text
DELETE FROM rule_param_sets WHERE note = '冒烟';
DELETE 1
leftover_smoke = 0
total_sets = 0
```

确认 `note = '冒烟'` 的行已删除，表中没有残留参数集。

## Typecheck

`tsc -p tsconfig.json` 对这四个文件只有既有 TS6305（`.d.ts` 未构建）。`tsc -p tsconfig.node.json` 的输出里没有 `simulate.ts` 或 `routes/rules.ts` 的错误。`server/index.ts` 原有的 `family === 4` 比较错误仍在，本次只加了 import 与 `app.route`。

## Self-review

- 测试先失败再通过：RED 是模块缺失，GREEN 是 `fail 0`、2 个用例通过。
- `overlayDraft` 去掉同 `scopeType` + `scopeValue` 后追加草稿；`diffSuggestions` 按 `skuCode::warehouseCode` 排序，相同快照跳过，删除行 `after` 为 null，新增行 `before` 为 null。
- 路由路径、角色、状态机与简报一致。审批在事务里把同范围 `active` 归档，再把当前行设为 `active`。
- 冒烟覆盖了列表、创建草稿、试算、提交、审批、解析值 45，并删除了冒烟行。
- 未改补货默认结果的代码路径；试算走 `dryRun: true`，服务日志里这几步都是 2xx，没有写入错误。
