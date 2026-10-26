### Task 3: 备货规则模块（参数 + 纯函数判断）

**Files:**
- Create: `apps/web/server/rules/replenishment/params.ts`
- Create: `apps/web/server/rules/replenishment/qty.ts`
- Create: `apps/web/server/rules/replenishment/evaluate.ts`
- Create: `apps/web/server/rules/replenishment/index.ts`
- Create: `apps/web/server/rules/registry.ts`
- Test: `apps/web/server/rules/replenishment/qty.test.ts`、`apps/web/server/rules/replenishment/evaluate.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ParamSchema`、`ParamValues`、`defineRuleModule`、`RuleTraceItem`
- Produces:
  ```ts
  // params.ts
  export const REPLENISHMENT_PARAMS: ParamSchema;          // 见 Step 1
  export type ReplenishmentParams = ParamValues<typeof REPLENISHMENT_PARAMS>;
  export const REPLENISHMENT_DEFAULTS: ReplenishmentParams;
  // qty.ts
  export function decideReplenishmentQty(input: {
    cumulativeDemandAtTarget: number; safetyStockQty: number; supplyAtTarget: number;
    coverQty?: number; moq?: number;
  }): number;
  // evaluate.ts
  export type MoqPriority = 'sku_then_spu' | 'spu_then_sku' | 'max';
  export function resolveMoqByPriority(skuMoq: number | null | undefined, spuMoq: number | null | undefined, priority: string): number;
  export function decideWarehouseCandidate(input: {
    coverageHealth: InventoryHealth; decisionHealth: InventoryHealth; deferredByUsNetwork: boolean;
    suggestedQty: number; moq: number;
  }): { include: boolean; qty: number; moqApplied: boolean; trace: RuleTraceItem[] };
  export function isUsDeferEnabled(params: Pick<ReplenishmentParams, 'usNetworkDeferEnabled'>): boolean;
  export function shouldReplenishWithLinkage(input: {
    replenishLight: ReplenishLight; needsReplenishment: boolean; spuHasRedNeedingReplenishment: boolean; yellowLightLinkage: boolean;
  }): boolean;
  // index.ts
  export const replenishmentRule: RuleModuleMeta<typeof REPLENISHMENT_PARAMS>;
  // registry.ts
  export const RULE_MODULES: ReadonlyArray<RuleModuleMeta<ParamSchema>>;
  export function getRuleModule(code: string): RuleModuleMeta<ParamSchema> | undefined;
  ```

- [ ] **Step 1: 写 `params.ts`**

```ts
import { defaultsOf, type ParamSchema, type ParamValues } from '../core/param.js';

export const REPLENISHMENT_PARAMS = {
  singleCoverDays: {
    kind: 'int',
    label: '单次补货覆盖天数',
    unit: '天',
    default: 30,
    min: 7,
    max: 180,
    help: '单次建议量不超过从今天起该天数的规划需求；有缺口时再按 MOQ 抬升',
  },
  defaultSafetyStockDays: {
    kind: 'int',
    label: '默认安全库存天数',
    unit: '天',
    default: 14,
    min: 0,
    max: 180,
    help: '安全库存配置未填天数时使用',
  },
  overstockThresholdDays: {
    kind: 'int',
    label: '超储阈值',
    unit: '天',
    default: 180,
    min: 30,
    max: 720,
    help: '确定覆盖天数超过该值且无建议量时判蓝灯',
  },
  slowMovingDailyMax: {
    kind: 'number',
    label: '滞销日均上限',
    unit: '件/天',
    default: 0.1,
    min: 0,
    max: 10,
    help: '日均不超过该值且覆盖达到滞销覆盖下限时判灰灯，不出建议',
  },
  slowMovingMinCoverageDays: {
    kind: 'int',
    label: '滞销覆盖下限',
    unit: '天',
    default: 90,
    min: 0,
    max: 720,
  },
  moqPriority: {
    kind: 'enum',
    label: 'MOQ 取值顺序',
    default: 'sku_then_spu',
    options: [
      { value: 'sku_then_spu', label: 'SKU 优先，其次 SPU' },
      { value: 'spu_then_sku', label: 'SPU 优先，其次 SKU' },
      { value: 'max', label: '取两者较大值' },
    ],
  },
  yellowLightLinkage: {
    kind: 'boolean',
    label: '黄灯联动',
    default: true,
    help: '开：补货灯黄灯 SKU 仅在同 SPU 有红灯 SKU 需补时才补；关：黄灯与红灯一样需要即补',
  },
  usNetworkDeferEnabled: {
    kind: 'boolean',
    label: 'US 仓网延后',
    default: true,
    help: '开：US 单仓低于 ROP 但仓网总量足够时延后补货',
  },
} satisfies ParamSchema;

export type ReplenishmentParams = ParamValues<typeof REPLENISHMENT_PARAMS>;

export const REPLENISHMENT_DEFAULTS: ReplenishmentParams = defaultsOf(REPLENISHMENT_PARAMS);
```

