# Task 1 报告：补货任务 dry-run 与基线导出

**状态：DONE_WITH_CONCERNS**
**Commit：** `3f0cffa` feat(replenishment): dry-run option and baseline export script（分支 `feat/rule-modules-p0`，tag `rules-p0-baseline`）

## 实现内容

### `apps/web/server/tasks/replenishmentForecast.ts`
- 在 `positionKey` 之后新增导出类型 `ReplenishmentRunOptions`、`ReplenishmentDryRow`、`ReplenishmentHealthDryRow`（与 brief 一致）。
- `runReplenishmentForecast(options: ReplenishmentRunOptions = {})`，`dryRun = options.dryRun === true`：
  1. `syncInventorySupplyLots()` 仅在非 dry-run 执行；
  2. `activeSkus` 查询在 `skuIds` 非空时追加 `inArray(skus.id, options.skuIds)`；
  3. `upsertSafetyStock` → `if (!dryRun)`；
  4. `saveHealthSnapshots` → dry-run 时 `snapshotCount = 0` 不调用；`syncReplenishLightFromHealth` → `if (!dryRun)`；
  5. `shouldEnhance` 增加 `!dryRun`（不调 Dify）；
  6. 在 `pendingSkuIdsToExpire` 之前 dry-run 提前返回 `{ suggestionCount, snapshotCount: 0, results: [], dry: { suggestions, health } }`，因此 `supersedePendingSuggestionsForSkus`、`supersedeAllPendingSuggestionsForSku`、`db.insert(reorderSuggestions)` 均不执行。
- `SkuHealthRow` 字段（`skuCode`/`warehouseCode`/`healthStatus`/`suggestedQty`/`suggestedDate`）与 brief 一致，无需调整映射。
- 非 dry-run 路径行为不变（`git diff` 仅包含上述改动）。

### 写库审计
逐一检查了函数内所有写操作：`upsertSafetyStock`（update/insert safety_stock_config）、`syncInventorySupplyLots`、`saveHealthSnapshots`、`syncReplenishLightFromHealth`、两个 supersede、`insert reorderSuggestions`、Dify 增强——均在 dry-run 下跳过。
循环内调用的只读 helper（`computeSkuWarehouseHealth`、`buildSkuWarehouseTimeline`、`buildSkuNetworkTimeline`、`getRegionPoolSnapshot`、`loadPlanningDemandForSkuWarehouse`、`resolvePreShipmentLeadTimeForSku`、各 `load*` 批量函数）及其传递依赖（`inventory-supply-lot-sync` 中的 `loadOpenLotsForSku` / `buildAllocationBySku` 等）只有 select / `db.execute(SELECT …)` / `SET LOCAL statement_timeout`，无写入。
运行后实测：`reorder_suggestions.max(generated_at)` 与 `safety_stock_config.max(updated_at/last_calc_at)` 仍为 2026-10-19，今天两次 dry-run 未写库。

### `apps/web/scripts/replenishment-baseline.ts`
按 brief 逻辑实现，有以下偏差：
- **`.env` 路径**：脚本位于 `apps/web/scripts/`，仓库根目录是 `resolve(import.meta.dirname, '../../..')`，因此用 `config({ path: resolve(import.meta.dirname, '../../../.env') })`。任务说明中给的 `'../../.env'` 会指向 `apps/.env`，不正确。
- **动态 import**：`@scm/db` 的 `db` 是惰性 Proxy（首次访问才读 `DATABASE_URL`），静态 import 本身也能工作；但为了保证其他模块在 import 时读取的环境变量也能拿到，仍在 `config()` 之后用顶层 `await import()` 加载 `@scm/db` 和 `replenishmentForecast.js`（apps/web 为 `"type": "module"`，支持顶层 await）。
- compare 成功输出为 `与基线一致（用时 Ns）`（仍包含「与基线一致」，额外附上耗时，方便记录）。
- 其余抽样、排序、diff 逻辑与 brief 一致。

## 测试

```
pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/replenish-light-sync.test.ts
```
结果：tests 34 / pass 34 / **fail 0**（输出见 `.superpowers/sdd/task1-tests.txt`）。

### 类型检查
- `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`：改动前后输出完全一致（各 1856 行，`Compare-Object` 无差异；见 `tsc-before.txt` / `tsc-after.txt`）。注意：这条命令只会报 project references 相关错误（617×TS6305、1×TS6306、1×TS6310），**实际上没有对 server 代码做类型检查**。
- 补充做了针对性检查（临时 tsconfig 继承 `tsconfig.node.json`，只包含两个改动文件，检查后已删除；输出见 `tsc-task1-files.txt`）：`replenishment-baseline.ts` 无错误；`replenishmentForecast.ts` 有 3 个错误，均在未改动的既有行上（`health.healthStatus = decisionHealth` 的 InventoryHealth 类型收窄、`shouldReplenishByLight` 的 `replenishLight: string`、`enhanceReplenishmentReasons` 的 `warehouseCode: string | null` 参数），属于既有问题，不是本次引入。

## 基线

```
pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts export ../../.tmp-rules-baseline.json
pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json
```

| 项 | 值 |
|---|---|
| 抽样 SKU | 500 |
| 建议（NETWORK 行） | 284 |
| 健康行 | 4500（500 SKU × 9 仓） |
| export 用时 | 123s |
| compare 用时 | 162s |
| compare 结果 | **与基线一致** |

基线文件：仓库根目录 `.tmp-rules-baseline.json`（未提交）。日志：`task1-export.log`、`task1-compare.log`。

## 改动文件
- `apps/web/server/tasks/replenishmentForecast.ts`（modified）
- `apps/web/scripts/replenishment-baseline.ts`（new）

## 自查
- 只 `git add` 了上述两个文件；临时文件（`__head_rf.ts`、`tsconfig.tmp-task1.json`）已删除。
- dry-run 提前返回位于 Dify 判断之后、所有 supersede/insert 之前。
- `skuIds` 为空数组时退回全量（`?.length` 判断），与 brief 一致。

## 风险 / 疑虑
1. **工作区有大量与本任务无关的未提交改动**：大量被跟踪文件处于已修改状态，其中包括补货链路依赖的 lib（如 `inventory-supply-lot-sync.ts`、`inventory-timeline.ts`、`demand-plan-service.ts`、`task-runs.ts` 等），以及未跟踪的 qc-reinspection 文件。基线是在**当前工作区代码**上生成的，而 tag `rules-p0-baseline` 只包含已提交的内容。如果后续任务（如 Task 8 用 worktree 从 tag 重新导出基线）只基于 tag 跑，结果可能和本次基线不同。建议决定这些 WIP 是否先提交，或后续对照始终在同一工作区进行。
2. 284 条建议**全部** `needsManualConfirm = true`。这属于数据本身（需求门控标记）而非 dry-run 造成，但说明该字段在这批样本上没有区分度，后续对照时它不太能发现回归。
3. 时间轴依赖当天日期：基线对照须在 2026-10-26 当天完成。
4. 文中给定的 tsc 命令无法真正检查 server 代码（见上），后续任务不要把它当作类型安全的证据。
