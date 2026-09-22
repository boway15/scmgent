# 安全库存建议值（只读推算）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SKU × 仓按 Z 值法推算建议安全库存天数/件数/ROP，在安全库存页只读展示并与现配置对比；未人工采纳前不改写 `safety_stock_config` 及健康/时间轴/预警口径。

**Architecture:** 新增纯函数 `calcSafetyStockSuggestion` 与输入解析 `resolveSuggestionInputs`（日均、σ、交期与健康同源）；只读 API `GET /api/safety-stock/suggestions` 与 `GET /api/safety-stock/:skuId/suggestion`；前端安全库存页增列 +「采纳」填入编辑态。不写库、不新建表、不改时间轴引擎。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `node --import tsx --test`

**Spec:** `docs/superpowers/specs/2026-09-20-safety-stock-suggestion-design.md`

## Global Constraints

- **建议 API 禁止写库**：`GET .../suggestions`、`GET .../suggestion` 不得 update/insert `safety_stock_config`。
- **默认 14 天不变**：未采纳前健康灯、时间轴、预警仍读已存配置。
- **建议方法固定 `z_demand`**；默认服务水平 **95%**（UI 可切换，仅影响建议请求）。
- **交期用 `totalLeadDays`**（`resolveLeadTimeForSkuWarehouse`），不用 SKU 单字段 `leadTimeDays`。
- **日均与健康同源**：有预测 → `calcForwardAvgDaily`；否则 → `resolveHistoricalDemand`（含断货修正）。
- **建议天数 cap 180**；触顶打 `days_capped`。
- **本期不做** `z_demand_leadtime`、批量静默回写、建议落库、飞书双向同步。
- **不改** Feishu 同步页、时间轴公式、健康灯判定式。

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/safety-stock-suggestion.ts` | 建议纯函数 + 置信度/flags |
| `apps/web/server/lib/safety-stock-suggestion.test.ts` | 纯函数单测 |
| `apps/web/server/lib/safety-stock-suggestion-service.ts` | `resolveSuggestionInputs`、列表/单行组装 |
| `apps/web/server/lib/safety-stock-suggestion-service.test.ts` | 组装逻辑单测（mock 输入） |
| `apps/web/server/routes/safety-stock.ts` | 新增 GET 路由 |
| `apps/web/server/routes/safety-stock-suggestion.test.ts` | 路由层单测（纯函数 + delta 计算） |
| `apps/web/src/lib/api.ts` | 客户端类型与请求 |
| `apps/web/src/pages/SafetyStockPage.tsx` | 建议列 UI + 采纳 |

---

### Task 1: 建议纯函数 `calcSafetyStockSuggestion`

**Files:**
- Create: `apps/web/server/lib/safety-stock-suggestion.ts`
- Create: `apps/web/server/lib/safety-stock-suggestion.test.ts`

**Interfaces:**
- Consumes: `calcSafetyStockQty`, `zFromServiceLevel`, `calcReorderPoint` from existing modules
- Produces:

```ts
export type SuggestionConfidence = 'high' | 'medium' | 'low';

export type SafetyStockSuggestion = {
  safetyStockQty: number | null;
  safetyStockDays: number | null;
  reorderPoint: number | null;
  method: 'z_demand';
  serviceLevel: number;
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  z: number;
  confidence: SuggestionConfidence;
  flags: string[];
};

export const MAX_SUGGESTED_SAFETY_STOCK_DAYS = 180;

export function calcSafetyStockSuggestion(params: {
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  serviceLevel?: number;
  inStockDays?: number;
  stockoutAdjusted?: boolean;
  demandSource?: 'forecast' | 'historical';
  effectiveSalesDays?: number;
}): SafetyStockSuggestion;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/server/lib/safety-stock-suggestion.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calcSafetyStockSuggestion,
  MAX_SUGGESTED_SAFETY_STOCK_DAYS,
} from './safety-stock-suggestion.js';