- [ ] **Step 2: 写失败测试 `qty.test.ts`**（与 `inventory-timeline.test.ts` 中 `calcSuggestedQtyFromTimeline` 的用例同口径）

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideReplenishmentQty } from './qty.js';

describe('decideReplenishmentQty', () => {
  it('gap = demand + safety − supply, ceil', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 100.2, safetyStockQty: 20, supplyAtTarget: 50 }),
      71,
    );
  });
  it('caps at coverQty before MOQ', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 300 }),
      300,
    );
  });
  it('MOQ lifts after cap', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 300, moq: 400 }),
      400,
    );
  });
  it('no gap → 0 even with MOQ', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 10, safetyStockQty: 0, supplyAtTarget: 50, moq: 400 }),
      0,
    );
  });
  it('coverQty 0 means no cap', () => {
    assert.equal(
      decideReplenishmentQty({ cumulativeDemandAtTarget: 500, safetyStockQty: 0, supplyAtTarget: 0, coverQty: 0 }),
      500,
    );
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 `qty.ts`**

```ts
/**
 * 建议量 = max(0, ceil(目标日累计需求 + 安全库存 − 目标日供给))；
 * 有 coverQty（>0）时先封顶到该量，再按 MOQ 抬升；缺口为 0 不因 MOQ 出单。
 */
export function decideReplenishmentQty(input: {
  cumulativeDemandAtTarget: number;
  safetyStockQty: number;
  supplyAtTarget: number;
  coverQty?: number;
  moq?: number;
}): number {
  let raw = Math.max(
    0,
    Math.ceil(input.cumulativeDemandAtTarget + input.safetyStockQty - input.supplyAtTarget),
  );
  if (raw <= 0) return 0;
  const cover = input.coverQty ?? 0;
  if (cover > 0) raw = Math.min(raw, Math.ceil(cover));
  const moq = input.moq ?? 0;
  return moq > 0 ? Math.max(raw, moq) : raw;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts`
Expected: `fail 0`

- [ ] **Step 6: 写失败测试 `evaluate.test.ts`**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideWarehouseCandidate,
  resolveMoqByPriority,
  shouldReplenishWithLinkage,
} from './evaluate.js';

describe('resolveMoqByPriority', () => {
  it('sku_then_spu matches legacy resolveEffectiveMoq', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'sku_then_spu'), 50);
    assert.equal(resolveMoqByPriority(0, 100, 'sku_then_spu'), 100);
    assert.equal(resolveMoqByPriority(null, null, 'sku_then_spu'), 0);
  });
  it('spu_then_sku and max', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'spu_then_sku'), 100);
    assert.equal(resolveMoqByPriority(50, null, 'spu_then_sku'), 50);
    assert.equal(resolveMoqByPriority(50, 100, 'max'), 100);
  });
  it('unknown priority falls back to sku_then_spu', () => {
    assert.equal(resolveMoqByPriority(50, 100, 'zzz'), 50);
  });
});

describe('decideWarehouseCandidate', () => {
  const base = {
    coverageHealth: 'red' as const,
    decisionHealth: 'red' as const,
    deferredByUsNetwork: false,
    suggestedQty: 120,
    moq: 0,
  };
  it('gray coverage light → skip', () => {
    const r = decideWarehouseCandidate({ ...base, coverageHealth: 'gray' });
    assert.equal(r.include, false);
  });
  it('US deferred → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, deferredByUsNetwork: true }).include, false);
  });
  it('green decision → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, decisionHealth: 'green' }).include, false);
  });
  it('qty 0 → skip', () => {
    assert.equal(decideWarehouseCandidate({ ...base, suggestedQty: 0 }).include, false);
  });
  it('MOQ lifts and is reported', () => {
    const r = decideWarehouseCandidate({ ...base, moq: 200 });
    assert.deepEqual([r.include, r.qty, r.moqApplied], [true, 200, true]);
    assert.ok(r.trace.some((t) => t.rule === 'moq'));
  });
});

