### Task 4: 现有计算改为读规则函数与可传入参数（行为不变）

**Files:**
- Modify: `apps/web/server/lib/inventory-timeline.ts`
- Modify: `apps/web/server/lib/inventory-timeline-service.ts`
- Modify: `apps/web/server/lib/inventory-light.ts`
- Modify: `apps/web/server/lib/replenishment-coverage.ts`
- Modify: `apps/web/server/lib/safety-stock-z.ts`
- Modify: `apps/web/server/lib/safety-stock-suggestion-service.ts`
- Modify: `apps/web/server/lib/alert-action.ts`
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Test: `apps/web/server/lib/inventory-timeline.test.ts`（新增用例）

**Interfaces:**
- Consumes: `decideReplenishmentQty`、`REPLENISHMENT_DEFAULTS`
- Produces:
  - `projectDailyInventory(params & { coverDays?: number })`
  - `buildSkuWarehouseTimeline(params & { coverDays?: number })`、`buildSkuNetworkTimeline(params & { coverDays?: number })`、`assembleWarehouseTimeline(params & { coverDays?: number })`
  - `type SlowMovingThresholds = { maxDaily: number; minCoverageDays: number }`；`isSlowMovingStock(params & { thresholds?: SlowMovingThresholds })`、`calcTimelineDecisionHealth(params & { slowMoving?: SlowMovingThresholds })`
  - `resolvePlanningSafetyStock(params & { defaultSafetyStockDays?: number })`
  - `computeSkuWarehouseHealth(params & { ruleDefaults?: { safetyStockDays: number; overstockThresholdDays: number } })`

- [ ] **Step 1: 写失败测试（时间轴 coverDays）**

在 `server/lib/inventory-timeline.test.ts` 末尾追加：

```ts
describe('projectDailyInventory coverDays', () => {
  it('caps by custom coverDays instead of 30', () => {
    const r = projectDailyInventory({
      lots: [],
      today: '2026-10-26',
      totalLeadDays: 60,
      safetyStockDays: 0,
      safetyStockQty: 0,
      dailyDemandFn: () => 10,
      coverDays: 45,
    });
    assert.equal(r.suggestedQty, 450);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts`
Expected: FAIL（`suggestedQty` 为 300）

- [ ] **Step 3: 改 `inventory-timeline.ts`**

1. 顶部加 `import { decideReplenishmentQty } from '../rules/replenishment/qty.js';` 与 `import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';`。
2. `export const SINGLE_REPLENISHMENT_COVER_DAYS = 30;` 改为 `export const SINGLE_REPLENISHMENT_COVER_DAYS = REPLENISHMENT_DEFAULTS.singleCoverDays;`
3. `projectDailyInventory` 参数类型增加 `/** 单次补货覆盖天数，缺省为规则默认值 */ coverDays?: number;`，函数体开头加 `const coverDays = params.coverDays ?? SINGLE_REPLENISHMENT_COVER_DAYS;`，循环内 `if (k < SINGLE_REPLENISHMENT_COVER_DAYS)` 改为 `if (k < coverDays)`。
4. `calcSuggestedQtyFromTimeline` 函数体替换为委托：
   ```ts
   return decideReplenishmentQty({
     cumulativeDemandAtTarget: params.cumulativeDemandAtTarget,
     safetyStockQty: params.safetyStockQty,
     supplyAtTarget: params.projectedOverseasAtTarget,
     coverQty: params.maxCoverQty,
     moq: params.moq,
   });
   ```

- [ ] **Step 4: 改 `inventory-timeline-service.ts` 透传**

`assembleWarehouseTimeline`、`buildSkuWarehouseTimeline`、`buildSkuNetworkTimeline` 三个函数的参数类型都加 `coverDays?: number;`。四处 `projectDailyInventory({...})` 调用（主时间轴与 champion 影子各两处）都加一行 `coverDays: params.coverDays,`；`buildSkuWarehouseTimeline` 调 `assembleWarehouseTimeline` 时加 `coverDays: params.coverDays,`。

- [ ] **Step 5: 改 `inventory-light.ts` 滞销阈值**

```ts
import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';

export const SLOW_MOVING_MAX_DAILY = REPLENISHMENT_DEFAULTS.slowMovingDailyMax;
export const SLOW_MOVING_MIN_COVERAGE_DAYS = REPLENISHMENT_DEFAULTS.slowMovingMinCoverageDays;

export type SlowMovingThresholds = { maxDaily: number; minCoverageDays: number };

export function isSlowMovingStock(params: {
  effectiveQty: number;
  avgDaily: number;
  coverageDays: number;
  thresholds?: SlowMovingThresholds;
}): boolean {
  const maxDaily = params.thresholds?.maxDaily ?? SLOW_MOVING_MAX_DAILY;
  const minCoverage = params.thresholds?.minCoverageDays ?? SLOW_MOVING_MIN_COVERAGE_DAYS;
  if (params.effectiveQty <= 0) return false;
  if (params.avgDaily > maxDaily) return false;
  return Number.isFinite(params.coverageDays) && params.coverageDays >= minCoverage;
}
```

`calcTimelineDecisionHealth` 参数加 `slowMoving?: SlowMovingThresholds;`，内部 `isSlowMovingStock({...})` 调用加 `thresholds: params.slowMoving,`。