describe('calcSafetyStockSuggestion', () => {
  it('computes qty, days, and ROP for normal inputs', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 10,
      demandStdDev: 4,
      totalLeadDays: 90,
      serviceLevel: 0.95,
      inStockDays: 60,
      demandSource: 'historical',
      effectiveSalesDays: 60,
    });
    assert.equal(result.method, 'z_demand');
    assert.equal(result.safetyStockQty, 63); // ceil(1.65 * 4 * sqrt(90)) = 63
    assert.equal(result.safetyStockDays, 7); // ceil(63 / 10)
    assert.equal(result.reorderPoint, 963); // ceil(10*90 + 63)
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.flags, []);
  });

  it('returns null outputs and no_sales when avgDaily is zero', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 0,
      demandStdDev: 0,
      totalLeadDays: 90,
    });
    assert.equal(result.safetyStockQty, null);
    assert.equal(result.safetyStockDays, null);
    assert.equal(result.reorderPoint, null);
    assert.equal(result.confidence, 'low');
    assert.ok(result.flags.includes('no_sales'));
  });

  it('caps suggested days at MAX and sets days_capped flag', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 0.1,
      demandStdDev: 10,
      totalLeadDays: 90,
      effectiveSalesDays: 30,
    });
    assert.equal(result.safetyStockDays, MAX_SUGGESTED_SAFETY_STOCK_DAYS);
    assert.ok(result.flags.includes('days_capped'));
  });

  it('uses lead_time_fallback when totalLeadDays <= 0', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 5,
      demandStdDev: 2,
      totalLeadDays: 0,
      effectiveSalesDays: 20,
    });
    assert.equal(result.totalLeadDays, 1);
    assert.ok(result.flags.includes('lead_time_fallback'));
  });

  it('marks stockout_adjusted with medium confidence', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 8,
      demandStdDev: 3,
      totalLeadDays: 30,
      stockoutAdjusted: true,
      inStockDays: 40,
      effectiveSalesDays: 40,
    });
    assert.equal(result.confidence, 'medium');
    assert.ok(result.flags.includes('stockout_adjusted'));
  });

  it('gives high confidence for forecast demand', () => {
    const result = calcSafetyStockSuggestion({
      avgDaily: 12,
      demandStdDev: 4,
      totalLeadDays: 45,
      demandSource: 'forecast',
      effectiveSalesDays: 45,
    });
    assert.equal(result.confidence, 'high');
    assert.ok(result.flags.includes('forecast_demand'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --import tsx --test server/lib/safety-stock-suggestion.test.ts`  
Expected: FAIL — module `./safety-stock-suggestion.js` not found

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/server/lib/safety-stock-suggestion.ts
import { calcReorderPoint } from './replenishment.js';
import { calcSafetyStockQty, zFromServiceLevel } from './safety-stock-z.js';

export type SuggestionConfidence = 'high' | 'medium' | 'low';

export type SafetyStockSuggestion = {
  safetyStockQty: number | null;
  safetyStockDays: number | null;
  reorderPoint: number | null;
  method: 'z_demand';
  serviceLevel: number;
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  z: number;
  confidence: SuggestionConfidence;
  flags: string[];
};

export const MAX_SUGGESTED_SAFETY_STOCK_DAYS = 180;
const DEFAULT_SERVICE_LEVEL = 0.95;
const LOW_SAMPLE_DAYS = 14;

function resolveConfidence(params: {
  avgDaily: number;
  inStockDays: number;
  effectiveSalesDays: number;
  stockoutAdjusted: boolean;
  demandSource?: 'forecast' | 'historical';
  daysCapped: boolean;
}): SuggestionConfidence {
  if (params.avgDaily <= 0) return 'low';
  if (params.demandSource === 'forecast') return 'high';
  if (params.inStockDays >= 30 && !params.daysCapped) return 'high';
  if (params.effectiveSalesDays >= LOW_SAMPLE_DAYS) return 'medium';
  if (params.stockoutAdjusted) return 'medium';
  return 'low';
}

export function calcSafetyStockSuggestion(params: {
  avgDaily: number;
  demandStdDev: number;
  totalLeadDays: number;
  serviceLevel?: number;
  inStockDays?: number;
  stockoutAdjusted?: boolean;
  demandSource?: 'forecast' | 'historical';
  effectiveSalesDays?: number;
}): SafetyStockSuggestion {
  const flags: string[] = [];
  const serviceLevel = params.serviceLevel ?? DEFAULT_SERVICE_LEVEL;
  const z = zFromServiceLevel(serviceLevel);
  const avgDaily = params.avgDaily;
  const demandStdDev = params.demandStdDev;
  let totalLeadDays = params.totalLeadDays;

  if (totalLeadDays <= 0) {
    totalLeadDays = 1;
    flags.push('lead_time_fallback');
  }

  if (params.demandSource === 'forecast') flags.push('forecast_demand');
  if (params.stockoutAdjusted) flags.push('stockout_adjusted');

  const effectiveSalesDays = params.effectiveSalesDays ?? params.inStockDays ?? 0;
  if (effectiveSalesDays > 0 && effectiveSalesDays < LOW_SAMPLE_DAYS) {
    flags.push('low_sample');
  }

  if (avgDaily <= 0) {
    flags.push('no_sales');
    return {
      safetyStockQty: null,
      safetyStockDays: null,
      reorderPoint: null,
      method: 'z_demand',
      serviceLevel,
      avgDaily,
      demandStdDev,
      totalLeadDays,
      z,
      confidence: 'low',
      flags,
    };
  }

  const { safetyStockQty } = calcSafetyStockQty({
    method: 'z_demand',
    serviceLevel,
    demandStdDev,
    totalLeadDays,
  });

  let safetyStockDays = Math.ceil(safetyStockQty / avgDaily);
  let daysCapped = false;
  if (safetyStockDays > MAX_SUGGESTED_SAFETY_STOCK_DAYS) {
    safetyStockDays = MAX_SUGGESTED_SAFETY_STOCK_DAYS;
    daysCapped = true;
    flags.push('days_capped');
  }

  const reorderPoint = calcReorderPoint(avgDaily, totalLeadDays, safetyStockQty);
  const confidence = resolveConfidence({
    avgDaily,
    inStockDays: params.inStockDays ?? 0,
    effectiveSalesDays,
    stockoutAdjusted: params.stockoutAdjusted === true,
    demandSource: params.demandSource,
    daysCapped,
  });

  return {
    safetyStockQty,
    safetyStockDays,
    reorderPoint,
    method: 'z_demand',
    serviceLevel,
    avgDaily,
    demandStdDev,
    totalLeadDays,
    z,
    confidence,
    flags,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --import tsx --test server/lib/safety-stock-suggestion.test.ts`  
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/safety-stock-suggestion.ts apps/web/server/lib/safety-stock-suggestion.test.ts
git commit -m "feat: add read-only safety stock suggestion calculator"
```

---

### Task 2: 输入解析与 delta 组装

**Files:**
- Create: `apps/web/server/lib/safety-stock-suggestion-service.ts`
- Create: `apps/web/server/lib/safety-stock-suggestion-service.test.ts`

**Interfaces:**
- Consumes: `calcSafetyStockSuggestion`, `resolveHistoricalDemand` (from `inventory-health-service.ts`), `calcDailyStats`, `calcForwardAvgDaily`, `resolveLeadTimeForSkuWarehouse`, `loadDailySalesForSku`, `loadMergedPublishedForecastBySkuIds`
- Produces:

```ts
export type SafetyStockSuggestionRow = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: string;
  };
  suggested: import('./safety-stock-suggestion.js').SafetyStockSuggestion | null;
  deltaDays: number | null;
  deltaQty: number | null;
  deltaPctDays: number | null;
};

export function buildSuggestionRow(params: {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: SafetyStockSuggestionRow['configured'];
  suggested: import('./safety-stock-suggestion.js').SafetyStockSuggestion;
}): SafetyStockSuggestionRow;

export function sortSuggestionRows(
  rows: SafetyStockSuggestionRow[],
  sort: 'deltaDays_desc' | 'deltaDays_asc' | 'skuCode',
): SafetyStockSuggestionRow[];

export async function resolveSuggestionInputs(params: {
  sku: { id: string; merchantCode: string | null; leadTimeDays: number | null };
  warehouseCode: string;
  serviceLevel?: number;
  policy?: { safetyStockDays: number | null; safetyStockQty: number; reorderPoint: number; safetyStockMethod: string } | null;
}): Promise<SafetyStockSuggestionRow>;
```

实现要点：

1. 从 `loadDailySalesForSku` 取销量，按 `warehouseCode` 过滤；无仓级销量时暂用全量（本期不强制占比拆，打注释 TODO 与 share spec 对齐时可加 `unallocated_warehouse`）。
2. `calcDailyStats(whSales, 90)` 得 σ；样本 `< 2` 时用 `0.3 * avgDaily`。
3. 预测：`loadMergedPublishedForecastBySkuIds([skuId])` → 有 map 则 `demandSource='forecast'` + `calcForwardAvgDaily`。
4. 无预测：`resolveHistoricalDemand`（需 `loadDailyAvailability`，从 health service 抽相同查库逻辑或 inline 小函数）。
5. `resolveLeadTimeForSkuWarehouse` → `totalLeadDays`。
6. `configured`：policy 存在则用库值；`safetyStockDays` 缺省 **14**（与 schema default 一致）。
7. `buildSuggestionRow` 计算 delta：

```ts
deltaDays = suggested.safetyStockDays != null && configured.safetyStockDays != null
  ? suggested.safetyStockDays - configured.safetyStockDays
  : null;
deltaQty = suggested.safetyStockQty != null
  ? suggested.safetyStockQty - configured.safetyStockQty
  : null;
deltaPctDays = configured.safetyStockDays && deltaDays != null
  ? Math.abs(deltaDays) / configured.safetyStockDays
  : null;
```

- [ ] **Step 1: Write failing tests for buildSuggestionRow + sort**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSuggestionRow,
  sortSuggestionRows,
} from './safety-stock-suggestion-service.js';
import { calcSafetyStockSuggestion } from './safety-stock-suggestion.js';

describe('buildSuggestionRow', () => {
  it('computes delta fields', () => {
    const suggested = calcSafetyStockSuggestion({
      avgDaily: 10,
      demandStdDev: 4,
      totalLeadDays: 90,
      effectiveSalesDays: 60,
      inStockDays: 60,
    });
    const row = buildSuggestionRow({
      skuId: 'sku-1',
      skuCode: 'SKU-A',
      warehouseCode: 'US-WEST',
      configured: {
        safetyStockDays: 14,
        safetyStockQty: 280,
        reorderPoint: 1180,
        safetyStockMethod: 'coverage_days',
      },
      suggested,
    });
    assert.equal(row.deltaDays, -7);
    assert.equal(row.deltaQty, -217);
    assert.ok(row.deltaPctDays != null && row.deltaPctDays > 0.4);
  });
});

describe('sortSuggestionRows', () => {
  it('sorts by absolute deltaDays desc', () => {
    const rows = [
      buildSuggestionRow({
        skuId: 'a', skuCode: 'A', warehouseCode: 'ALL',
        configured: { safetyStockDays: 14, safetyStockQty: 100, reorderPoint: 200, safetyStockMethod: 'coverage_days' },
        suggested: calcSafetyStockSuggestion({ avgDaily: 10, demandStdDev: 4, totalLeadDays: 90, effectiveSalesDays: 60, inStockDays: 60 }),
      }),
      buildSuggestionRow({
        skuId: 'b', skuCode: 'B', warehouseCode: 'ALL',
        configured: { safetyStockDays: 14, safetyStockQty: 100, reorderPoint: 200, safetyStockMethod: 'coverage_days' },
        suggested: calcSafetyStockSuggestion({ avgDaily: 1, demandStdDev: 1, totalLeadDays: 30, effectiveSalesDays: 30, inStockDays: 30 }),
      }),
    ];
    const sorted = sortSuggestionRows(rows, 'deltaDays_desc');
    assert.equal(sorted[0]!.skuCode, 'A');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd apps/web && node --import tsx --test server/lib/safety-stock-suggestion-service.test.ts`

- [ ] **Step 3: Implement `buildSuggestionRow`, `sortSuggestionRows`, then `resolveSuggestionInputs`**

`resolveSuggestionInputs` 为 async，集成测试可留 Task 3；本 task 先完成纯组装 + 单测 GREEN。

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/safety-stock-suggestion-service.ts apps/web/server/lib/safety-stock-suggestion-service.test.ts
git commit -m "feat: add safety stock suggestion input resolver and row builder"
```

---

### Task 3: 只读 API 路由

**Files:**
- Modify: `apps/web/server/routes/safety-stock.ts`
- Create: `apps/web/server/routes/safety-stock-suggestion.test.ts`

**Interfaces:**
- Consumes: `resolveSuggestionInputs`, `sortSuggestionRows`, `SafetyStockSuggestionRow`
- Produces HTTP:
  - `GET /api/safety-stock/suggestions?warehouse=&limit=50&offset=0&serviceLevel=0.95&sort=deltaDays_desc`
  - `GET /api/safety-stock/:skuId/suggestion?warehouse=&serviceLevel=0.95`

**路由注册顺序**：在 `safety-stock.ts` 中，`GET /safety-stock/suggestions` 必须写在 `GET /safety-stock/:skuId/...` **之前**，避免 `suggestions` 被当成 skuId。

- [ ] **Step 1: Add route handlers**

```ts
// 在 safetyStockRoutes.get('/safety-stock', ...) 之后添加

safetyStockRoutes.get('/safety-stock/suggestions', async (c) => {
  const warehouse = c.req.query('warehouse')?.trim() || undefined;
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const serviceLevel = Number(c.req.query('serviceLevel') ?? 0.95);
  const sort = (c.req.query('sort') ?? 'deltaDays_desc') as
    | 'deltaDays_desc'
    | 'deltaDays_asc'
    | 'skuCode';

  const baseQuery = db
    .select({
      skuId: skus.id,
      skuCode: skus.code,
      merchantCode: skus.merchantCode,
      leadTimeDays: skus.leadTimeDays,
      warehouseCode: safetyStockConfig.warehouseCode,
      safetyStockDays: safetyStockConfig.safetyStockDays,
      safetyStockQty: safetyStockConfig.safetyStockQty,
      reorderPoint: safetyStockConfig.reorderPoint,
      safetyStockMethod: safetyStockConfig.safetyStockMethod,
    })
    .from(safetyStockConfig)
    .innerJoin(skus, eq(safetyStockConfig.skuId, skus.id))
    .where(eq(skus.isActive, true));

  const rows = warehouse
    ? await baseQuery.where(eq(safetyStockConfig.warehouseCode, warehouse))
    : await baseQuery;

  const slice = sortSuggestionRows(
    await Promise.all(
      rows.map((row) =>
        resolveSuggestionInputs({
          sku: {
            id: row.skuId,
            merchantCode: row.merchantCode,
            leadTimeDays: row.leadTimeDays,
          },
          warehouseCode: row.warehouseCode,
          serviceLevel,
          policy: row,
        }),
      ),
    ),
    sort,
  ).slice(offset, offset + limit);

  return c.json({ items: slice, limit, offset, total: rows.length });
});

safetyStockRoutes.get('/safety-stock/:skuId/suggestion', async (c) => {
  const skuId = c.req.param('skuId')!;
  const warehouseCode = resolveWarehouse(c);
  const serviceLevel = Number(c.req.query('serviceLevel') ?? 0.95);

  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return c.json({ message: 'SKU not found' }, 404);

  const [policy] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  const row = await resolveSuggestionInputs({
    sku: {
      id: sku.id,
      merchantCode: sku.merchantCode,
      leadTimeDays: sku.leadTimeDays,
    },
    warehouseCode,
    serviceLevel,
    policy: policy ?? null,
  });

  return c.json(row);
});
```

- [ ] **Step 2: Write route-level unit test (no DB)**

测试 `sort` 参数解析与 `buildSuggestionRow` 集成即可；DB 集成留人工验收。

```ts
// safety-stock-suggestion.test.ts — 复用 Task 2 的 sort/build 断言
```

- [ ] **Step 3: Manual smoke**

启动 dev server，请求：

```bash
curl -s "http://localhost:8787/api/safety-stock/suggestions?limit=5" | head
curl -s "http://localhost:8787/api/safety-stock/<skuId>/suggestion?warehouse=ALL"
```

确认：响应含 `configured`/`suggested`/`deltaDays`；重复请求后 `safety_stock_config.updated_at` **不变**。

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routes/safety-stock.ts apps/web/server/routes/safety-stock-suggestion.test.ts
git commit -m "feat: add read-only safety stock suggestion API"
```

---

### Task 4: 前端 API 与安全库存页

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/SafetyStockPage.tsx`

**Interfaces:**
- Consumes: `GET /api/safety-stock/suggestions`, existing `updateSafetyStock`
- Produces: UI 列 — 配置天数、建议天数、建议件数、偏差、置信度、采纳

- [ ] **Step 1: Add API client types and methods**

```ts
export type SafetyStockSuggestionView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: SafetyStockMethod;
  };
  suggested: {
    safetyStockQty: number | null;
    safetyStockDays: number | null;
    reorderPoint: number | null;
    confidence: 'high' | 'medium' | 'low';
    flags: string[];
  } | null;
  deltaDays: number | null;
  deltaQty: number | null;
  deltaPctDays: number | null;
};

