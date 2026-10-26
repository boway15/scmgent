### Task 7: SKU 规划页与补货任务同源

**Files:**
- Modify: `apps/web/server/lib/inventory-planning-service.ts`

**Interfaces:**
- Consumes: `loadActiveParamSets`、`createParamsResolver`、`resolveMoqByPriority`、`REPLENISHMENT_PARAMS`、Task 4 新入参

- [ ] **Step 1: 加载解析器**

文件顶部导入：

```ts
import { createParamsResolver, loadActiveParamSets } from '../rules/core/store.js';
import { REPLENISHMENT_PARAMS, replenishmentRule, resolveMoqByPriority } from '../rules/replenishment/index.js';
```

`getSkuNetworkPlanningView` 与 `getSkuPlanningView` 中加载 SKU 的 select 都加 `projectGroup: skus.projectGroup,`（找到各自 `db.select({...}).from(skus)` 处）。两个函数开头（SKU 查到之后）各加：

```ts
const resolveRuleParams = createParamsResolver(
  REPLENISHMENT_PARAMS,
  await loadActiveParamSets(replenishmentRule.code),
);
```

- [ ] **Step 2: 网络视图（`getSkuNetworkPlanningView`）**

```ts
const ruleParams = resolveRuleParams({ projectGroup: sku.projectGroup }).values;
```

- 第 481–482 行两处 `DEFAULT_SAFETY_STOCK_DAYS` → `ruleParams.defaultSafetyStockDays`。
- 第 570 行 `moq: sku.skuMoq || sku.spuMoq || undefined,` → `moq: resolveMoqByPriority(sku.skuMoq, sku.spuMoq, ruleParams.moqPriority) || undefined,`，并在 `buildSkuNetworkTimeline({...})` 加 `coverDays: ruleParams.singleCoverDays,`。
- 第 618、644 行 `DEFAULT_OVERSTOCK_THRESHOLD_DAYS` → `ruleParams.overstockThresholdDays`；第 614 行 `calcTimelineDecisionHealth({...})` 加 `slowMoving: { maxDaily: ruleParams.slowMovingDailyMax, minCoverageDays: ruleParams.slowMovingMinCoverageDays },`。

- [ ] **Step 3: 分仓视图（`getSkuPlanningView`）**

```ts
const ruleParams = resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: warehouse.code }).values;
```

- 第 755 行 `computeSkuWarehouseHealth({...})` 加 `ruleDefaults: { safetyStockDays: ruleParams.defaultSafetyStockDays, overstockThresholdDays: ruleParams.overstockThresholdDays },`；第 772 行 `moq` 同 Step 2 写法。
- 第 784 行 `buildSkuWarehouseTimeline({...})` 加 `coverDays: ruleParams.singleCoverDays,`，第 792 行 `moq` 同上。
- `buildSkuPlanningView` 第 306 行的 `calcTimelineDecisionHealth` 由该函数的入参决定；给 `buildSkuPlanningView` 的 `input` 类型加 `ruleParams?: { overstockThresholdDays: number; slowMovingDailyMax: number; slowMovingMinCoverageDays: number }`，第 311 行回退改为 `?? input.ruleParams?.overstockThresholdDays ?? DEFAULT_OVERSTOCK_THRESHOLD_DAYS`，并加 `slowMoving: input.ruleParams ? { maxDaily: input.ruleParams.slowMovingDailyMax, minCoverageDays: input.ruleParams.slowMovingMinCoverageDays } : undefined,`。两个视图调用 `buildSkuPlanningView({...})` 时传 `ruleParams`。

- [ ] **Step 4: 测试与类型检查**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-planning-service.test.ts`（文件存在时）及 `server/lib/inventory-timeline.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

- [ ] **Step 5: 手工核对**

本地启动 `pnpm dev`，打开 3 个有建议的 SKU 的规划页（网络视图 + 一个分仓视图），建议量、决策灯、断货日与 `.tmp-rules-baseline.json` 中对应行一致。

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/lib/inventory-planning-service.ts
git commit -m "feat(planning): sku planning view uses resolved replenishment params"
```

---

