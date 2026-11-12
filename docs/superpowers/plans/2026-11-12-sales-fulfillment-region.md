# 销售区域 / 履约区域 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地显式区域映射，并将预测叶子改为「销售区域 × 渠道」、补货/健康/PMC 改为「履约区域 × 渠道」，一期区域 1:1、不做跨区供货。

**Architecture:** 新增站点/仓库映射表与解析库；预测行增加 `sales_region`（叶子写入，合并视图即时加总）；补货/预警/PMC 增加 `fulfillment_region` + `platform`，区域库存按渠道占比（预测优先否则历史）分摊。旧 `station=ALL` 预测版本只读，不参与新补货主路径。

**Tech Stack:** Drizzle/Postgres、Hono、React、TanStack Query、node:test（`pnpm --filter @scm/web exec tsx --test …`）

## Global Constraints

- Spec：`docs/superpowers/specs/2026-11-12-sales-fulfillment-region-design.md`
- 区域码：`US` | `CA` | `EU` | `UK` | `OTHER` | `UNMAPPED`；映射目标禁止 `UNMAPPED`
- 禁止按文案/国名启发式猜区；未映射 → `UNMAPPED`，不阻断
- 预测只存分区域×分渠道叶子；全区域/全渠道组合只加总
- 一期销售区域 = 履约区域（同码）；不做美加共仓
- 需求计划周、存销分析完整改造不在本计划
- Commit 步骤仅在用户明确要求提交时执行