describe('shouldReplenishWithLinkage', () => {
  it('linkage on: yellow only with red in same SPU', () => {
    const input = { replenishLight: 'yellow' as const, needsReplenishment: true, yellowLightLinkage: true };
    assert.equal(shouldReplenishWithLinkage({ ...input, spuHasRedNeedingReplenishment: false }), false);
    assert.equal(shouldReplenishWithLinkage({ ...input, spuHasRedNeedingReplenishment: true }), true);
  });
  it('linkage off: yellow acts like red', () => {
    assert.equal(
      shouldReplenishWithLinkage({
        replenishLight: 'yellow',
        needsReplenishment: true,
        spuHasRedNeedingReplenishment: false,
        yellowLightLinkage: false,
      }),
      true,
    );
  });
  it('green never', () => {
    assert.equal(
      shouldReplenishWithLinkage({
        replenishLight: 'green',
        needsReplenishment: true,
        spuHasRedNeedingReplenishment: true,
        yellowLightLinkage: false,
      }),
      false,
    );
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/evaluate.test.ts`
Expected: FAIL

- [ ] **Step 8: 实现 `evaluate.ts`、`index.ts`、`registry.ts`**

`evaluate.ts`：

```ts
import type { InventoryHealth } from '../../lib/replenishment-coverage.js';
import { needsReplenishmentByHealth } from '../../lib/inventory-light.js';
import { shouldReplenishByLight, type ReplenishLight } from '../../lib/replenish-light.js';
import type { RuleTraceItem } from '../core/define.js';
import type { ReplenishmentParams } from './params.js';

export type MoqPriority = 'sku_then_spu' | 'spu_then_sku' | 'max';

function positive(value: number | null | undefined): number {
  return value != null && value > 0 ? value : 0;
}

export function resolveMoqByPriority(
  skuMoq: number | null | undefined,
  spuMoq: number | null | undefined,
  priority: string,
): number {
  const sku = positive(skuMoq);
  const spu = positive(spuMoq);
  if (priority === 'max') return Math.max(sku, spu);
  if (priority === 'spu_then_sku') return spu || sku;
  return sku || spu;
}

/** 单仓是否进入候选：灰灯、US 仓网延后、决策灯不需补、建议量为 0 均不进；进入时按 MOQ 抬升。 */
export function decideWarehouseCandidate(input: {
  coverageHealth: InventoryHealth;
  decisionHealth: InventoryHealth;
  deferredByUsNetwork: boolean;
  suggestedQty: number;
  moq: number;
}): { include: boolean; qty: number; moqApplied: boolean; trace: RuleTraceItem[] } {
  const trace: RuleTraceItem[] = [];
  const skip = (rule: string, note: string) => {
    trace.push({ rule, note });
    return { include: false, qty: 0, moqApplied: false, trace };
  };
  if (input.coverageHealth === 'gray') return skip('gray', '覆盖天数灯为灰（滞销/停售），不出建议');
  if (input.deferredByUsNetwork) return skip('us_network_defer', 'US 仓网总量足够，延后补货');
  if (!needsReplenishmentByHealth(input.decisionHealth)) {
    return skip('decision_light', `决策灯 ${input.decisionHealth}，无需补货`);
  }
  if (input.suggestedQty <= 0) return skip('no_gap', '净缺口为 0');

  trace.push({ rule: 'decision_light', note: `决策灯 ${input.decisionHealth}，需要补货` });
  const qty = input.moq > 0 ? Math.max(input.suggestedQty, input.moq) : input.suggestedQty;
  const moqApplied = qty > input.suggestedQty;
  if (moqApplied) {
    trace.push({ rule: 'moq', note: `建议量 ${input.suggestedQty} 按 MOQ 抬升至 ${qty}`, value: input.moq });
  }
  return { include: true, qty, moqApplied, trace };
}

export function isUsDeferEnabled(params: Pick<ReplenishmentParams, 'usNetworkDeferEnabled'>): boolean {
  return params.usNetworkDeferEnabled;
}

export function shouldReplenishWithLinkage(input: {
  replenishLight: ReplenishLight;
  needsReplenishment: boolean;
  spuHasRedNeedingReplenishment: boolean;
  yellowLightLinkage: boolean;
}): boolean {
  if (!input.yellowLightLinkage && input.replenishLight === 'yellow') {
    return input.needsReplenishment;
  }
  return shouldReplenishByLight({
    replenishLight: input.replenishLight,
    needsReplenishment: input.needsReplenishment,
    spuHasRedNeedingReplenishment: input.spuHasRedNeedingReplenishment,
  });
}
```

若 `InventoryHealth` 不从 `replenishment-coverage.ts` 导出，改为从其定义处导入（`replenishmentForecast.ts` 第 14 行从 `../lib/replenishment-coverage.js` 导入，可直接沿用）。

`index.ts`：

```ts
import { defineRuleModule } from '../core/define.js';
import { REPLENISHMENT_PARAMS } from './params.js';

export const replenishmentRule = defineRuleModule({
  code: 'replenishment',
  name: '备货规则',
  description: '决定要不要下单、下多少、何时下单',
  version: 1,
  params: REPLENISHMENT_PARAMS,
  scopes: ['global', 'project_group', 'warehouse'],
});

export * from './params.js';
export * from './qty.js';
export * from './evaluate.js';
```

`registry.ts`：

```ts
import type { ParamSchema } from './core/param.js';
import type { RuleModuleMeta } from './core/define.js';
import { replenishmentRule } from './replenishment/index.js';

export const RULE_MODULES: ReadonlyArray<RuleModuleMeta<ParamSchema>> = [replenishmentRule];

export function getRuleModule(code: string): RuleModuleMeta<ParamSchema> | undefined {
  return RULE_MODULES.find((m) => m.code === code);
}
```

- [ ] **Step 9: 运行确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts server/rules/replenishment/evaluate.test.ts`
Expected: `fail 0`

- [ ] **Step 10: Commit**

```bash
git add apps/web/server/rules
git commit -m "feat(rules): replenishment rule module params and pure decisions"
```

---

