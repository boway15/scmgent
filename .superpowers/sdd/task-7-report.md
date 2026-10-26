# Task 7 Report: SKU 规划页与补货任务同源

## Status

**DONE_WITH_CONCERNS**

## Commit

- SHA: `06a79da308da7820f51e00d5d8f0eb07e234800f`
- Subject: `feat(planning): sku planning view uses resolved replenishment params`
- Branch: `feat/rule-modules-p0`
- Staged only `apps/web/server/lib/inventory-planning-service.ts` (not `git add -A`). This report is not in the commit.

## What changed

`getSkuNetworkPlanningView` 与 `getSkuPlanningView` 在查到 SKU 后调用 `loadActiveParamSets(replenishmentRule.code)` + `createParamsResolver(REPLENISHMENT_PARAMS, …)`。两条 SKU select 增加 `projectGroup`。

- 网络视图按 `{ projectGroup }` 解析。安全库存天数回退、MOQ（`resolveMoqByPriority`）、`coverDays`、超储阈值、滞销阈值都改用 `ruleParams`。
- 分仓视图按 `{ projectGroup, warehouse }` 解析。`computeSkuWarehouseHealth` 增加 `ruleDefaults`；时间轴 MOQ / `coverDays` 与网络视图同一写法。
- `buildSkuPlanningView` 增加可选 `ruleParams`。超储回退为 `coverage.overstockThresholdDays ?? ruleParams.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS`，并在传入 `ruleParams` 时把滞销阈值交给 `calcTimelineDecisionHealth`。两个视图都会传入 `ruleParams`。
- 未再引用 `DEFAULT_SAFETY_STOCK_DAYS`（`noUnusedLocals`）。无参数集时解析值等于 schema 默认（30/14/180/0.1/90，`sku_then_spu`），`coverDays` 30 与原先 `SINGLE_REPLENISHMENT_COVER_DAYS` 相同，不改变默认业务结果。

本任务未新增测试，无 TDD RED/GREEN。

## Tests

```text
Command: pnpm --filter @scm/web exec tsx --test server/lib/inventory-planning-service.test.ts server/lib/inventory-timeline.test.ts
Exit code: 0
ℹ tests 25
ℹ suites 5
ℹ pass 25
ℹ fail 0
```

## Typecheck

```text
Command: pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json
Wrapper exit: 1
tsc exit: 2
```

仅有既有 TS6305（`server/` 下 `.d.ts` 未构建）、以及 `tsconfig.node.json` 的 TS6306 / TS6310。`inventory-planning-service.ts` 只作为 TS6305 出现，没有新的错误类。

## Step 5 evidence

未启动 `pnpm dev`。`rule_param_sets` 行数为 0。对基线里前 3 条有建议量的 SKU 直接调用 `getSkuNetworkPlanningView` 与 `getSkuPlanningView`（分仓 DE）：

| SKU | 视图 | 基线建议量 / 灯 | 现场建议量 / 灯 | 现场断货日 |
|-----|------|-----------------|-----------------|------------|
| 100100901 | 网络 | 31 / red | 0 / red | 2026-10-26 |
| 100100901 | DE | 31 / red | 31 / red | 2026-10-26 |
| 100101001 | 网络 | 28 / red | 0 / red | 2026-10-26 |
| 100101001 | DE | 28 / red | 28 / red | 2026-10-26 |
| 100101101 | 网络 | 37 / red | 0 / red | 2026-10-26 |
| 100101101 | DE | 37 / red | 37 / red | 2026-10-26 |

分仓建议量与决策灯与 `.tmp-rules-baseline.json` 的 `health` 行一致。基线行没有断货日字段，无法对照；现场 `timeline.stockoutDateConfirmed` 均为 `2026-10-26`。

## Concerns

网络视图建议量是时间轴原始建议量 0，基线 `suggestions` 里 `NETWORK` 行是补货任务在时间轴建议量为 0 时回退到各仓较大值（`collapseSkuReplenishmentCandidates` 的 `networkQtyFallback`）。决策灯仍为 red，与基线一致。当前没有 active 参数集，这次改动没有改默认口径，因此没有把规划页网络建议量改成任务回退值。

## Self-review

- 两个视图都在 SKU 查到之后加载解析器；分仓解析放在仓库查到之后，作用域含 `warehouse.code`。
- MOQ、`coverDays`、安全库存 / 超储 / 滞销的替换点与简报符号一致。
- `buildSkuPlanningView` 在未传 `ruleParams` 时滞销阈值仍为 `undefined`，既有单测不走新分支，25 项仍全部通过。
