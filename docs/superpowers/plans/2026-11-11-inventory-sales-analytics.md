# 存销分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地独立「存销分析」页：日预聚合 SKU×物理仓行表，展示分仓库存/分摊销量/覆盖·动销/风险，供计划与运营共用。

**Architecture:** 在库存周转可用且日流水线（08:50，晚于销量拉取 08:35）中重建 `inventory_sales_cube_runs` + `inventory_sales_cube_rows`；库存口径与 `resolveInventoryPosition` / 销售占比同构；分仓明细仅 SKU 抽屉对账。列表分页 API + `summary` KPI；导出走下载中心。

**Tech Stack:** Drizzle/Postgres、Hono、React、TanStack Query、node:test、既有下载中心

## Global Constraints

- Spec：`docs/superpowers/specs/2026-11-11-inventory-sales-analytics-design.md`
- 主粒度：`sku_id × warehouse_code`；站点/国家仅筛选
- 分仓销量：周转销售占比分摊（`parseSharesFromSnapshot` + `allocateByShare`）
- 覆盖：历史 `avg_daily_30d`；一期不做预测对照
- 不改预测发布、补货引擎、周转/查询拉取语义；不写飞书
- 主触发：`daily_inventory_pipeline` 内、周转当日已发布时 rebuild；未发布则跳过并保留上一 ready
- Commit 步骤仅在用户明确要求提交时执行

