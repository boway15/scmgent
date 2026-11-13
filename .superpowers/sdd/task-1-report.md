# Task 1 报告：月版本列表服务端分页 + createdByName

## Status: DONE

## 变更摘要

### `apps/web/server/lib/forecast-version.ts`

1. **`ForecastVersionListItem`** 增加 `createdByName: string | null`。
2. **`toVersionListItem`**：映射 `createdByName: version.createdByName ?? null`；入参改为窄行类型 `ForecastVersionListRow`（兼容全表行与分页 select）。
3. **新增 `listForecastVersionsPage`**：
   - `parseListPagination` 处理 `page` / `pageSize`（默认 1 / 20，上限 100）。
   - 可选 `status`、`q`（`versionNo` / `versionName` / `station` `ilike`）。
   - `leftJoin(users)` → `createdByName: users.name`。
   - 并行 count + 分页列表；`orderBy(createdAt desc)`。
   - `includeStats === false` 时跳过 `loadVersionStatsMap`，items 使用 `emptyVersionStats()`。
   - 返回 `{ items, total, page, pageSize }`。
4. **保留** `listForecastVersions`、`listForecastVersionsWithStats`（其它路径仍可用；列表项亦带 `createdByName: null`）。
5. **`getForecastVersionWithStats`** 未 join 用户，列表项 `createdByName` 为 `null`（符合 brief）。

### `apps/web/server/routes/sales-forecast.ts`

- `GET /sales-forecast-versions` 改调 `listForecastVersionsPage`，响应为分页 JSON（非裸数组）。
- 查询参数：`status`、`q`、`page`、`pageSize`、`includeStats`（`=== '1'`）、`statsScope`（`full` | 默认 `list`）。
- 移除路由层对 `listForecastVersions` / `listForecastVersionsWithStats` 的引用；改为导入 `listForecastVersionsPage`、`ForecastVersionStatus`。

## 类型检查

命令：`pnpm --filter @scm/web exec tsc -p tsconfig.node.json --noEmit`

- **与本任务相关**：`forecast-version.ts` 分页/toVersionListItem 相关错误已清零。
- **仓库既有**：全量 `tsc` 仍有大量历史错误（含 `sales-forecast.ts` 下载中心等未提交改动、`forecast-version.ts` L818 `getOrCreateDraftVersion({ station })` 等），非本任务引入。

## 前端破坏（Task 3/4 处理）

| 调用方 | 问题 |
|--------|------|
| `api.getSalesForecastVersions` | 仍期望 `ForecastVersionListItem[]` / `ForecastVersionBasic[]`，未传 `page`/`pageSize`，未读 `items` |
| `SalesForecastListPage` | 本地 filter/slice；需改真分页 |
| `ForecastStrategySection` | `getSalesForecastVersions({ status: 'draft' })` 需读 `items` |
| `SalesForecastVersionDetailPage` | `status: 'published'` 需分页参数 + `items` |

## 自检

- [x] 无 DB migration
- [x] 未 git commit / stage
- [x] 未改动无关 download-center 逻辑（仅替换版本列表 GET 块与 forecast-version 库函数）
- [x] `includeStats=false` 不跑 stats 聚合
- [x] stats 仅当前页 version ids（`includeStats=true` 时）

## Commits

无（按用户要求）
