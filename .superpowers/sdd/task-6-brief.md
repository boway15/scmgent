### Task 6: 参数存储服务与补货任务接入

**Files:**
- Create: `apps/web/server/rules/core/store.ts`
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Test: `apps/web/server/rules/core/store.test.ts`

**Interfaces:**
- Consumes: Task 2 `resolveParams`、Task 3 `REPLENISHMENT_PARAMS` 等、Task 4 新入参、Task 5 表
- Produces:
  ```ts
  // store.ts
  export async function loadActiveParamSets(moduleCode: string): Promise<ActiveParamSet[]>;
  export function createParamsResolver<S extends ParamSchema>(schema: S, sets: ActiveParamSet[]):
    (ctx: RuleScopeContext) => ResolvedParams<S>;
  export async function startRuleRun(input: { moduleCode: string; trigger: 'task' | 'simulation' | 'page'; moduleVersion: number; paramSetIds: string[] }): Promise<string>;
  export async function finishRuleRun(id: string): Promise<void>;
  // replenishmentForecast.ts
  export type ReplenishmentRunOptions = {
    dryRun?: boolean;
    skuIds?: string[];
    /** 试算用：替代数据库 active 参数集 */
    paramSets?: ActiveParamSet[];
    trigger?: 'task' | 'simulation';
  };
  ```

- [ ] **Step 1: 写失败测试 `store.test.ts`（只测纯函数部分）**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createParamsResolver } from './store.js';
import { REPLENISHMENT_PARAMS } from '../replenishment/params.js';