## File Structure

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/inventory-sales-metrics.ts` | 纯函数：销量分摊窗口、cover、动销率、风险标签 |
| `apps/web/server/lib/inventory-sales-metrics.test.ts` | 指标单测 |
| `apps/web/server/lib/inventory-sales-cube.ts` | rebuild / status / listRows / skuDetail / 并发锁 |
| `apps/web/server/lib/inventory-sales-cube.test.ts` | 构建切片、并发、失败保留 ready |
| `apps/web/server/routes/inventory-sales-analytics.ts` | HTTP API |
| `apps/web/server/tasks/inventorySalesCubeRebuild.ts` | Cron 任务包装 |
| `apps/web/server/routes/tasks.ts` | 挂载 task 路由 |
| `apps/web/server/tasks/dailyInventoryPipeline.ts` | 流水线挂钩 |
| `apps/web/server/index.ts` | 挂载业务路由 |
| `apps/web/server/lib/download-exporters.ts` | `inventory_sales_analytics` 导出 |
| `apps/web/src/lib/scheduled-tasks.ts` | 任务目录文案（可选手动） |
| `packages/db/src/schema/inventory-sales-analytics.ts` | runs / rows 表 |
| `packages/db/src/schema/index.ts` | export |
| `packages/db/drizzle/0138_inventory_sales_analytics.sql` | 表 + 菜单 + role_menus |
| `packages/db/drizzle/meta/_journal.json` | 登记 0138 |
| `packages/db/src/seed.ts` | 新环境菜单 |
| `apps/web/src/lib/api.ts` | 客户端 |
| `apps/web/src/pages/InventorySalesAnalyticsPage.tsx` | 页面 |
| `apps/web/src/router.tsx` | 路由 |

---

### Task 1: 存销纯函数指标（TDD）

**Files:**
- Create: `apps/web/server/lib/inventory-sales-metrics.ts`
- Create: `apps/web/server/lib/inventory-sales-metrics.test.ts`

**Interfaces:**
- Consumes: `allocateByShare`, `parseSharesFromSnapshot`, `ShareParseResult`（`inventory-share-allocation.ts`）；`isSlowMovingStock`, `isGrayLifecycle`（`inventory-light.ts`）；`REPLENISHMENT_DEFAULTS`
- Produces:
  - `InventorySalesRiskTag = 'stockout_risk' | 'slow_moving' | 'imbalance' | 'unallocated'`
  - `allocateSalesWindows(params: { sales7d: number; sales14d: number; sales30d: number; share: ShareParseResult }): Map<string, { sales7d: number; sales14d: number; sales30d: number; shareWeight: number }>`
  - `calcCoverDays(effectiveQty: number, avgDaily30d: number): number | null`
  - `calcSellThrough30d(sales30d: number, effectiveQty: number): number | null`
  - `buildRiskTags(params: { shareMethod: 'sales_share' | 'unallocated' | 'native_warehouse'; effectiveQty: number; coverDays: number | null; avgDaily30d: number; lifecycle?: string | null; totalLeadDays: number; peerCoverDays: Array<number | null>; overstockThresholdDays?: number }): { tags: InventorySalesRiskTag[]; primaryRisk: InventorySalesRiskTag | null }`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateSalesWindows,
  calcCoverDays,
  calcSellThrough30d,
  buildRiskTags,
} from './inventory-sales-metrics.js';
import type { ShareParseResult } from './inventory-share-allocation.js';

const share: ShareParseResult = {
  method: 'sales_share',
  shareSum: 1,
  shareSumWarning: false,
  weights: [
    { warehouse: 'US-EAST', weight: 0.6 },
    { warehouse: 'US-WEST', weight: 0.4 },
  ],
};

describe('inventory-sales-metrics', () => {
  it('allocates sales windows by share and preserves sum', () => {
    const map = allocateSalesWindows({
      sales7d: 10,
      sales14d: 20,
      sales30d: 100,
      share,
    });
    const east = map.get('US-EAST')!;
    const west = map.get('US-WEST')!;
    assert.equal(east.sales30d + west.sales30d, 100);
    assert.equal(east.sales7d + west.sales7d, 10);
    assert.ok(Math.abs(east.shareWeight - 0.6) < 1e-9);
  });

  it('returns empty map when unallocated', () => {
    const map = allocateSalesWindows({
      sales7d: 10,
      sales14d: 20,
      sales30d: 100,
      share: { method: 'unallocated', shareSum: 0, shareSumWarning: false, weights: [] },
    });
    assert.equal(map.size, 0);
  });

  it('cover and sell-through null on zero demand / zero denom', () => {
    assert.equal(calcCoverDays(100, 0), null);
    assert.equal(calcCoverDays(100, 10), 10);
    assert.equal(calcSellThrough30d(0, 0), null);
    assert.equal(calcSellThrough30d(30, 70), 0.3);
  });

  it('risk priority stockout > slow > imbalance > unallocated', () => {
    const r1 = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 10,
      coverDays: 5,
      avgDaily30d: 2,
      totalLeadDays: 30,
      peerCoverDays: [5, 200],
    });
    assert.equal(r1.primaryRisk, 'stockout_risk');

    const r2 = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 100,
      coverDays: 120,
      avgDaily30d: 0.05,
      totalLeadDays: 30,
      peerCoverDays: [120],
    });
    assert.equal(r2.primaryRisk, 'slow_moving');

    const r3 = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 50,
      coverDays: 20,
      avgDaily30d: 2,
      totalLeadDays: 30,
      peerCoverDays: [20, 200],
      overstockThresholdDays: 180,
    });
    assert.ok(r3.tags.includes('imbalance'));
    assert.equal(r3.primaryRisk, 'stockout_risk'); // 20 ≤ 30

    const r4 = buildRiskTags({
      shareMethod: 'unallocated',
      effectiveQty: 80,
      coverDays: null,
      avgDaily30d: 0,
      totalLeadDays: 30,
      peerCoverDays: [null],
    });
    assert.equal(r4.primaryRisk, 'unallocated');
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-sales-metrics.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
import { allocateByShare, type ShareParseResult } from './inventory-share-allocation.js';
import { isGrayLifecycle, isSlowMovingStock } from './inventory-light.js';
import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';

export type InventorySalesRiskTag =
  | 'stockout_risk'
  | 'slow_moving'
  | 'imbalance'
  | 'unallocated';

export function allocateSalesWindows(params: {
  sales7d: number;
  sales14d: number;
  sales30d: number;
  share: ShareParseResult;
}): Map<string, { sales7d: number; sales14d: number; sales30d: number; shareWeight: number }> {
  if (params.share.method !== 'sales_share' || params.share.weights.length === 0) {
    return new Map();
  }
  const a7 = allocateByShare(params.sales7d, params.share);
  const a14 = allocateByShare(params.sales14d, params.share);
  const a30 = allocateByShare(params.sales30d, params.share);
  const out = new Map<
    string,
    { sales7d: number; sales14d: number; sales30d: number; shareWeight: number }
  >();
  for (const w of params.share.weights) {
    out.set(w.warehouse, {
      sales7d: a7.get(w.warehouse) ?? 0,
      sales14d: a14.get(w.warehouse) ?? 0,
      sales30d: a30.get(w.warehouse) ?? 0,
      shareWeight: w.weight,
    });
  }
  return out;
}

export function calcCoverDays(effectiveQty: number, avgDaily30d: number): number | null {
  if (!(avgDaily30d > 0)) return null;
  return effectiveQty / avgDaily30d;
}

export function calcSellThrough30d(sales30d: number, effectiveQty: number): number | null {
  const denom = sales30d + effectiveQty;
  if (!(denom > 0)) return null;
  return sales30d / denom;
}

export function buildRiskTags(params: {
  shareMethod: 'sales_share' | 'unallocated' | 'native_warehouse';
  effectiveQty: number;
  coverDays: number | null;
  avgDaily30d: number;
  lifecycle?: string | null;
  totalLeadDays: number;
  peerCoverDays: Array<number | null>;
  overstockThresholdDays?: number;
}): { tags: InventorySalesRiskTag[]; primaryRisk: InventorySalesRiskTag | null } {
  const overstock =
    params.overstockThresholdDays ?? REPLENISHMENT_DEFAULTS.overstockThresholdDays;
  const tags: InventorySalesRiskTag[] = [];

  if (
    params.coverDays != null &&
    Number.isFinite(params.coverDays) &&
    params.coverDays <= params.totalLeadDays
  ) {
    tags.push('stockout_risk');
  }

  if (
    isGrayLifecycle(params.lifecycle) ||
    (params.coverDays != null &&
      isSlowMovingStock({
        effectiveQty: params.effectiveQty,
        avgDaily: params.avgDaily30d,
        coverageDays: params.coverDays,
      }))
  ) {
    tags.push('slow_moving');
  }

  const hasLow = params.peerCoverDays.some(
    (d) => d != null && Number.isFinite(d) && d <= params.totalLeadDays,
  );
  const hasHigh = params.peerCoverDays.some(
    (d) => d != null && Number.isFinite(d) && d >= overstock,
  );
  if (hasLow && hasHigh) tags.push('imbalance');

  if (params.shareMethod === 'unallocated' && params.effectiveQty > 0) {
    tags.push('unallocated');
  }

  const order: InventorySalesRiskTag[] = [
    'stockout_risk',
    'slow_moving',
    'imbalance',
    'unallocated',
  ];
  const primaryRisk = order.find((t) => tags.includes(t)) ?? null;
  return { tags, primaryRisk };
}
```

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-sales-metrics.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add apps/web/server/lib/inventory-sales-metrics.ts apps/web/server/lib/inventory-sales-metrics.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory-sales): add pure metrics for share sales and risk tags