- [ ] **Step 6: 合并安全库存与超储默认常量**

- `replenishment-coverage.ts`：
  ```ts
  import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';
  export const DEFAULT_SAFETY_STOCK_DAYS = REPLENISHMENT_DEFAULTS.defaultSafetyStockDays;
  export const DEFAULT_OVERSTOCK_THRESHOLD_DAYS = REPLENISHMENT_DEFAULTS.overstockThresholdDays;
  ```
- `safety-stock-z.ts`：`export const DEFAULT_PLANNING_SAFETY_STOCK_DAYS = 14;` 改为 `export { DEFAULT_SAFETY_STOCK_DAYS as DEFAULT_PLANNING_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';`，文件内使用处改为 `import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';` 后引用 `DEFAULT_SAFETY_STOCK_DAYS`。`resolvePlanningSafetyStock` 参数加 `defaultSafetyStockDays?: number;`，第 107 行改为 `safetyStockDays: policy?.safetyStockDays ?? params.defaultSafetyStockDays ?? DEFAULT_SAFETY_STOCK_DAYS,`。
- `safety-stock-suggestion-service.ts`：`export const DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS = 14;` 改为 `export { DEFAULT_SAFETY_STOCK_DAYS as DEFAULT_CONFIGURED_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';`，并在文件内引用处改用导入的 `DEFAULT_SAFETY_STOCK_DAYS`。
- `alert-action.ts`：删除 `const DEFAULT_ALERT_SAFETY_DAYS = 14;`，改为 `import { DEFAULT_SAFETY_STOCK_DAYS } from './replenishment-coverage.js';`，第 41 行改为 `: DEFAULT_SAFETY_STOCK_DAYS;`。

若出现循环导入（`replenishment-coverage.ts` ↔ `inventory-light.ts`），`rules/replenishment/params.ts` 只依赖 `rules/core/param.ts`，不会成环；如 tsx 报 `Cannot access before initialization`，把上述 re-export 改为直接 `= 14` 字面量并加 `// 与 REPLENISHMENT_DEFAULTS 保持一致` 测试断言（见 Step 8）。

- [ ] **Step 7: `computeSkuWarehouseHealth` 加 `ruleDefaults`**

参数类型加：

```ts
  /** 规则中心解析出的默认值；未传时用代码默认值 */
  ruleDefaults?: { safetyStockDays: number; overstockThresholdDays: number };
```

第 547、549 行改为：

```ts
      safetyStockDays: policy?.safetyStockDays ?? params.ruleDefaults?.safetyStockDays ?? undefined,
      overstockThresholdDays:
        policy?.overstockThresholdDays ?? params.ruleDefaults?.overstockThresholdDays ?? undefined,
```

第 559 行 `resolvePlanningSafetyStock({` 调用内加 `defaultSafetyStockDays: params.ruleDefaults?.safetyStockDays,`。

- [ ] **Step 8: 加默认值一致性测试**

`apps/web/server/rules/replenishment/defaults-consistency.test.ts`：

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPLENISHMENT_DEFAULTS } from './params.js';
import {
  DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
  DEFAULT_SAFETY_STOCK_DAYS,
} from '../../lib/replenishment-coverage.js';
import { SINGLE_REPLENISHMENT_COVER_DAYS } from '../../lib/inventory-timeline.js';
import { SLOW_MOVING_MAX_DAILY, SLOW_MOVING_MIN_COVERAGE_DAYS } from '../../lib/inventory-light.js';
import { DEFAULT_PLANNING_SAFETY_STOCK_DAYS } from '../../lib/safety-stock-z.js';

describe('replenishment defaults match legacy constants', () => {
  it('all equal', () => {
    assert.equal(REPLENISHMENT_DEFAULTS.singleCoverDays, 30);
    assert.equal(SINGLE_REPLENISHMENT_COVER_DAYS, 30);
    assert.equal(DEFAULT_SAFETY_STOCK_DAYS, 14);
    assert.equal(DEFAULT_PLANNING_SAFETY_STOCK_DAYS, 14);
    assert.equal(DEFAULT_OVERSTOCK_THRESHOLD_DAYS, 180);
    assert.equal(SLOW_MOVING_MAX_DAILY, 0.1);
    assert.equal(SLOW_MOVING_MIN_COVERAGE_DAYS, 90);
    assert.equal(REPLENISHMENT_DEFAULTS.moqPriority, 'sku_then_spu');
    assert.equal(REPLENISHMENT_DEFAULTS.yellowLightLinkage, true);
    assert.equal(REPLENISHMENT_DEFAULTS.usNetworkDeferEnabled, true);
  });
});
```

- [ ] **Step 9: 跑全部相关测试与类型检查**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/replenishment-coverage.test.ts server/lib/network-replenishment.test.ts server/lib/inventory-health-service.test.ts server/lib/stock-alert-timeline.test.ts server/rules/replenishment/defaults-consistency.test.ts server/rules/replenishment/qty.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

- [ ] **Step 10: 基线对照（默认参数下应无差异）**

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`

- [ ] **Step 11: Commit**

```bash
git add apps/web/server/lib apps/web/server/rules
git commit -m "refactor(planning): route replenishment qty and defaults through rule module"
```

---