## File Structure

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/region-codes.ts` | 区域枚举、校验、标签 |
| `apps/web/server/lib/region-mapping.ts` | 映射加载缓存、resolveStation/Warehouse |
| `apps/web/server/lib/region-mapping.test.ts` | 映射解析单测 |
| `apps/web/server/lib/forecast-region-rollup.ts` | 预测叶子加总四种组合 |
| `apps/web/server/lib/forecast-region-rollup.test.ts` | 加总守恒单测 |
| `apps/web/server/lib/region-channel-inventory.ts` | 区域库存×渠道分摊 |
| `apps/web/server/lib/region-channel-inventory.test.ts` | 分摊守恒单测 |
| `apps/web/server/lib/forecast-station-scope.ts` | 保留 ALL 语义给遗留版本；新区走 region |
| `apps/web/server/lib/forecast-collaboration.ts` | 基线按区域×渠道生成 |
| `apps/web/server/lib/forecast-published-resolve.ts` | 发布版按 sales_region 解析 |
| `apps/web/server/tasks/replenishmentForecast.ts` | 补货按履约区域×渠道 |
| `apps/web/server/lib/inventory-health-service.ts` | 健康按区域×渠道 |
| `apps/web/server/lib/pmc-plan.ts` | 采纳建议写入 fulfillment_region |
| `apps/web/server/routes/region-mapping.ts` | 映射 CRUD + CSV |
| `apps/web/server/lib/region-unmapped-scan.ts` | 未映射进数据问题队列 |
| `packages/db/src/schema/region-mapping.ts` | 两张映射表 |
| `packages/db/src/schema/inventory.ts` | `sales_forecast_monthly.sales_region` |
| `packages/db/src/schema/sales-forecast.ts` | accuracy/review 等补 `sales_region`（与月表对齐） |
| `packages/db/src/schema/reorder.ts` | suggestions/alerts 补区域与渠道 |
| `packages/db/src/schema/pmc.ts` | `pmc_plan_items.fulfillment_region` |
| `packages/db/src/schema/inventory-data-issues.ts` | 增加 `unmapped_station` 类型 |
| `packages/db/drizzle/0140_sales_fulfillment_region.sql` | 迁移 + 菜单 |
| `packages/db/src/seed.ts` | 菜单 `data.region_mapping` |
| `apps/web/src/pages/RegionMappingPage.tsx` | 映射配置页 |
| `apps/web/src/pages/SalesForecastListPage.tsx` 等 | 区域筛选与组合视图 |
| `apps/web/src/pages/*Suggestions*` / alerts / PMC | 区域×渠道列与筛选 |

## Execution Waves

| Wave | Tasks | 可独立验收 |
|------|-------|------------|
| 1 映射底座 | 1–3 | 配置页可用；解析库可测；未映射可告警 |
| 2 预测 | 4–5 | 新版本按区域×渠道出数；四种加总视图 |
| 3 补货闭环 | 6–8 | 补货/健康/PMC 吃新区口径 |

---

### Task 1: 区域码与映射解析（TDD）

**Files:**
- Create: `apps/web/server/lib/region-codes.ts`
- Create: `apps/web/server/lib/region-mapping.ts`
- Create: `apps/web/server/lib/region-mapping.test.ts`

**Interfaces:**
- Produces:
  - `export const MAPPABLE_REGIONS = ['US','CA','EU','UK','OTHER'] as const`
  - `export const RUNTIME_REGIONS = [...MAPPABLE_REGIONS, 'UNMAPPED'] as const`
  - `export type MappableRegion = (typeof MAPPABLE_REGIONS)[number]`
  - `export type RuntimeRegion = (typeof RUNTIME_REGIONS)[number]`
  - `export function isMappableRegion(code: string): code is MappableRegion`
  - `export function normalizeStationKey(raw: string): string` — trim，保留原文大小写策略与销量导入一致（建议 trim 后原样；比较时用精确匹配）
  - `export type RegionMappingTables = { stations: Map<string, MappableRegion>; warehouses: Map<string, MappableRegion> }`
  - `export function resolveSalesRegion(station: string | null | undefined, tables: RegionMappingTables): RuntimeRegion`
  - `export function resolveFulfillmentRegion(warehouseCode: string | null | undefined, tables: RegionMappingTables): RuntimeRegion`
  - `export async function loadRegionMappingTables(db): Promise<RegionMappingTables>` — 读库；可 60s 进程内缓存，提供 `invalidateRegionMappingCache()`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isMappableRegion,
  resolveSalesRegion,
  resolveFulfillmentRegion,
  type RegionMappingTables,
} from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([
    ['Amazon德国', 'EU'],
    ['wayfair英国', 'UK'],
  ]),
  warehouses: new Map([
    ['US-EAST', 'US'],
    ['PLATFORM-EU', 'EU'],
  ]),
};

describe('region-mapping', () => {
  it('rejects UNMAPPED as mappable', () => {
    assert.equal(isMappableRegion('UNMAPPED'), false);
    assert.equal(isMappableRegion('US'), true);
    assert.equal(isMappableRegion('OTHER'), true);
  });

  it('resolves mapped station and warehouse', () => {
    assert.equal(resolveSalesRegion('Amazon德国', tables), 'EU');
    assert.equal(resolveFulfillmentRegion('US-EAST', tables), 'US');
  });

  it('falls back to UNMAPPED without guessing', () => {
    assert.equal(resolveSalesRegion('Amazon比利时', tables), 'UNMAPPED');
    assert.equal(resolveSalesRegion('美国', tables), 'UNMAPPED');
    assert.equal(resolveFulfillmentRegion('CA-TORONTO', tables), 'UNMAPPED');
    assert.equal(resolveSalesRegion(null, tables), 'UNMAPPED');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/region-mapping.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `region-codes.ts` + `region-mapping.ts`（纯解析先不连库；`loadRegionMappingTables` 可先 stub 抛错或空实现，Task 2 后再接表）**

```ts
// region-codes.ts
export const MAPPABLE_REGIONS = ['US', 'CA', 'EU', 'UK', 'OTHER'] as const;
export const RUNTIME_REGIONS = ['US', 'CA', 'EU', 'UK', 'OTHER', 'UNMAPPED'] as const;
export type MappableRegion = (typeof MAPPABLE_REGIONS)[number];
export type RuntimeRegion = (typeof RUNTIME_REGIONS)[number];

export function isMappableRegion(code: string): code is MappableRegion {
  return (MAPPABLE_REGIONS as readonly string[]).includes(code.trim().toUpperCase());
}

export function parseMappableRegion(raw: string): MappableRegion | null {
  const code = raw.trim().toUpperCase();
  return isMappableRegion(code) ? (code as MappableRegion) : null;
}
```

```ts
// region-mapping.ts — resolve* 只用传入的 tables，禁止任何国名启发式
export function normalizeStationKey(raw: string): string {
  return raw.trim();
}

export function resolveSalesRegion(
  station: string | null | undefined,
  tables: RegionMappingTables,
): RuntimeRegion {
  if (!station?.trim()) return 'UNMAPPED';
  return tables.stations.get(normalizeStationKey(station)) ?? 'UNMAPPED';
}

export function resolveFulfillmentRegion(
  warehouseCode: string | null | undefined,
  tables: RegionMappingTables,
): RuntimeRegion {
  if (!warehouseCode?.trim()) return 'UNMAPPED';
  return tables.warehouses.get(warehouseCode.trim()) ?? 'UNMAPPED';
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/region-mapping.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/web/server/lib/region-codes.ts apps/web/server/lib/region-mapping.ts apps/web/server/lib/region-mapping.test.ts
git commit -m "feat(region): add region codes and mapping resolve helpers"
```

---

### Task 2: Schema / 迁移 / 菜单

**Files:**
- Create: `packages/db/src/schema/region-mapping.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/inventory.ts`（`salesForecastMonthly` 增加 `salesRegion`）
- Modify: `packages/db/src/schema/sales-forecast.ts`（`forecastAccuracyMonthly`、`salesForecastReviewItems` 等读写路径会用到的表增加 `salesRegion`，与月表一致；若某表本期不改读写可只改月表+准确率+评审）
- Modify: `packages/db/src/schema/reorder.ts` — `fulfillmentRegion`、`platform` on suggestions；alerts 同加 `fulfillmentRegion`、`platform`
- Modify: `packages/db/src/schema/pmc.ts` — `pmcPlanItems.fulfillmentRegion`
- Modify: `packages/db/src/schema/inventory-data-issues.ts` — enum 增加 `unmapped_station`（`unmapped_warehouse` 已存在则复用）
- Create: `packages/db/drizzle/0140_sales_fulfillment_region.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`（idx 121, tag `0140_sales_fulfillment_region`）
- Modify: `packages/db/src/seed.ts` — 菜单 `data.region_mapping` path `/data/region-mapping`

**Interfaces:**
- Consumes: Task 1 区域枚举
- Produces: 可迁移的表结构；`loadRegionMappingTables` 可读真实表

- [ ] **Step 1: 写 Drizzle schema**

```ts
// packages/db/src/schema/region-mapping.ts
export const stationSalesRegionMaps = pgTable(
  'station_sales_region_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    station: varchar('station', { length: 100 }).notNull(),
    salesRegion: varchar('sales_region', { length: 20 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stationUq: uniqueIndex('station_sales_region_maps_station_uidx').on(t.station),
  }),
);

export const warehouseFulfillmentRegionMaps = pgTable(
  'warehouse_fulfillment_region_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    fulfillmentRegion: varchar('fulfillment_region', { length: 20 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    whUq: uniqueIndex('warehouse_fulfillment_region_maps_wh_uidx').on(t.warehouseCode),
  }),
);
```

`sales_forecast_monthly` 增加：

```ts
salesRegion: varchar('sales_region', { length: 20 }).notNull().default('ALL'),
```

唯一索引改为 `(sku_id, sales_region, platform, forecast_year, month, version_id)`；保留 `station` 列：新行写 `station='ALL'` 作遗留标记，业务过滤用 `sales_region`。

`reorder_suggestions` / `stock_alerts`：

```ts
fulfillmentRegion: varchar('fulfillment_region', { length: 20 }),
platform: varchar('platform', { length: 50 }),
```

`pmc_plan_items.fulfillmentRegion` 同理。

- [ ] **Step 2: SQL 迁移要点**

```sql
CREATE TABLE station_sales_region_maps (...);
CREATE TABLE warehouse_fulfillment_region_maps (...);

ALTER TABLE sales_forecast_monthly
  ADD COLUMN sales_region varchar(20) NOT NULL DEFAULT 'ALL';
-- 存量：sales_region = 'ALL' 表示迁移前全站口径
DROP INDEX IF EXISTS sales_forecast_monthly_version_unique_idx;
CREATE UNIQUE INDEX sales_forecast_monthly_version_unique_idx
  ON sales_forecast_monthly (sku_id, sales_region, platform, forecast_year, month, version_id);

ALTER TABLE reorder_suggestions
  ADD COLUMN fulfillment_region varchar(20),
  ADD COLUMN platform varchar(50);
ALTER TABLE stock_alerts
  ADD COLUMN fulfillment_region varchar(20),
  ADD COLUMN platform varchar(50);
ALTER TABLE pmc_plan_items
  ADD COLUMN fulfillment_region varchar(20);

-- inventory_data_issue_type 增加 unmapped_station（按项目既有 enum 迁移写法）
-- menus: data.region_mapping
```

- [ ] **Step 3: 实现 `loadRegionMappingTables` + `invalidateRegionMappingCache`**

从两张映射表全量加载进 Map；写入/导入 API 成功后调用 invalidate。

- [ ] **Step 4: 本地应用迁移**（按仓库惯例执行 drizzle/migrate 或文档中的 SQL 应用方式）

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git commit -m "feat(region): add mapping tables and sales_region columns"
```

---

### Task 3: 映射配置 API + 页面 + 未映射扫描

**Files:**
- Create: `apps/web/server/routes/region-mapping.ts`
- Modify: `apps/web/server/index.ts` — mount `/api/region-mapping`
- Create: `apps/web/server/lib/region-unmapped-scan.ts`
- Modify: 数据问题扫描任务入口（现有 `inventory_data_issue_scan` 或并行挂钩）
- Create: `apps/web/src/pages/RegionMappingPage.tsx`
- Modify: `apps/web/src/router.tsx`、`apps/web/src/lib/api.ts`

**Interfaces:**
- `GET /api/region-mapping/stations` → `{ items: { station, salesRegion }[], unmappedStations: string[] }`
- `PUT /api/region-mapping/stations` body `{ station, salesRegion }` — `parseMappableRegion` 失败或 `UNMAPPED` → 400
- `POST /api/region-mapping/stations/import` CSV：`station,sales_region`
- 仓库端点对称：`/warehouses`
- `runUnmappedRegionScan(): Promise<{ stationIssues: number; warehouseIssues: number }>`

- [ ] **Step 1: 路由校验单测或轻量测试**（可对 `parseMappableRegion` + handler 校验函数）

```ts
it('rejects UNMAPPED as mapping target', () => {
  assert.equal(parseMappableRegion('UNMAPPED'), null);
  assert.equal(parseMappableRegion('eu'), 'EU');
});
```

- [ ] **Step 2: 实现 CRUD/导入；写成功后 `invalidateRegionMappingCache()`**

- [ ] **Step 3: 未映射扫描**

- 近 30/90 天 `sales_history` 中出现过的 `station`，`resolveSalesRegion` 为 UNMAPPED → upsert `unmapped_station` 问题  
- 活跃 `warehouses` / 库存出现过的仓码，履约解析 UNMAPPED → `unmapped_warehouse`  
- **不** throw、不阻断其它任务  

- [ ] **Step 4: 前端页** — 两个 Tab（站点/仓库）；表格编辑区域下拉（仅 MAPPABLE_REGIONS）；展示未映射列表；CSV 上传下载

- [ ] **Step 5: 手动验收** — 配一条站点→EU，解析变为 EU；删映射后回 UNMAPPED；尝试保存 UNMAPPED 应 400

- [ ] **Step 6: Commit**（仅当用户要求）

```bash
git commit -m "feat(region): mapping admin API/UI and unmapped scan"
```

---

### Task 4: 预测加总纯函数（TDD）

**Files:**
- Create: `apps/web/server/lib/forecast-region-rollup.ts`
- Create: `apps/web/server/lib/forecast-region-rollup.test.ts`

**Interfaces:**
- Produces:
  - `export type ForecastLeafRow = { skuId: string; salesRegion: string; platform: string; forecastYear: number; month: number; effectiveDailyAvg: number }`
  - `export type ForecastRollupView = 'region_platform' | 'region_all_platforms' | 'all_regions_platform' | 'all_regions_all_platforms'`
  - `export function rollupForecastLeaves(leaves: ForecastLeafRow[], view: ForecastRollupView): Array<{ skuId: string; salesRegion: string | 'ALL'; platform: string | 'ALL'; forecastYear: number; month: number; effectiveDailyAvg: number }>`

加总键：

| view | groupBy |
|------|---------|
| `region_platform` | sku, region, platform, y, m |
| `region_all_platforms` | sku, region, y, m → platform=`ALL` |
| `all_regions_platform` | sku, platform, y, m → salesRegion=`ALL` |
| `all_regions_all_platforms` | sku, y, m → 两者 `ALL` |

忽略 `salesRegion === 'ALL'` 的遗留叶子（不进入新区加总，避免双计）。

- [ ] **Step 1: 写失败测试**

```ts
const leaves = [
  { skuId: 's1', salesRegion: 'US', platform: 'AMAZON', forecastYear: 2026, month: 11, effectiveDailyAvg: 10 },
  { skuId: 's1', salesRegion: 'US', platform: 'WALMART', forecastYear: 2026, month: 11, effectiveDailyAvg: 5 },
  { skuId: 's1', salesRegion: 'EU', platform: 'AMAZON', forecastYear: 2026, month: 11, effectiveDailyAvg: 4 },
  { skuId: 's1', salesRegion: 'ALL', platform: 'AMAZON', forecastYear: 2026, month: 11, effectiveDailyAvg: 99 },
];

it('region_all_platforms sums channels', () => {
  const rows = rollupForecastLeaves(leaves, 'region_all_platforms');
  const us = rows.find((r) => r.salesRegion === 'US')!;
  assert.equal(us.effectiveDailyAvg, 15);
  assert.equal(us.platform, 'ALL');
});

it('all_regions_platform sums regions', () => {
  const rows = rollupForecastLeaves(leaves, 'all_regions_platform');
  const amz = rows.find((r) => r.platform === 'AMAZON')!;
  assert.equal(amz.effectiveDailyAvg, 14); // 10+4, ignores legacy 99
  assert.equal(amz.salesRegion, 'ALL');
});

it('grand total', () => {
  const rows = rollupForecastLeaves(leaves, 'all_regions_all_platforms');
  assert.equal(rows[0]!.effectiveDailyAvg, 19);
});
```

- [ ] **Step 2: 实现并跑通测试**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-region-rollup.test.ts`

- [ ] **Step 3: Commit**（仅当用户要求）

---

### Task 5: 基线生成与发布解析切到销售区域 × 渠道

**Files:**
- Modify: `apps/web/server/lib/forecast-collaboration.ts`（`generateBaselineForStationPlatform` → 按区域循环或内层按 region 聚合销量）
- Modify: 销量训练聚合路径（查找将 `sales_history` 聚成月序列处，按 `resolveSalesRegion(station)` 分组，而不是丢弃站点打成 ALL）
- Modify: `apps/web/server/lib/forecast-published-resolve.ts`、`forecast-demand.ts`、`forecast-aggregate-guard.ts` — 护栏按项目组×**sales_region**×月
- Modify: `apps/web/server/routes/sales-forecast.ts` — list/detail 支持 `salesRegion`、`rollupView`；遗留版本 `sales_region=ALL` 只读提示
- Modify: 前端预测列表/详情/抽屉 — 区域筛选 + 四种 rollup 视图（调用加总或服务端 rollup）

**Interfaces:**
- 新基线写入：`salesRegion ∈ RUNTIME_REGIONS`（含 UNMAPPED/OTHER），`station='ALL'`，`platform` 仍为 V4.1 渠道码
- `generateBaselineForecastVersion`：对映射后出现的每个 region×platform 生成叶子（无销量的组合可跳过）
- 发布 Champion：补货侧只消费 `sales_region <> 'ALL'` 的已发布叶子

- [ ] **Step 1: 定位销量→月序列聚合函数，改为 region 桶**

伪代码：

```ts
for (const row of salesHistoryRows) {
  const region = resolveSalesRegion(row.station, tables);
  const platform = normalizeSalesPlatform(row.channel);
  bucketKey = `${skuId}|${region}|${platform}|${year}|${month}`;
  // accumulate qty
}
```

- [ ] **Step 2: 改 `generateBaselineForStationPlatform` 签名为 region**

写入 `salesForecastMonthly` 时设置 `salesRegion: region`，`station: 'ALL'`。

- [ ] **Step 3: 准确率实际值同样经站点映射归区后对比**

- [ ] **Step 4: API + UI 筛选 `salesRegion`；`rollupView` 用 Task 4**

遗留版本（行上仅有 `sales_region='ALL'`）：列表 badge「迁移前全站口径」；禁止作为新补货需求源。

- [ ] **Step 5: 生成一版小范围草稿，抽查：同 SKU 多区域行之和 = 手工加总；全渠道视图 = 各渠道之和**

- [ ] **Step 6: Commit**（仅当用户要求）

```bash
git commit -m "feat(forecast): generate and query by sales_region × platform"
```

---

### Task 6: 区域 × 渠道库存分摊（TDD）

**Files:**
- Create: `apps/web/server/lib/region-channel-inventory.ts`
- Create: `apps/web/server/lib/region-channel-inventory.test.ts`

**Interfaces:**
- Consumes: 可复用 `allocateByShare`（`inventory-share-allocation.ts`）或自写最大余数
- Produces:
  - `export const CHANNEL_SHARE_HISTORY_DAYS = 90`
  - `export function allocateRegionInventoryByChannel(params: { regionQty: number; channelWeights: Record<string, number> }): Record<string, number>`
  - `export function resolveChannelWeights(params: { forecastQtyByPlatform: Record<string, number>; historyQtyByPlatform: Record<string, number> }): { source: 'forecast' | 'history' | 'empty'; weights: Record<string, number> }`

规则：

1. 若 forecast 各渠道合计 > 0 → 用预测占比，`source='forecast'`  
2. 否则 history > 0 → 历史占比  
3. 否则 `empty`，调用方跳过或均分（补货侧：**跳过该渠道单元**）

- [ ] **Step 1: 测试守恒与优先级**

```ts
it('prefers forecast weights', () => {
  const { source, weights } = resolveChannelWeights({
    forecastQtyByPlatform: { AMAZON: 80, WALMART: 20 },
    historyQtyByPlatform: { AMAZON: 1, WALMART: 99 },
  });
  assert.equal(source, 'forecast');
  assert.ok(Math.abs(weights.AMAZON! - 0.8) < 1e-9);
});

it('allocates integers conserving sum', () => {
  const out = allocateRegionInventoryByChannel({
    regionQty: 10,
    channelWeights: { AMAZON: 0.5, WALMART: 0.5 },
  });
  assert.equal(out.AMAZON! + out.WALMART!, 10);
});
```

- [ ] **Step 2: 实现并 PASS**

- [ ] **Step 3: Commit**（仅当用户要求）

---

### Task 7: 补货建议与健康/预警切履约区域 × 渠道

**Files:**
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Modify: `apps/web/server/lib/inventory-health-service.ts`（及时间轴/需求解析调用链）
- Modify: `apps/web/server/lib/forecast-published-resolve.ts` / demand loader — 按 `salesRegion`+`platform` 取需求；履约区域一期 = 销售区域
- Modify: 补货建议列表 API + 前端（`fulfillmentRegion`、`platform` 列与筛选）
- Modify: stock alert 写入带区域/渠道

**Interfaces:**
- 对每个活跃 SKU × 每个出现的履约区域 × 有需求的 platform：  
  1. `regionQty` = 该区域下仓库有效供给之和（仓→`resolveFulfillmentRegion`）  
  2. `allocateRegionInventoryByChannel`  
  3. 需求 = 发布叶子 `(salesRegion=region, platform)`；若无叶子则同区同渠道历史日均  
  4. 写 `reorder_suggestions`：`fulfillmentRegion`、`platform`、可选 `warehouseCode`（区内拆分）  
- `sales_region='ALL'` 的旧 Champion **不**再驱动补货  
- US 区内互调延后：仅 `fulfillmentRegion==='US'` 的物理仓集合上沿用 `shouldDeferReplenishment`

- [ ] **Step 1: 改健康计算入口参数为 `{ skuId, fulfillmentRegion, platform }`**（或内部循环展开）

- [ ] **Step 2: 改补货任务主循环；metrics 记录 `channelShareSource`、`demandShare` 区域口径**

- [ ] **Step 3: 前端补货/预警筛选**

- [ ] **Step 4: 用映射好的小样本跑一轮补货任务，确认 UNMAPPED 也有建议且不抛错**

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git commit -m "feat(reorder): replenish and health by fulfillment_region × platform"
```

---

### Task 8: PMC 落仓带履约区域

**Files:**
- Modify: `apps/web/server/lib/pmc-plan.ts`（及 suggestions accept 路由）
- Modify: PMC 计划详情/列表前端 — 展示 `fulfillmentRegion`；`UNMAPPED` 警告文案，确认不 403
- Modify: 若有目的仓校验，允许仓为空但区域为 UNMAPPED

**Interfaces:**
- 采纳建议 → `pmc_plan_items.fulfillmentRegion = suggestion.fulfillmentRegion`；`warehouseCode = suggestion.warehouseCode ?? null`
- 确认计划：不因 UNMAPPED 阻断；响应/UI 带 `warnings: ['fulfillment_region_unmapped']`

- [ ] **Step 1: 改 accept→PMC 写入字段**

- [ ] **Step 2: UI 警告**

- [ ] **Step 3: 手动：未映射建议可采纳并确认计划**

- [ ] **Step 4: Commit**（仅当用户要求）

```bash
git commit -m "feat(pmc): persist fulfillment_region on plan items"
```

---

## Spec Coverage Checklist

| Spec 项 | Task |
|---------|------|
| 显式站点/仓映射、禁猜区、禁目标 UNMAPPED | 1–3 |
| OTHER vs UNMAPPED | 1, 3 |
| 未映射不阻断 + 数据问题 | 3, 7–8 |
| 预测叶子区域×渠道 + 四种加总 | 4–5 |
| 旧 ALL 只读、不进新补货 | 5, 7 |
| 补货区域×渠道 + 库存分摊预测优先 | 6–7 |
| 健康/预警同维度 | 7 |
| PMC 落仓 + UNMAPPED 可确认 | 8 |
| 需求计划/存销分析 | 刻意不做（非目标） |
| 美加共仓 | 刻意不做 |

## Self-Review Notes

- 无 TBD；迁移号 `0140`（若落地时 journal 已有更新，顺延下一号并改本计划文件名引用）
- `sales_region='ALL'` 仅表示迁移前口径，不在 `MAPPABLE_REGIONS` / 映射目标中
- 类型名 `fulfillmentRegion` / `salesRegion` 在 Tasks 2–8 保持一致