EOF
)"
```

---

### Task 2: Schema、迁移与菜单

**Files:**
- Create: `packages/db/src/schema/inventory-sales-analytics.ts`
- Modify: `packages/db/src/schema/index.ts`（`export * from './inventory-sales-analytics'`）
- Create: `packages/db/drizzle/0138_inventory_sales_analytics.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`（idx 119, tag `0138_inventory_sales_analytics`）
- Modify: `packages/db/src/seed.ts`（`data` 子菜单 + `DATA_MENU_CODES`）

**Interfaces:**
- Produces: Drizzle tables `inventorySalesCubeRuns`, `inventorySalesCubeRows`；菜单 code `data.inventory_sales_analytics`

- [ ] **Step 1: 写 schema**

```ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  date,
  integer,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { skus } from './products';

export type InventorySalesCubeMeta = {
  warehouses: string[];
  thresholds: {
    overstockThresholdDays: number;
    slowMovingDailyMax: number;
    slowMovingMinCoverageDays: number;
    version: string;
  };
  sourceStats?: Record<string, number | string | null>;
};

export const inventorySalesCubeRuns = pgTable(
  'inventory_sales_cube_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotDate: date('snapshot_date').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    sourceTurnoverDate: date('source_turnover_date'),
    sourceSalesAsOf: date('source_sales_as_of'),
    rowCount: integer('row_count'),
    meta: jsonb('meta').$type<InventorySalesCubeMeta>(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCreatedIdx: index('inventory_sales_cube_runs_status_created_idx').on(
      t.status,
      t.createdAt,
    ),
    snapshotIdx: index('inventory_sales_cube_runs_snapshot_date_idx').on(t.snapshotDate),
  }),
);