describe('createParamsResolver', () => {
  it('memoizes per scope key and resolves layered values', () => {
    const resolve = createParamsResolver(REPLENISHMENT_PARAMS, [
      { id: 'g', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 40 }, version: 1 },
      { id: 'w', scopeType: 'warehouse', scopeValue: 'UK', params: { singleCoverDays: 60 }, version: 1 },
    ]);
    const a = resolve({ warehouse: 'UK' });
    const b = resolve({ warehouse: 'UK' });
    assert.equal(a, b);
    assert.equal(a.values.singleCoverDays, 60);
    assert.equal(resolve({ warehouse: 'US-WEST' }).values.singleCoverDays, 40);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `store.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db, ruleEvalRuns, ruleParamSets } from '@scm/db';
import type { ParamSchema } from './param.js';
import {
  resolveParams,
  type ActiveParamSet,
  type ResolvedParams,
  type RuleScopeContext,
  type RuleScopeType,
} from './resolve.js';

export async function loadActiveParamSets(moduleCode: string): Promise<ActiveParamSet[]> {
  const rows = await db
    .select({
      id: ruleParamSets.id,
      scopeType: ruleParamSets.scopeType,
      scopeValue: ruleParamSets.scopeValue,
      params: ruleParamSets.params,
      version: ruleParamSets.version,
    })
    .from(ruleParamSets)
    .where(and(eq(ruleParamSets.moduleCode, moduleCode), eq(ruleParamSets.status, 'active')));
  return rows.map((row) => ({
    id: row.id,
    scopeType: row.scopeType as RuleScopeType,
    scopeValue: row.scopeValue,
    params: (row.params ?? {}) as Record<string, unknown>,
    version: row.version,
  }));
}

/** 同一次运行内按作用范围缓存解析结果。 */
export function createParamsResolver<S extends ParamSchema>(
  schema: S,
  sets: ActiveParamSet[],
): (ctx: RuleScopeContext) => ResolvedParams<S> {
  const cache = new Map<string, ResolvedParams<S>>();
  return (ctx) => {
    const key = [ctx.projectGroup ?? '', ctx.category ?? '', ctx.warehouse ?? '', ctx.skuCode ?? ''].join('|');
    const hit = cache.get(key);
    if (hit) return hit;
    const resolved = resolveParams(schema, sets, ctx);
    cache.set(key, resolved);
    return resolved;
  };
}

export async function startRuleRun(input: {
  moduleCode: string;
  trigger: 'task' | 'simulation' | 'page';
  moduleVersion: number;
  paramSetIds: string[];
}): Promise<string> {
  const [row] = await db
    .insert(ruleEvalRuns)
    .values({
      moduleCode: input.moduleCode,
      trigger: input.trigger,
      moduleVersion: input.moduleVersion,
      paramSetIds: input.paramSetIds,
    })
    .returning({ id: ruleEvalRuns.id });
  return row.id;
}

export async function finishRuleRun(id: string): Promise<void> {
  await db.update(ruleEvalRuns).set({ finishedAt: new Date() }).where(eq(ruleEvalRuns.id, id));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts`
Expected: `fail 0`

- [ ] **Step 5: 补货任务接入参数**

在 `replenishmentForecast.ts`：

1. 导入：
   ```ts
   import { createParamsResolver, finishRuleRun, loadActiveParamSets, startRuleRun } from '../rules/core/store.js';
   import type { ActiveParamSet } from '../rules/core/resolve.js';
   import {
     REPLENISHMENT_PARAMS,
     decideWarehouseCandidate,
     resolveMoqByPriority,
     shouldReplenishWithLinkage,
     replenishmentRule,
   } from '../rules/replenishment/index.js';
   ```
   删除不再使用的 `applyMoq`、`resolveEffectiveMoq`、`shouldReplenishByLight` 导入。
2. `ReplenishmentRunOptions` 增加 `paramSets?: ActiveParamSet[]; trigger?: 'task' | 'simulation';`。
3. `activeSkus` 查询的 select 增加 `projectGroup: skus.projectGroup,`。
4. 在 `const skuIds = ...` 之后：
   ```ts
   const paramSets = options.paramSets ?? (await loadActiveParamSets(replenishmentRule.code));
   const resolveRuleParams = createParamsResolver(REPLENISHMENT_PARAMS, paramSets);
   const usedParamSetIds = new Set<string>();
   ```
5. SKU 循环开头，`effectiveMoq` 计算替换为：
   ```ts
   const skuParams = resolveRuleParams({ projectGroup: sku.projectGroup });
   skuParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
   const effectiveMoq = resolveMoqByPriority(
     sku.moq,
     sku.spuId ? spuMoqMap.get(sku.spuId) : null,
     skuParams.values.moqPriority,
   );
   ```
6. 第一个仓循环（健康度）内，在 `computeSkuWarehouseHealth` 之前：
   ```ts
   const whParams = resolveRuleParams({ projectGroup: sku.projectGroup, warehouse: wh.code });
   whParams.paramSetIds.forEach((id) => usedParamSetIds.add(id));
   ```
   调用加 `ruleDefaults: { safetyStockDays: whParams.values.defaultSafetyStockDays, overstockThresholdDays: whParams.values.overstockThresholdDays },`。
7. 第二个仓循环（候选）开头同样取 `whParams`（复用解析器，命中缓存）。然后：
   - `if (wh.regionGroup === 'US') {` 改为 `if (wh.regionGroup === 'US' && whParams.values.usNetworkDeferEnabled) {`。
   - `buildSkuWarehouseTimeline({...})` 加 `coverDays: whParams.values.singleCoverDays,`。
   - `calcTimelineDecisionHealth({...})` 中 `overstockThresholdDays:` 的回退改为 `health.coverage.overstockThresholdDays ?? whParams.values.overstockThresholdDays`，并加 `slowMoving: { maxDaily: whParams.values.slowMovingDailyMax, minCoverageDays: whParams.values.slowMovingMinCoverageDays },`。
   - 原来的三行 `if (deferUs) continue; if (!needsReplenishmentByHealth(decisionHealth)) continue; if (suggestedQty <= 0) continue;` 以及 `const rawQty = suggestedQty; suggestedQty = applyMoq(suggestedQty, effectiveMoq);` 替换为：
     ```ts
     const candidate = decideWarehouseCandidate({
       coverageHealth: coverageHealthStatus,
       decisionHealth,
       deferredByUsNetwork: deferUs,
       suggestedQty,
       moq: effectiveMoq,
     });
     health.metrics.ruleTrace = candidate.trace;
     if (!candidate.include) continue;
     const rawQty = suggestedQty;
     suggestedQty = candidate.qty;
     ```
     灰灯必须保持在计算时间轴**之前**跳过（否则灰灯行会多跑一次时间轴、改写 `health.metrics.timeline*` 与 `health.healthStatus`，健康快照不再一致）。把原有的 `if (coverageHealthStatus === 'gray') { continue; }` 改为补写判断依据后再跳过：
     ```ts
     if (coverageHealthStatus === 'gray') {
       health.metrics.ruleTrace = decideWarehouseCandidate({
         coverageHealth: 'gray',
         decisionHealth: 'gray',
         deferredByUsNetwork: false,
         suggestedQty: 0,
         moq: 0,
       }).trace;
       continue;
     }
     ```
   - `skuCandidates.push({... metrics: {...}})` 的 `metrics` 中加 `ruleTrace: candidate.trace,`。
8. 网络时间轴段：`policyRows.reduce(...)` 中两处 `DEFAULT_SAFETY_STOCK_DAYS` 改为 `skuParams.values.defaultSafetyStockDays`；`buildSkuNetworkTimeline({...})` 加 `coverDays: skuParams.values.singleCoverDays,`。
9. `eligibleItems` 过滤改为：
   ```ts
   const linkageBySku = new Map(
     activeSkus.map((sku) => [sku.id, resolveRuleParams({ projectGroup: sku.projectGroup }).values.yellowLightLinkage]),
   );
   const eligibleItems = pending.filter((item) =>
     shouldReplenishWithLinkage({
       replenishLight: item.replenishLight,
       needsReplenishment: true,
       spuHasRedNeedingReplenishment: item.spuId ? spuRedNeeding.has(item.spuId) : false,
       yellowLightLinkage: linkageBySku.get(item.skuId) ?? true,
     }),
   );
   ```
10. run 记录：在 dry-run 提前返回之前、非 dry-run 分支里：
    ```ts
    const ruleRunId = dryRun
      ? null
      : await startRuleRun({
          moduleCode: replenishmentRule.code,
          trigger: options.trigger ?? 'task',
          moduleVersion: replenishmentRule.version,
          paramSetIds: [...usedParamSetIds],
        });
    ```
    `db.insert(reorderSuggestions).values({... metrics: item.metrics ...})` 改为 `metrics: { ...item.metrics, ruleRunId },`；函数返回前 `if (ruleRunId) await finishRuleRun(ruleRunId);`。
11. 删除 `DEFAULT_SAFETY_STOCK_DAYS` 导入（若已无引用）；`DEFAULT_OVERSTOCK_THRESHOLD_DAYS` 同理。

- [ ] **Step 6: 跑测试、类型检查、基线对照**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts server/rules/replenishment/evaluate.test.ts server/lib/network-replenishment.test.ts`
Expected: `fail 0`

Run: `pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json`
Expected: 无新增报错

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: `与基线一致`（数据库无参数集）

- [ ] **Step 7: 参数生效冒烟**

在本地库插入一条全局参数集，验证结果变化后删除：

```sql
INSERT INTO rule_param_sets (module_code, scope_type, scope_value, params, version, status)
VALUES ('replenishment', 'global', '*', '{"singleCoverDays": 60}', 1, 'active');
```

Run: `pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json`
Expected: exit 1，差异集中在 `suggestedQty` 增大的行。

```sql
DELETE FROM rule_param_sets WHERE module_code = 'replenishment' AND version = 1 AND scope_type = 'global';
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/server/rules/core/store.ts apps/web/server/rules/core/store.test.ts apps/web/server/tasks/replenishmentForecast.ts
git commit -m "feat(replenishment): resolve rule params per scope and record rule runs"
```

---

