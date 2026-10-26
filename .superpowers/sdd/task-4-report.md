# Task 4 Report: 现有计算改为读规则函数与可传入参数（行为不变）

## Status

**DONE**

## Commit

- SHA: `66b639adf451e6e7b49360aa89a7d8c6a6166282`
- Subject: `refactor(planning): route replenishment qty and defaults through rule module`
- Branch: `feat/rule-modules-p0`
- Staged only the 10 files this task modified or created (not `git add -A`).

## Files Changed (10)

| File | Action |
|------|--------|
| `apps/web/server/lib/inventory-timeline.ts` | `coverDays`；`SINGLE_REPLENISHMENT_COVER_DAYS` 别名；`calcSuggestedQtyFromTimeline` 委托 `decideReplenishmentQty`（不再套一层 MOQ） |
| `apps/web/server/lib/inventory-timeline-service.ts` | 三个组装函数透传 `coverDays`（主时间轴与 champion 影子共 4 处 `projectDailyInventory`，外加 `assembleWarehouseTimeline` 调用） |
| `apps/web/server/lib/inventory-light.ts` | 滞销常量改为 `REPLENISHMENT_DEFAULTS`；`SlowMovingThresholds`；`isSlowMovingStock` / `calcTimelineDecisionHealth` 可传入阈值 |
| `apps/web/server/lib/replenishment-coverage.ts` | `DEFAULT_SAFETY_STOCK_DAYS` / `DEFAULT_OVERSTOCK_THRESHOLD_DAYS` 改为规则默认值别名 |
| `apps/web/server/lib/safety-stock-z.ts` | 再导出 `DEFAULT_PLANNING_SAFETY_STOCK_DAYS`；`resolvePlanningSafetyStock` 增加 `defaultSafetyStockDays` |
| `apps/web/server/lib/safety-stock-suggestion-service.ts` | 再导出 `DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS`；内部改用 `DEFAULT_SAFETY_STOCK_DAYS` |
| `apps/web/server/lib/alert-action.ts` | 删除本地 14，改用 `DEFAULT_SAFETY_STOCK_DAYS` |
| `apps/web/server/lib/inventory-health-service.ts` | `computeSkuWarehouseHealth` 增加可选 `ruleDefaults` |
| `apps/web/server/lib/inventory-timeline.test.ts` | 新增 `coverDays` 用例 |
| `apps/web/server/rules/replenishment/defaults-consistency.test.ts` | 新增默认值一致性断言 |

未改 `evaluate.ts` 与 registry。未出现 `replenishment-coverage.ts` ↔ `inventory-light.ts` 循环初始化，因此没有退回字面量 14 / 180。

## TDD: RED / GREEN

### coverDays — RED（Step 2，改 `inventory-timeline.ts` 之前）

```text
Command: pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts
Exit code: 1
AssertionError: 300 !== 450
  at inventory-timeline.test.ts (caps by custom coverDays instead of 30)
ℹ tests 13
ℹ pass 12
ℹ fail 1
```

失败原因符合预期：未传参路径仍按 30 天封顶，`suggestedQty` 为 300。

### 相关测试 — GREEN（Step 9）

```text
Command: pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/inventory-health-service.test.ts server/lib/stock-alert-timeline.test.ts server/rules/replenishment/defaults-consistency.test.ts server/rules/replenishment/qty.test.ts
Exit code: 0
ℹ tests 40
ℹ suites 11
ℹ pass 40
ℹ fail 0
```

`projectDailyInventory coverDays` 与 `replenishment defaults match legacy constants` 均通过。

## Typecheck

```text
Command: pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json
Exit code: 2
```

错误码统计：TS6305 × 630、TS6306 × 1、TS6310 × 1。没有 TS2xxx 语义错误。

TS6305 覆盖整个 `server/`（含未改动的 `server/ai/*`、`server/tasks/*`），原因是根 `tsconfig.json` 引用了 `noEmit` 的 `tsconfig.node.json`（TS6306/TS6310）。本次改动的文件同样只出现这类「.d.ts 未构建」报错，没有新增类型错误。未另存 before 日志；对照依据是未改动文件与改动文件的错误类别相同。

## Baseline

```text
Command: pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json
Exit code: 0
与基线一致（用时 119s）
```

无数据库参数集时，500 SKU 补货基线与改动前一致。

## Self-Review

- `calcSuggestedQtyFromTimeline` 只把 `maxCoverQty` 映射为 `coverQty` 交给 `decideReplenishmentQty`，没有在外层再抬 MOQ。
- 导出常量（`SINGLE_REPLENISHMENT_COVER_DAYS`、安全库存天数、超储天数、滞销阈值）都是 `REPLENISHMENT_DEFAULTS` 的别名；规划侧与告警侧的 14 天常量改为从 `replenishment-coverage` 再导出，旧 import 路径仍可用。
- 未传 `coverDays` / `thresholds` / `ruleDefaults` / `defaultSafetyStockDays` 时走原默认值。`policy?.safetyStockDays` 为 `0` 时仍保留 0（`??` 不把 0 当成缺省）。
- `safety-stock-z`、`alert-action` 指向 `replenishment-coverage` 后，相关测试能加载模块，没有 `Cannot access before initialization`。

## Concerns

- `tsc --noEmit -p tsconfig.json` 因既有 project reference / `noEmit` 配置整树失败（见上）。本次没有引入语义类型错误，也没有改 tsconfig。
- 报告文件 `.superpowers/sdd/task-4-report.md` 未纳入上述 commit（brief 的 `git add` 范围是 lib / rules 代码与测试）。