export const inventorySalesCubeRows = pgTable(
  'inventory_sales_cube_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => inventorySalesCubeRuns.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    skuCode: varchar('sku_code', { length: 64 }).notNull(),
    warehouseCode: varchar('warehouse_code', { length: 32 }).notNull(),
    productScope: varchar('product_scope', { length: 32 }).notNull(),
    category: text('category'),
    lifecycle: varchar('lifecycle', { length: 64 }),
    salesCountry: varchar('sales_country', { length: 64 }),
    qtyAvailable: integer('qty_available').notNull().default(0),
    qtyInTransit: integer('qty_in_transit').notNull().default(0),
    effectiveQty: integer('effective_qty').notNull().default(0),
    shareMethod: varchar('share_method', { length: 32 }).notNull(),
    shareWeight: doublePrecision('share_weight'),
    sales7d: integer('sales_7d'),
    sales14d: integer('sales_14d'),
    sales30d: integer('sales_30d'),
    avgDaily30d: doublePrecision('avg_daily_30d'),
    coverDays: doublePrecision('cover_days'),
    sellThrough30d: doublePrecision('sell_through_30d'),
    primaryRisk: varchar('primary_risk', { length: 32 }),
    riskTags: jsonb('risk_tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('inventory_sales_cube_rows_run_sku_wh_uidx').on(
      t.runId,
      t.skuId,
      t.warehouseCode,
    ),
    riskIdx: index('inventory_sales_cube_rows_run_risk_idx').on(t.runId, t.primaryRisk),
    whIdx: index('inventory_sales_cube_rows_run_wh_idx').on(t.runId, t.warehouseCode),
    skuIdx: index('inventory_sales_cube_rows_run_sku_idx').on(t.runId, t.skuCode),
  }),
);
```

确认 `skus` 实际从 `@scm/db` 产品 schema 路径导入（与 `packages/db/src/schema` 现有 `products` / `skus` 文件一致；若文件名不同，按现网 import）。

- [ ] **Step 2: SQL 迁移 0138**

包含：`CREATE TABLE` runs/rows + 索引；菜单：

```sql
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.inventory_sales_analytics', '存销分析', '/data/inventory-sales-analytics', p."id", 15, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m."code" = 'data.inventory_sales_analytics'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
```

（角色集合对齐 `0072_sales_analytics_cube.sql`：计划 `pmc_planner` + 含运营向的 `warehouse`/`purchaser`/`viewer`。）

- [ ] **Step 3: journal + seed**

- `_journal.json` 追加 idx 119 / tag `0138_inventory_sales_analytics`  
- `seed.ts`：`data` children 增加 sortOrder 15「存销分析」；`DATA_MENU_CODES` 加入 `data.inventory_sales_analytics`

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @scm/db exec tsc --noEmit`（或仓库惯用 db 包检查命令）  
Expected: 无新增错误

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add packages/db/src/schema/inventory-sales-analytics.ts packages/db/src/schema/index.ts packages/db/drizzle/0138_inventory_sales_analytics.sql packages/db/drizzle/meta/_journal.json packages/db/src/seed.ts
git commit -m "$(cat <<'EOF'
feat(db): add inventory sales analytics cube tables and menu