getSafetyStockSuggestions: (params?: {
  warehouse?: string;
  serviceLevel?: number;
  sort?: string;
}) => request<{ items: SafetyStockSuggestionView[]; total: number }>(
  `/api/safety-stock/suggestions${buildQuery(params)}`,
),
```

- [ ] **Step 2: SafetyStockPage — parallel query**

```tsx
const [suggestionServiceLevel, setSuggestionServiceLevel] = useState(0.95);

const { data: suggestionResp } = useQuery({
  queryKey: ['safety-stock-suggestions', suggestionServiceLevel],
  queryFn: () => api.getSafetyStockSuggestions({ serviceLevel: suggestionServiceLevel, sort: 'deltaDays_desc' }),
});

const suggestionByKey = useMemo(() => {
  const map = new Map<string, SafetyStockSuggestionView>();
  for (const row of suggestionResp?.items ?? []) {
    map.set(`${row.skuId}::${row.warehouseCode}`, row);
  }
  return map;
}, [suggestionResp]);
```

- [ ] **Step 3: Add table columns**

| 配置天数 | 建议天数 | 建议件数 | 偏差 | 置信度 | 采纳 |
|----------|----------|----------|------|--------|------|
| `item.safetyStockDays ?? 14` | 只读 gray | 只读 gray | `{deltaDays} 天`，`|deltaPctDays|>0.5` 加 `text-amber-600` | 高/中/低 badge | 按钮：`setEditing` 填入 `safetyStockQty`、`reorderPoint`，若 suggested 有 days 则一并展示在 helper text（**不写 safetyStockDays 到 PUT 除非后端 PUT 已支持** — 检查 PUT body，若无 `safetyStockDays` 字段则仅采纳 qty/ROP，天数仅展示) |

检查 `PUT /safety-stock/:skuId`：若当前 body 不含 `safetyStockDays`，扩展 PUT 接受可选 `safetyStockDays`（小改，同 task）：

```ts
// safety-stock.ts PUT body 增加可选 safetyStockDays
safetyStockDays?: number;
```

- [ ] **Step 4: 顶部说明文案**

「建议值由 Z 值法推算（默认 95% 服务水平），采纳并保存前不影响预警与时间轴。」

- [ ] **Step 5: Manual UI check**

打开 `/inventory/safety`：见建议列；点采纳 → 编辑框变化 → 未保存前刷新仍回旧值；保存后 GET 列表更新。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/SafetyStockPage.tsx apps/web/server/routes/safety-stock.ts
git commit -m "feat: show read-only safety stock suggestions on inventory safety page"
```

---

## Spec coverage self-check

| Spec § | Task |
|--------|------|
| §2 决策摘要（Z、95%、cap 180、不写库） | Task 1–3 |
| §4 计算口径 | Task 1–2 |
| §5 API | Task 3 |
| §6 界面 | Task 4 |
| §7 分仓 / unallocated flag | Task 2（可选 flag，占比 TODO） |
| §9 验收 1–7 | Task 1 单测 + Task 3 smoke + Task 4 UI |
| §10 非范围 | 无对应 task（正确） |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-20-safety-stock-suggestion.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每 task 派 fresh subagent，task 间 review，迭代快

**2. Inline Execution** — 本会话用 executing-plans 按 task 批量实现，checkpoint Review

你想用哪种方式开始写代码？