EOF
)"
```

---

### Task 3: Cube 重建与查询服务

**Files:**
- Create: `apps/web/server/lib/inventory-sales-cube.ts`
- Create: `apps/web/server/lib/inventory-sales-cube.test.ts`

**Interfaces:**
- Consumes: Task1 metrics；`getShanghaiBusinessDate`；`readTurnoverSnapshot` / 最新 `inventory_records`；`parseSharesFromSnapshot`；`resolveInventoryPositionFromSnapshot` + OVERSEAS 分摊（对齐 `inventory-position` 规划路径，**批量**加载，禁止对每仓 `await resolveInventoryPosition` N+1）；`salesHistory` 按 sku 聚合 7/14/30；`loadLeadTimeResolveCaches` + `resolveLeadTimeFromCaches`；`isAccessorySku` / `productScope`；`REPLENISHMENT_DEFAULTS`
- Produces:
  - `rebuildInventorySalesCube(opts?: { actorId?: string | null; force?: boolean }): Promise<{ runId: string; status: 'ready' | 'failed' | 'skipped'; rowCount?: number; message?: string }>`
  - `getInventorySalesCubeStatus(): Promise<StatusDto>`
  - `listInventorySalesCubeRows(filters): Promise<{ items; total; page; pageSize; summary; meta }>`
  - `getInventorySalesCubeSkuDetail(skuId: string): Promise<{ rows; queryReconcile: null | { available: boolean; note?: string; highlights?: Record<string, string> } }>`
  - `clearStaleRunningInventorySalesCubeRuns(now?, maxAgeMs?): Promise<number>` — TTL 对齐销售分析 10min

**重建算法（实现必须遵守）:**

1. `clearStaleRunning…`；若仍有 `running` 且非 force → 抛错或返回 skipped（HTTP 层映射 409）  
2. 插入 `running` run（`snapshot_date = getShanghaiBusinessDate()`）  
3. 若当日无 published 周转快照 → `failed` 或 `skipped`（消息「源周转未发布」），**不删**上一 ready  
4. 加载全量相关 SKU（周转日快照行 / 有 inventory_records 的 SKU）+ encoding_meta 占比 + 各仓最新 inventory_records  
5. 批量查 `sales_history`：业务日前推 30 天窗口，按 `sku_id` 汇总 7/14/30（`sale_date` 闭区间）  
6. 对每个 SKU：解析 share；对每个目标仓算 effective（本仓记录优先，否则 OVERSEAS×weight；无 share 则单行 OVERSEAS + unallocated）；分摊销量；算 cover / sell-through  
7. SKU 内收集 peer `coverDays` 后二次打风险标签  
8. 批量 insert rows；run → `ready`；可选清理只保留最近 N 次 ready/failed（建议 10）  
9. catch → run `failed` + `error_message`，保留上一 ready

- [ ] **Step 1: 写失败测试（纯函数可测切片 + 并发语义）**

在 `inventory-sales-cube.ts` 导出可测 helper，例如：

```ts
export function buildCubeRowsForSku(input: {
  skuId: string;
  skuCode: string;
  productScope: string;
  category: string | null;
  lifecycle: string | null;
  salesCountry: string | null;
  share: ShareParseResult;
  overseasAvailable: number;
  overseasInTransit: number;
  nativeByWarehouse: Map<string, { qtyAvailable: number; qtyInTransit: number; qtyInProduction?: number }>;
  sales7d: number;
  sales14d: number;
  sales30d: number;
  totalLeadDaysByWarehouse: Map<string, number>;
  defaultTotalLeadDays: number;
}): Array<{ warehouseCode: string; effectiveQty: number; sales30d: number | null; primaryRisk: string | null }>;
```

测试用例：

1. 有占比：两仓行，sales30d 之和 = SKU 销量  
2. 无占比 + overseas>0：仅 OVERSEAS，`primaryRisk` 含 unallocated 路径  
3. 无销量：`sales30d`/`coverDays` 为 null  

并发测试：mock db 或用内存状态机测「第二 rebuild 在 running 时拒绝」（若集成测成本高，至少测 `assertNoRunningCube` 纯逻辑）。

- [ ] **Step 2: 跑测失败 → Step 3 实现 → Step 4 通过**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-sales-cube.test.ts server/lib/inventory-sales-metrics.test.ts`  
Expected: PASS

实现要点：

- `listInventorySalesCubeRows`：取最新 `ready` run；筛选 `q`（sku_code ilike）、`warehouseCode`、`category`、`lifecycle`、`primaryRisk`、`productScope`、`salesCountry`；`summary` 用同筛选条件 `count(*) filter` 统计各 risk（可用 SQL 或内存二次聚合，数据量约 5800×仓，优先 SQL）  
- `getInventorySalesCubeSkuDetail`：同 run 下该 sku 全部仓行；`queryReconcile` 调既有 inventory-query 只读摘要，缺失则 `{ available: false, note: '无查询快照' }`

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 4: HTTP 路由 + 下载导出

**Files:**
- Create: `apps/web/server/routes/inventory-sales-analytics.ts`
- Modify: `apps/web/server/index.ts`
- Modify: `apps/web/server/lib/download-exporters.ts`（注册 `inventory_sales_analytics`）
- Modify: `apps/web/server/routes/inventory-sales-analytics.ts` 内 export 创建下载任务（对齐 `inventory.ts` overview export）

**Interfaces:**
- Menu guard: `requireMenu('data.inventory_sales_analytics')`
- Routes:
  - `GET /inventory-sales-analytics/status`
  - `GET /inventory-sales-analytics/rows`
  - `GET /inventory-sales-analytics/sku/:skuId`
  - `POST /inventory-sales-analytics/rebuild` → 409 if running
  - `POST /inventory-sales-analytics/export` → `createDownloadJob` + `kickDownloadWorker` → 202 `{ jobId }`

- [ ] **Step 1: 实现 routes（示意）**

```ts
import { Hono } from 'hono';
import { requireMenu } from '../lib/require-menu.js';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  rebuildInventorySalesCube,
  getInventorySalesCubeStatus,
  listInventorySalesCubeRows,
  getInventorySalesCubeSkuDetail,
} from '../lib/inventory-sales-cube.js';
import { createDownloadJob, DownloadJobLimitError } from '../lib/download-jobs.js';
import { kickDownloadWorker } from '../lib/download-worker.js';

export const inventorySalesAnalyticsRoutes = new Hono();

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/status',
  requireMenu('data.inventory_sales_analytics'),
  async (c) => c.json(await getInventorySalesCubeStatus()),
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/rows',
  requireMenu('data.inventory_sales_analytics'),
  async (c) => {
    const result = await listInventorySalesCubeRows({
      q: c.req.query('q')?.trim(),
      warehouseCode: c.req.query('warehouseCode')?.trim(),
      category: c.req.query('category')?.trim(),
      lifecycle: c.req.query('lifecycle')?.trim(),
      primaryRisk: c.req.query('primaryRisk')?.trim(),
      productScope: c.req.query('productScope')?.trim(),
      salesCountry: c.req.query('salesCountry')?.trim(),
      page: Number(c.req.query('page') ?? 1),
      pageSize: Number(c.req.query('pageSize') ?? 20),
    });
    return c.json(result);
  },
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/sku/:skuId',
  requireMenu('data.inventory_sales_analytics'),
  async (c) => c.json(await getInventorySalesCubeSkuDetail(c.req.param('skuId'))),
);

inventorySalesAnalyticsRoutes.post(
  '/inventory-sales-analytics/rebuild',
  requireMenu('data.inventory_sales_analytics'),
  async (c) => {
    const user = await getCurrentUser(c);
    try {
      const result = await rebuildInventorySalesCube({ actorId: user.id });
      if (result.status === 'skipped' && /running|进行中/i.test(result.message ?? '')) {
        return c.json({ message: result.message }, 409);
      }
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'rebuild failed';
      if (/running|进行中/i.test(msg)) return c.json({ message: msg }, 409);
      throw err;
    }
  },
);

inventorySalesAnalyticsRoutes.post(
  '/inventory-sales-analytics/export',
  requireMenu('data.inventory_sales_analytics'),
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json().catch(() => ({}));
    try {
      const created = await createDownloadJob({
        userId: user.id,
        jobType: 'inventory_sales_analytics',
        title: `存销分析导出-${new Date().toISOString().slice(0, 10)}`,
        fileName: `inventory-sales-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
        params: body ?? {},
      });
      kickDownloadWorker();
      return c.json(
        { jobId: created.id, status: created.status, downloadCenterPath: '/downloads' },
        202,
      );
    } catch (err) {
      if (err instanceof DownloadJobLimitError) {
        return c.json({ message: err.message }, 429);
      }
      throw err;
    }
  },
);
```

- [ ] **Step 2: `index.ts` 挂载** `app.route('/api', inventorySalesAnalyticsRoutes);`

- [ ] **Step 3: download-exporters 增加**

```ts
async inventory_sales_analytics(params) {
  const listed = await listInventorySalesCubeRows({
    q: str(params.q),
    warehouseCode: str(params.warehouseCode),
    category: str(params.category),
    lifecycle: str(params.lifecycle),
    primaryRisk: str(params.primaryRisk),
    productScope: str(params.productScope) as ProductScope | undefined,
    salesCountry: str(params.salesCountry),
    page: 1,
    pageSize: 100_000,
  });
  const headers = [
    'sku_code',
    'warehouse_code',
    'effective_qty',
    'sales_7d',
    'sales_14d',
    'sales_30d',
    'avg_daily_30d',
    'cover_days',
    'sell_through_30d',
    'primary_risk',
  ];
  const csv = buildCsv(
    headers,
    listed.items.map((r) => [
      r.skuCode,
      r.warehouseCode,
      r.effectiveQty,
      r.sales7d ?? '',
      r.sales14d ?? '',
      r.sales30d ?? '',
      r.avgDaily30d ?? '',
      r.coverDays ?? '',
      r.sellThrough30d ?? '',
      r.primaryRisk ?? '',
    ]),
  );
  return {
    content: csv,
    contentType: CSV_TYPE,
    fileName: `inventory-sales-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: listed.items.length,
  };
},
```

（字段名与 `listInventorySalesCubeRows` 返回 DTO 对齐。）

- [ ] **Step 4: 手工或最小路由冒烟**（有测试环境则 curl status）

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 5: Cron 任务与日流水线挂钩

**Files:**
- Create: `apps/web/server/tasks/inventorySalesCubeRebuild.ts`
- Modify: `apps/web/server/routes/tasks.ts`
- Modify: `apps/web/server/tasks/dailyInventoryPipeline.ts`
- Modify: `apps/web/src/lib/scheduled-tasks.ts`

**Interfaces:**
- Task name: `inventory_sales_cube_rebuild`
- Path: `POST /api/tasks/inventory-sales-cube-rebuild` + `requireCronSecret`
- Pipeline：在 `warehouse_stock_facts` 成功之后（或流水线末尾、补货之前）调用；周转未发布则 step `success: true` + summary `skipped: source turnover unpublished`（不标红整条流水线）

- [ ] **Step 1: task 包装**

```ts
import { rebuildInventorySalesCube } from '../lib/inventory-sales-cube.js';

export async function runInventorySalesCubeRebuild(actorId?: string | null) {
  return rebuildInventorySalesCube({ actorId: actorId ?? null });
}
```

- [ ] **Step 2: tasks 路由** — 对齐其它 pull：`startTaskRun` / `finishTaskRun` / 冲突检测

- [ ] **Step 3: dailyInventoryPipeline 增加 step `inventory_sales_cube`**

```ts
try {
  const cube = await runInventorySalesCubeRebuild(null);
  steps.push({
    name: 'inventory_sales_cube',
    success: cube.status !== 'failed',
    summary:
      cube.status === 'ready'
        ? `rows=${cube.rowCount}`
        : `${cube.status}:${cube.message ?? ''}`,
    error: cube.status === 'failed' ? cube.message : undefined,
  });
} catch (err) {
  steps.push({
    name: 'inventory_sales_cube',
    success: false,
    error: err instanceof Error ? err.message : 'failed',
  });
}
```

- [ ] **Step 4: scheduled-tasks 目录增加条目**（cron 可标「随每日流水线 08:50」；仍保留手动 path）

```ts
{
  id: 'inventory_sales_cube_rebuild',
  name: '存销分析 Cube 重建',
  path: '/api/tasks/inventory-sales-cube-rebuild',
  cron: '50 8 * * *',
  cronLabel: '随每日库存流水线 08:50',
  description: '周转可用时重建 SKU×仓存销分析行表；未发布则跳过并保留上一 ready',
},
```

并在任务名称映射对象中加中文名。

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 6: 前端页面与 API 客户端

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/InventorySalesAnalyticsPage.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- API methods: `getInventorySalesAnalyticsStatus`, `getInventorySalesAnalyticsRows`, `getInventorySalesAnalyticsSku`, `rebuildInventorySalesAnalytics`, `exportInventorySalesAnalytics`
- Route: `data/inventory-sales-analytics` → `InventorySalesAnalyticsPage`
- 默认风险筛：若当前用户角色含 `pmc_planner` 默认倾向 stockout/unallocated；含 `warehouse`/`purchaser` 可默认 slow_moving（以 `getCurrentUser`/权限接口现有字段为准；无角色字段则提供筛选项不强制默认）

- [ ] **Step 1: api.ts 增加方法**（对齐 sales-analytics 风格）

```ts
getInventorySalesAnalyticsStatus: () =>
  request<InventorySalesAnalyticsStatus>('/api/inventory-sales-analytics/status'),
getInventorySalesAnalyticsRows: (params: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams();
  // append defined params
  return request<InventorySalesAnalyticsRowsResponse>(
    `/api/inventory-sales-analytics/rows?${qs}`,
  );
},
getInventorySalesAnalyticsSku: (skuId: string) =>
  request(`/api/inventory-sales-analytics/sku/${skuId}`),
rebuildInventorySalesAnalytics: () =>
  request('/api/inventory-sales-analytics/rebuild', { method: 'POST' }),
exportInventorySalesAnalytics: (body: Record<string, unknown>) =>
  request<{ jobId: string }>('/api/inventory-sales-analytics/export', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
```

- [ ] **Step 2: 页面骨架**

复用现有：`PageHeader`、`ProductScopeSwitch`、`ListPagination`、`Button`、`Card`、筛选 `Input`/`select`。结构：

1. 顶栏：snapshotDate、status 文案（failed/running/源周转未发布）、重建按钮、产品范围  
2. KPI 四格：来自 `summary`（total、stockoutRisk、slowMoving、imbalance、unallocated）  
3. 主表列：SKU、仓、有效供给、7/14/30、日均、覆盖、动销率、主风险；无动销显示「—」  
4. 行点击打开 dialog/drawer：各仓对比 + queryReconcile  
5. 导出：调用 export → toast「已加入下载中心」

样式遵循现有库存/数据页，不新造视觉体系。

- [ ] **Step 3: router 注册**

```tsx
<Route path="data/inventory-sales-analytics" element={<InventorySalesAnalyticsPage />} />
```

- [ ] **Step 4: 本地打开页面冒烟**（需已 migrate + 可手动 rebuild）

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 7: 验收与回归

**Files:** 无强制新文件；必要时补测

- [ ] **Step 1: 跑相关单测**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/inventory-sales-metrics.test.ts server/lib/inventory-sales-cube.test.ts
```

Expected: PASS

- [ ] **Step 2: 对照 spec 验收清单**

| 验收项 | 做法 |
|--------|------|
| effective_qty 与规划头寸一致 | 抽 2–3 个 SKU×仓对比库存总览/规划 |
| sales_30d 仓合计 ≈ SKU 窗口销 | SQL 或脚本对一 SKU |
| KPI 与筛选一致 | UI 点风险筛 |
| 周转未发布可降级 | 模拟 skipped，页仍读上一 ready |
| 菜单 RBAC | pmc_planner / warehouse 可见 |
| 并发 rebuild 409 | 双发 POST rebuild |

- [ ] **Step 3: 更新业务文档一行**（可选）  
`docs/business/scm-demand-supply-inventory-logic.md` 库存域表格增加「存销分析」一行指向本能力。

- [ ] **Step 4: Commit（仅当用户要求）**

---

## Spec Coverage Self-Check

| Spec 章节 | Task |
|-----------|------|
| §2 架构 / 日拍 cube | 3, 5 |
| §3 指标与风险 | 1, 3 |
| §4 表结构 | 2 |
| §5 API | 4 |
| §6 页面 / 菜单 | 2, 6 |
| §7 流水线触发 | 5 |
| §8 降级 / 409 | 3, 4, 5 |
| §9 非范围 | Global Constraints（不做预测对照等） |
| §10 验收 | 7 |
| 导出下载中心 | 4 |

## Placeholder / Consistency Review

- 迁移号固定 **0138**（当前 journal 止于 0137）  
- 菜单 code 全链路统一 `data.inventory_sales_analytics`  
- 风险枚举四字面量与 Task1/表字段/`primaryRisk` 筛选一致  
- `allocateByShare` 整数分摊 → `sales_*` 用 integer 列  
- 无 `GET .../cube` 整包接口（符合 spec）
