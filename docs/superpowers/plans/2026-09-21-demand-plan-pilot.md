# 需求计划试点（通路验证）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冻结现网销售预测，新增独立需求计划域；在配置的小项目组 × `US-WEST` 上让时间轴/补货/预警改吃需求计划，规划页保留 Champion 影子对照，开关默认关闭。

**Architecture:** 新表 `demand_plan_*`；纯函数完成试点命中、有货日还原、预测形状 × 分仓占比、生效日均；`buildSkuWarehouseTimeline` 统一走 `resolvePlanningDemand`（补货/预警不传 forecastMap 时自动切换）。HTTP + 精简工作台负责生成/发布/人工改数。不改 `projectDailyInventory` 与预测生成公式。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `node:test` via `pnpm --filter @scm/web exec tsx --test`

**Spec:** `docs/superpowers/specs/2026-09-21-demand-plan-pilot-design.md`

## Global Constraints

- **不改** `forecast-baseline.ts` / `forecast-collaboration.ts` 生成公式，不把需求计划写入 `sales_forecast_monthly`。
- **不改** `projectDailyInventory` 日余额公式。
- **健康灯**仍用现网预测/历史口径；决策缺货日/建议量以时间轴为准。
- **开关默认 off**：`DEMAND_PLAN_PILOT_ENABLED` 缺省或非 `true` 时行为与改造前一致。
- **第一期仓**仅配置 `US-WEST`；同仓跨项目组的 SPU 整颗排除。
- **PMC 不自动转跟单**；建议仅人工采纳。
- **本期不做**紧急出货/调拨、SKU 继任图、流量广告、随机 SKU A/B。
- 测试命令：`pnpm --filter @scm/web exec tsx --test <file>`；Expected: `fail 0`。

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/db/src/schema/demand-plan.ts` | 版本/月明细/快照表 |
| `packages/db/src/schema/index.ts` | 导出 |
| `packages/db/drizzle/0095_demand_plan.sql` | 迁移 + 菜单 |
| `apps/web/server/lib/demand-plan-config.ts` | 读环境变量 |
| `apps/web/server/lib/demand-plan-eligibility.ts` | 试点命中、SPU 排除 |
| `apps/web/server/lib/demand-plan-reconstruct.ts` | 有货日还原 + 形状 × 占比 |
| `apps/web/server/lib/demand-plan-resolve.ts` | `resolvePlanningDemand` |
| `apps/web/server/lib/inventory-timeline-service.ts` | 改吃 resolver；可选 Champion 影子 |
| `apps/web/server/lib/inventory-planning-service.ts` | 规划 API 对照字段 |
| `apps/web/server/lib/demand-plan-service.ts` | 生成/发布/归档/快照 |
| `apps/web/server/routes/demand-plans.ts` | HTTP |
| `apps/web/server/index.ts` | 挂载路由 |
| `apps/web/src/lib/api.ts` | 客户端 |
| `apps/web/src/pages/DemandPlanPilotPage.tsx` | 工作台 |
| `apps/web/src/pages/SkuInventoryPlanningPage.tsx` | 影子列 |
| `apps/web/src/pages/SalesForecastListPage.tsx` | 试点提示 |
| `apps/web/src/router.tsx` | 路由 |
| `.env.example` | 三个环境变量 |

---

### Task 1: Schema 与迁移

**Files:**
- Create: `packages/db/src/schema/demand-plan.ts`
- Modify: `packages/db/src/schema/index.ts` — 在 `sales-forecast` 导出后增加 `export * from './demand-plan';`
- Create: `packages/db/drizzle/0095_demand_plan.sql`

**Interfaces:**
- Produces: tables `demandPlanVersions`, `demandPlanMonthly`, `demandPlanPilotSnapshots`；enum `demand_plan_version_status` = `draft | pilot_published | archived`

- [ ] **Step 1: Write schema file**

```ts
// packages/db/src/schema/demand-plan.ts
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const demandPlanVersionStatusEnum = pgEnum('demand_plan_version_status', [
  'draft',
  'pilot_published',
  'archived',
]);

export const demandPlanVersions = pgTable(
  'demand_plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionNo: varchar('version_no', { length: 50 }).notNull().unique(),
    versionName: varchar('version_name', { length: 200 }).notNull(),
    status: demandPlanVersionStatusEnum('status').notNull().default('draft'),
    startMonth: varchar('start_month', { length: 7 }).notNull(),
    horizonMonths: integer('horizon_months').notNull().default(12),
    projectGroup: varchar('project_group', { length: 20 }).notNull(),
    warehouseCode: varchar('warehouse_code', { length: 50 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    publishedBy: uuid('published_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('demand_plan_versions_status_idx').on(
      table.status,
      table.projectGroup,
      table.warehouseCode,
    ),
  }),
);

export const demandPlanMonthly = pgTable(
  'demand_plan_monthly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => demandPlanVersions.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    warehouseCode: varchar('warehouse_code', { length: 50 }).notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    systemDailyAvg: numeric('system_daily_avg', { precision: 12, scale: 4 }).notNull(),
    manualDailyAvg: numeric('manual_daily_avg', { precision: 12, scale: 4 }),
    adjustReason: text('adjust_reason'),
    unconstrainedRecentDaily: numeric('unconstrained_recent_daily', { precision: 12, scale: 4 }),
    championForecastDaily: numeric('champion_forecast_daily', { precision: 12, scale: 4 }),
    inStockDayRatio: numeric('in_stock_day_ratio', { precision: 8, scale: 4 }),
    source: varchar('source', { length: 30 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('demand_plan_monthly_unique_idx').on(
      table.versionId,
      table.skuId,
      table.warehouseCode,
      table.period,
    ),
    skuIdx: index('demand_plan_monthly_sku_idx').on(table.skuId, table.warehouseCode),
  }),
);

export const demandPlanPilotSnapshots = pgTable(
  'demand_plan_pilot_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    versionId: uuid('version_id').references(() => demandPlanVersions.id, { onDelete: 'set null' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    warehouseCode: varchar('warehouse_code', { length: 50 }).notNull(),
    stockoutDateDemand: varchar('stockout_date_demand', { length: 10 }),
    stockoutDateForecast: varchar('stockout_date_forecast', { length: 10 }),
    suggestedQtyDemand: numeric('suggested_qty_demand', { precision: 12, scale: 4 }),
    suggestedQtyForecast: numeric('suggested_qty_forecast', { precision: 12, scale: 4 }),
    unconstrainedRecentDaily: numeric('unconstrained_recent_daily', { precision: 12, scale: 4 }),
    championForecastDaily: numeric('champion_forecast_daily', { precision: 12, scale: 4 }),
    inStockDayRatio: numeric('in_stock_day_ratio', { precision: 8, scale: 4 }),
  },
  (table) => ({
    capturedIdx: index('demand_plan_pilot_snapshots_captured_idx').on(table.capturedAt),
  }),
);

export const demandPlanVersionsRelations = relations(demandPlanVersions, ({ many }) => ({
  months: many(demandPlanMonthly),
}));

export const demandPlanMonthlyRelations = relations(demandPlanMonthly, ({ one }) => ({
  version: one(demandPlanVersions, {
    fields: [demandPlanMonthly.versionId],
    references: [demandPlanVersions.id],
  }),
  sku: one(skus, { fields: [demandPlanMonthly.skuId], references: [skus.id] }),
}));
```

- [ ] **Step 2: Export + SQL migration**

`packages/db/src/schema/index.ts` 增加 `export * from './demand-plan';`

`packages/db/drizzle/0095_demand_plan.sql`：

```sql
CREATE TYPE "demand_plan_version_status" AS ENUM ('draft', 'pilot_published', 'archived');

CREATE TABLE IF NOT EXISTS "demand_plan_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_no" varchar(50) NOT NULL UNIQUE,
  "version_name" varchar(200) NOT NULL,
  "status" "demand_plan_version_status" NOT NULL DEFAULT 'draft',
  "start_month" varchar(7) NOT NULL,
  "horizon_months" integer NOT NULL DEFAULT 12,
  "project_group" varchar(20) NOT NULL,
  "warehouse_code" varchar(50) NOT NULL,
  "published_at" timestamptz,
  "created_by" uuid,
  "published_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "demand_plan_versions_status_idx"
  ON "demand_plan_versions" ("status", "project_group", "warehouse_code");

CREATE TABLE IF NOT EXISTS "demand_plan_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "demand_plan_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "warehouse_code" varchar(50) NOT NULL,
  "period" varchar(7) NOT NULL,
  "system_daily_avg" numeric(12, 4) NOT NULL,
  "manual_daily_avg" numeric(12, 4),
  "adjust_reason" text,
  "unconstrained_recent_daily" numeric(12, 4),
  "champion_forecast_daily" numeric(12, 4),
  "in_stock_day_ratio" numeric(8, 4),
  "source" varchar(30) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "demand_plan_monthly_unique_idx"
  ON "demand_plan_monthly" ("version_id", "sku_id", "warehouse_code", "period");

CREATE TABLE IF NOT EXISTS "demand_plan_pilot_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "version_id" uuid REFERENCES "demand_plan_versions"("id") ON DELETE SET NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "warehouse_code" varchar(50) NOT NULL,
  "stockout_date_demand" varchar(10),
  "stockout_date_forecast" varchar(10),
  "suggested_qty_demand" numeric(12, 4),
  "suggested_qty_forecast" numeric(12, 4),
  "unconstrained_recent_daily" numeric(12, 4),
  "champion_forecast_daily" numeric(12, 4),
  "in_stock_day_ratio" numeric(8, 4)
);

INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '需求计划试点', 'data.demand_plan', NULL, '/data/demand-plan',
       (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 25, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.demand_plan');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner')
  AND m.code = 'data.demand_plan'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
```

若 `menus.code = 'data'` 不存在，改为与 `data.forecast` 相同的 `parent_id` 子查询：`(SELECT parent_id FROM menus WHERE code = 'data.forecast' LIMIT 1)`。

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/demand-plan.ts packages/db/src/schema/index.ts packages/db/drizzle/0095_demand_plan.sql
git commit -m "$(cat <<'EOF'
feat: add demand_plan tables for S&OP pilot

EOF
)"
```

---

### Task 2: 试点配置与资格判定

**Files:**
- Create: `apps/web/server/lib/demand-plan-config.ts`
- Create: `apps/web/server/lib/demand-plan-config.test.ts`
- Create: `apps/web/server/lib/demand-plan-eligibility.ts`
- Create: `apps/web/server/lib/demand-plan-eligibility.test.ts`

**Interfaces:**
- Produces:

```ts
export type DemandPlanPilotConfig = {
  enabled: boolean;
  projectGroups: string[];
  warehouses: string[];
};

export function parseDemandPlanPilotConfig(env: NodeJS.ProcessEnv): DemandPlanPilotConfig;

export type SkuPilotInput = {
  skuId: string;
  projectGroup: string | null;
  spuId: string | null;
  isActive: boolean;
};

export function isWarehouseInPilot(warehouseCode: string, config: DemandPlanPilotConfig): boolean;

/** 跨组 SPU：同一 spuId 出现在多个不同非空 projectGroup 中则整颗排除 */
export function excludedCrossGroupSpuIds(skus: SkuPilotInput[]): Set<string>;

export function isSkuWarehouseInPilot(input: {
  sku: SkuPilotInput;
  warehouseCode: string;
  config: DemandPlanPilotConfig;
  excludedSpuIds: Set<string>;
}): boolean;
```

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/server/lib/demand-plan-config.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDemandPlanPilotConfig } from './demand-plan-config.js';

describe('parseDemandPlanPilotConfig', () => {
  it('defaults to disabled empty lists', () => {
    const c = parseDemandPlanPilotConfig({});
    assert.equal(c.enabled, false);
    assert.deepEqual(c.projectGroups, []);
    assert.deepEqual(c.warehouses, []);
  });

  it('parses true and comma lists with trim', () => {
    const c = parseDemandPlanPilotConfig({
      DEMAND_PLAN_PILOT_ENABLED: 'true',
      DEMAND_PLAN_PILOT_PROJECT_GROUPS: '项目6组, 项目7组',
      DEMAND_PLAN_PILOT_WAREHOUSES: 'US-WEST',
    });
    assert.equal(c.enabled, true);
    assert.deepEqual(c.projectGroups, ['项目6组', '项目7组']);
    assert.deepEqual(c.warehouses, ['US-WEST']);
  });

  it('treats TRUE only as enabled', () => {
    assert.equal(parseDemandPlanPilotConfig({ DEMAND_PLAN_PILOT_ENABLED: '1' }).enabled, false);
  });
});
```

```ts
// apps/web/server/lib/demand-plan-eligibility.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  excludedCrossGroupSpuIds,
  isSkuWarehouseInPilot,
} from './demand-plan-eligibility.js';

const config = {
  enabled: true,
  projectGroups: ['项目6组'],
  warehouses: ['US-WEST'],
};

describe('demand-plan-eligibility', () => {
  it('excludes SPUs that span two project groups', () => {
    const excluded = excludedCrossGroupSpuIds([
      { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true },
      { skuId: 'b', projectGroup: '项目1组', spuId: 'spu1', isActive: true },
    ]);
    assert.equal(excluded.has('spu1'), true);
  });

  it('does not exclude SPU fully inside one group', () => {
    const excluded = excludedCrossGroupSpuIds([
      { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true },
      { skuId: 'b', projectGroup: '项目6组', spuId: 'spu1', isActive: true },
    ]);
    assert.equal(excluded.has('spu1'), false);
  });

  it('hits only matching group and warehouse when enabled', () => {
    const sku = { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true };
    assert.equal(
      isSkuWarehouseInPilot({ sku, warehouseCode: 'US-WEST', config, excludedSpuIds: new Set() }),
      true,
    );
    assert.equal(
      isSkuWarehouseInPilot({ sku, warehouseCode: 'US-EAST', config, excludedSpuIds: new Set() }),
      false,
    );
  });

  it('misses when disabled or SPU excluded', () => {
    const sku = { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true };
    assert.equal(
      isSkuWarehouseInPilot({
        sku,
        warehouseCode: 'US-WEST',
        config: { ...config, enabled: false },
        excludedSpuIds: new Set(),
      }),
      false,
    );
    assert.equal(
      isSkuWarehouseInPilot({
        sku,
        warehouseCode: 'US-WEST',
        config,
        excludedSpuIds: new Set(['spu1']),
      }),
      false,
    );
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/demand-plan-config.test.ts server/lib/demand-plan-eligibility.test.ts`

- [ ] **Step 3: Implement**

`parseDemandPlanPilotConfig`：`enabled = env.DEMAND_PLAN_PILOT_ENABLED === 'true'`；列表按逗号 split、trim、去掉空串。

`excludedCrossGroupSpuIds`：对每个非空 `spuId` 收集出现过的 `projectGroup`（忽略 null 组）；size>1 则加入 Set。

`isSkuWarehouseInPilot`：`config.enabled && sku.isActive && sku.projectGroup` 在列表中 && warehouse 在列表中 && `!(sku.spuId && excludedSpuIds.has(sku.spuId))`。无 `spuId` 仍可命中。

- [ ] **Step 4: Re-run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/demand-plan-config.ts apps/web/server/lib/demand-plan-config.test.ts apps/web/server/lib/demand-plan-eligibility.ts apps/web/server/lib/demand-plan-eligibility.test.ts
git commit -m "$(cat <<'EOF'
feat: add demand plan pilot config and SKU eligibility

EOF
)"
```

---

### Task 3: 还原需求与月度系统日均

**Files:**
- Create: `apps/web/server/lib/demand-plan-reconstruct.ts`
- Create: `apps/web/server/lib/demand-plan-reconstruct.test.ts`

**Interfaces:**
- Consumes: `calcEffectiveDailyDemand` from `effective-daily-demand.ts`；`forecastMonthKey` from `forecast-demand.ts`
- Produces:

```ts
export const DEMAND_SHAPE_CLIP_MIN = 0.5;
export const DEMAND_SHAPE_CLIP_MAX = 2.0;

export function clipDemandShape(shape: number): number; // clamp to [0.5, 2]

export function warehouseShareWeight(
  warehouseCode: string,
  weights: Array<{ warehouse: string; weight: number }>,
): number | null; // missing warehouse → null

export function championRefLevel(monthlyDaily: number[]): number; // mean of first 3 positive; else 0

export function systemDailyAvgForMonth(input: {
  unconstrainedRecentDaily: number;
  share: number;
  monthForecastDaily: number;
  championRefDaily: number;
}): number;
// U * share * clip(F_m / F_ref)；F_ref<=0 → shape=1

export type DemandMonthSource = 'reconstructed_shape' | 'fallback_forecast';

export function classifyReconstructSource(input: {
  hasAvailabilitySeries: boolean;
  inStockDays: number;
}): DemandMonthSource;
// hasAvailability && inStockDays>0 → reconstructed_shape；else fallback_forecast
```

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  championRefLevel,
  classifyReconstructSource,
  clipDemandShape,
  systemDailyAvgForMonth,
  warehouseShareWeight,
} from './demand-plan-reconstruct.js';

describe('demand-plan-reconstruct', () => {
  it('clips shape to 0.5–2.0', () => {
    assert.equal(clipDemandShape(0.1), 0.5);
    assert.equal(clipDemandShape(3), 2);
    assert.equal(clipDemandShape(1.2), 1.2);
  });

  it('returns null share when warehouse missing', () => {
    assert.equal(warehouseShareWeight('US-WEST', [{ warehouse: 'US-EAST', weight: 1 }]), null);
    assert.equal(warehouseShareWeight('US-WEST', [{ warehouse: 'US-WEST', weight: 0.4 }]), 0.4);
  });

  it('uses first three positive months as champion ref', () => {
    assert.equal(championRefLevel([10, 10, 10, 20]), 10);
    assert.equal(championRefLevel([0, 0]), 0);
  });

  it('scales unconstrained by share and clipped shape', () => {
    const daily = systemDailyAvgForMonth({
      unconstrainedRecentDaily: 10,
      share: 0.5,
      monthForecastDaily: 20,
      championRefDaily: 10,
    });
    assert.equal(daily, 10); // 10 * 0.5 * clip(2)=10
  });

  it('classifies fallback without availability', () => {
    assert.equal(classifyReconstructSource({ hasAvailabilitySeries: false, inStockDays: 0 }), 'fallback_forecast');
    assert.equal(classifyReconstructSource({ hasAvailabilitySeries: true, inStockDays: 8 }), 'reconstructed_shape');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/demand-plan-reconstruct.test.ts`

- [ ] **Step 3: Implement** — 数值四舍五入到 4 位：`Math.round(x * 10000) / 10000`。`systemDailyAvgForMonth` 在 `unconstrainedRecentDaily<=0` 时返回 0。

- [ ] **Step 4: Re-run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/demand-plan-reconstruct.ts apps/web/server/lib/demand-plan-reconstruct.test.ts
git commit -m "$(cat <<'EOF'
feat: add unconstrained demand shape math for demand plan v0

EOF
)"
```

---

### Task 4: `resolvePlanningDemand` 纯装配

**Files:**
- Create: `apps/web/server/lib/demand-plan-resolve.ts`
- Create: `apps/web/server/lib/demand-plan-resolve.test.ts`

**Interfaces:**
- Consumes: Task 2 eligibility；`mapForecastDailyFields` 口径：生效 = `manual ?? system`
- Produces:

```ts
export type PlanningDemandFlag =
  | 'pilot_hit'
  | 'fallback_forecast'
  | 'no_share'
  | 'cross_spu_excluded'
  | 'demand_missing_fallback_forecast';

export type PlanningDemandResult = {
  demandMap: Map<string, number>;
  championMap: Map<string, number>;
  source: 'demand_plan' | 'forecast';
  flags: PlanningDemandFlag[];
  fallbackDaily: number;
};

export function effectiveDemandDaily(systemDailyAvg: number, manualDailyAvg: number | null): number;

export function monthMapFromRows(
  rows: Array<{ period: string; systemDailyAvg: number; manualDailyAvg: number | null }>,
): Map<string, number>;

export function resolvePlanningDemandFromInputs(input: {
  inPilot: boolean;
  excludedSpu: boolean;
  hasShare: boolean;
  demandRows: Array<{ period: string; systemDailyAvg: number; manualDailyAvg: number | null }>;
  championWarehouseRows: Array<{ period: string; daily: number }>;
}): PlanningDemandResult;
```

规则（写进测试）：

- `!inPilot` → `source=forecast`，`demandMap=championMap`（由 championWarehouseRows 填），flags 空（若 `excludedSpu` 且本应试点组则仍 forecast + `cross_spu_excluded` 仅当调用方把 inPilot 已算成 false）。
- 简化：`excludedSpu` → 强制 forecast，flag `cross_spu_excluded`。
- `inPilot && !hasShare` → forecast，flag `no_share`。
- `inPilot && hasShare && demandRows.length===0` → forecast，flag `demand_missing_fallback_forecast`。
- `inPilot && hasShare && demandRows.length>0` → `source=demand_plan`，demandMap 来自行，championMap 来自 champion 行，flag `pilot_hit`；若任一行 `source` 语义由调用方另标。`fallbackDaily` = 需求 Map 中按 period 排序最近 3 个正值均值。

- [ ] **Step 1: Failing tests** covering the four branches above（`effectiveDemandDaily(5, 8)===8`，`effectiveDemandDaily(5, null)===5`）。

- [ ] **Step 2: Run FAIL → implement → PASS**

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/lib/demand-plan-resolve.ts apps/web/server/lib/demand-plan-resolve.test.ts
git commit -m "$(cat <<'EOF'
feat: add planning demand resolver with forecast fallback

EOF
)"
```

---

### Task 5: 时间轴改吃 resolver（补货/预警自动跟上）

**Files:**
- Modify: `apps/web/server/lib/inventory-timeline-service.ts`
- Create: `apps/web/server/lib/inventory-timeline-demand.test.ts`（纯函数抽 `pickDemandMapForTimeline` 测，避免连库）
- Modify: `apps/web/server/lib/demand-plan-resolve.ts` 增加 `pickDemandMapForTimeline` 若尚未抽出

**Interfaces:**
- Consumes: `resolvePlanningDemandFromInputs` 或异步 loader（见下）
- 修改 `buildSkuWarehouseTimeline`：

```ts
export async function buildSkuWarehouseTimeline(params: {
  // 现有字段保留
  includeChampionShadow?: boolean;
}): Promise<{
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
  planningDemand: PlanningDemandResult;
  championTimeline?: DailyInventoryResult;
}>;
```

异步加载（放 `demand-plan-load.ts` 以免 timeline-service 膨胀）：

```ts
export async function loadPlanningDemandForSkuWarehouse(input: {
  skuId: string;
  warehouseCode: string;
  championForecastMap: Map<string, number>;
}): Promise<PlanningDemandResult>;
```

加载步骤（实现时按此顺序，测试可用注入函数）：

1. `parseDemandPlanPilotConfig(process.env)`
2. 读 sku `projectGroup, spuId, isActive`
3. 若 enabled，查该 `spuId` 下所有活跃 SKU 的 projectGroup，算 `excludedCrossGroupSpuIds`
4. `inPilot = isSkuWarehouseInPilot(...)`
5. `hasShare`：`parseSharesFromSnapshot` 后 `warehouseShareWeight(warehouse, weights) != null`
6. 若 inPilot：查 `demand_plan_versions` status=`pilot_published` 且 `project_group`+`warehouse_code` 匹配，join monthly 该 sku
7. Champion 仓口径：`championForecastMap` 各月 × share（无 share 则 championMap 空，demand 回退全站预测 Map 以保持现网）
8. `resolvePlanningDemandFromInputs`

**现网兼容：** 非试点时 `demandMap` 必须等于今天 `loadMergedPublishedForecastBySkuIds` 的 map（share 不乘进 Champion 全站预测——现网时间轴吃的是全站预测日均，**非试点不得改这个口径**）。

因此 `championWarehouseRows` 仅用于影子对照与需求生成；**非试点 `demandMap` = 传入/加载的未拆仓 forecastMap**。把这条写进 `resolvePlanningDemandFromInputs`：增加 `stationForecastMap`：

```ts
export function resolvePlanningDemandFromInputs(input: {
  inPilot: boolean;
  excludedSpu: boolean;
  hasShare: boolean;
  demandRows: ...
  championWarehouseRows: ...
  stationForecastMap: Map<string, number>;
}): PlanningDemandResult;
```

- 非试点 / 回退：`demandMap = stationForecastMap`，`championMap` = warehouse-scaled 供影子（无 share 则 championMap 空）。
- 试点命中：`demandMap` = 需求行生效日均。

回改 Task 4 测试：非试点 `demandMap` 等于 `stationForecastMap` 不是 warehouse rows。

- [ ] **Step 1: 扩展 Task 4 测试并改实现**（若 Task 4 已提交则本任务改正）

- [ ] **Step 2: `pickDemandMapForTimeline` 单测**

```ts
it('uses demand map when source is demand_plan', () => {
  const demand = new Map([['2026-10', 2]]);
  const forecast = new Map([['2026-10', 1]]);
  assert.equal(pickDemandMapForTimeline({ source: 'demand_plan', demandMap: demand, stationForecastMap: forecast }).get('2026-10'), 2);
});
it('uses station forecast when source is forecast', () => {
  const demand = new Map([['2026-10', 2]]);
  const forecast = new Map([['2026-10', 1]]);
  assert.equal(pickDemandMapForTimeline({ source: 'forecast', demandMap: demand, stationForecastMap: forecast }).get('2026-10'), 1);
});
```

`pickDemandMapForTimeline`：`source==='demand_plan' ? demandMap : stationForecastMap`。

- [ ] **Step 3: 改 `buildSkuWarehouseTimeline`**

现有逻辑：若未传 `forecastMap` 则 `loadMergedPublishedForecastBySkuIds`。然后：

```ts
const stationForecastMap = forecastMap ?? empty;
const planningDemand = await loadPlanningDemandForSkuWarehouse({
  skuId: params.skuId,
  warehouseCode: params.warehouseCode,
  championForecastMap: stationForecastMap,
});
const timelineMap = pickDemandMapForTimeline({
  source: planningDemand.source,
  demandMap: planningDemand.demandMap,
  stationForecastMap,
});
const fallbackDaily =
  planningDemand.source === 'demand_plan' ? planningDemand.fallbackDaily : params.avgDaily;
```

`dailyDemandFn` 用 `timelineMap` + `fallbackDaily`。

`includeChampionShadow===true` 且 `championMap.size>0` 时，用同一 lots 再 `projectDailyInventory`，`dailyDemandFn` 走 `championMap` 与 `params.avgDaily`。

返回值增加 `planningDemand` 与可选 `championTimeline`。更新 `inventory-planning-service.test.ts` 等对返回值解构的测试：多余字段可忽略。

- [ ] **Step 4: Run**

```
pnpm --filter @scm/web exec tsx --test server/lib/demand-plan-resolve.test.ts server/lib/inventory-timeline-demand.test.ts server/lib/inventory-timeline-service.test.ts server/lib/inventory-planning-service.test.ts
```

Expected: fail 0。若 `inventory-timeline-service.test.ts` 不存在则跳过。

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/demand-plan-resolve.ts apps/web/server/lib/demand-plan-resolve.test.ts apps/web/server/lib/demand-plan-load.ts apps/web/server/lib/inventory-timeline-service.ts apps/web/server/lib/inventory-timeline-demand.test.ts
git commit -m "$(cat <<'EOF'
feat: consume demand plan in inventory timeline when pilot hits

EOF
)"
```

补货任务与缺货预警已调用 `buildSkuWarehouseTimeline` 且多数不传 `forecastMap`，**不必改任务文件**除非测试失败证明有预传 forecastMap 覆盖 resolver——若预传，仍要在 service 内跑 resolver，忽略「用 forecastMap 当需求」除非非试点。规格：试点命中时即使传入 forecastMap 也只把它当 Champion，决策 Map 用需求计划。

---

### Task 6: SKU 规划 API 对照字段

**Files:**
- Modify: `apps/web/server/lib/inventory-planning-service.ts`
- Modify: `apps/web/server/lib/inventory-planning-service.test.ts`
- Modify: `apps/web/src/lib/api.ts` — `SkuPlanningView`

**Interfaces:**
- 扩展 `SkuPlanningView`：

```ts
planningDemandSource?: 'demand_plan' | 'forecast';
planningDemandFlags?: string[];
championStockoutDateConfirmed?: string | null;
championSuggestedQty?: number | null;
inStockDayRatio?: number | null;
healthDemandNote?: string; // 固定文案：健康灯仍按现网预测/历史，缺货日与建议量以时间轴为准
```

- [ ] **Step 1: 扩展 `buildSkuPlanningView` 测试**

现有 `inventory-planning-service.test.ts` 增加：传入 `planningDemandSource: 'demand_plan'` 与 champion 影子日期，断言 view 原样带出。健康灯 `demandSource` 字段保持 `'forecast' | 'historical'` 不变。

- [ ] **Step 2: `loadSkuPlanning` 调用** `buildSkuWarehouseTimeline({ ..., forecastMap: forecastEntry.map, includeChampionShadow: true })`，把返回写入 view。不要把 `health.demandSource` 改成 demand_plan。

- [ ] **Step 3: 扩展前端类型 `SkuPlanningView`**

- [ ] **Step 4: Run planning tests PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: expose demand-plan vs forecast shadow on SKU planning view

EOF
)"
```

---

### Task 7: 生成、发布、快照服务

**Files:**
- Create: `apps/web/server/lib/demand-plan-service.ts`
- Create: `apps/web/server/lib/demand-plan-service.test.ts`（纯函数：版本号、归档旧发布、人工校验）

**Interfaces:**

```ts
export function nextDemandPlanVersionNo(now: Date, seq: number): string;
// DP-YYYYMMDD-01

export function assertManualAdjust(manualDailyAvg: number | null, adjustReason: string | null): void;
// manual != null && reason trim empty → throw status 400

export function shouldArchivePrevious(input: {
  existingStatus: 'draft' | 'pilot_published' | 'archived';
}): boolean; // only pilot_published
```

生成编排（`generateDemandPlanDraft`，可少测 DB，逻辑写进注释并在路由集成时用）：

1. 校验 `projectGroup`/`warehouseCode` 等于 config（否则 400）。
2. 列出该 `project_group` 活跃 SKU，算 excluded SPU，跳过排除项（日志数组返回）。
3. `startMonth` = 当前 UTC `YYYY-MM`，`horizonMonths=12`。
4. 对每个 SKU：加载日销、日快照可用性（`payload.qtyAvailable ?? payload.qty_available ?? 0`，无快照则 availability=[]）、已发布预测 map、周转 share。
5. `U`：有 availability 用 `calcEffectiveDailyDemand`；否则日历 90 日均。
6. 无 share → 不插 monthly（该 SKU 运行时回退预测）。
7. 有预测：各月 `systemDailyAvgForMonth`；无预测：跳过。
8. 插入 draft version + monthly。

发布：同 `(project_group, warehouse_code)` 将旧 `pilot_published` 改为 `archived`；新版本 `pilot_published`+`published_at`。然后对 monthly 中每个 sku 调 `buildSkuWarehouseTimeline` 两次口径写 snapshot（决策已是 demand；影子用 `championTimeline`）。无 timeline 则快照日期空仍插入。

- [ ] **Step 1–4: 纯函数测试 + 实现 + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add demand plan version helpers for generate and publish

EOF
)"
```

实现 `generateDemandPlanDraft` / `publishDemandPlan` / `archiveDemandPlan` / `updateDemandPlanMonth` 于同文件；DB 访问失败时抛 Error。

---

### Task 8: HTTP 路由

**Files:**
- Create: `apps/web/server/routes/demand-plans.ts`
- Modify: `apps/web/server/index.ts` — `app.route('/api/demand-plans', demandPlanRoutes)` 与现有 `requireBusinessRead` / `requireWrite` 同级（生成/发布用 write，GET 用 read）
- Create: `apps/web/server/routes/demand-plans.test.ts` 只测校验函数若已抽到 route 文件则测 400 条件

路由：

| Method | Path | Body/Query |
|--------|------|------------|
| GET | `/` | 版本列表 |
| GET | `/:id` | 版本 + monthly（可 query skuCode） |
| POST | `/generate` | `{ projectGroup, warehouseCode, versionName? }` |
| POST | `/:id/publish` | |
| POST | `/:id/archive` | |
| PATCH | `/:id/months/:monthId` | `{ manualDailyAvg, adjustReason }` 仅 draft |

`generate` 前读 config：`enabled` 可为 false 仍允许生成草稿（便于通路），但 publish 在 `enabled===false` 时仍允许发布（消费侧不命中）。不要在 publish 时强开开关。

- [ ] **Step 1: 挂载 + 最小 400：generate 缺 projectGroup**

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add demand plan pilot HTTP API

EOF
)"
```

---

### Task 9: 前端工作台、规划对照、预测提示

**Files:**
- Modify: `apps/web/src/lib/api.ts` — demand plan API + planning 新字段
- Create: `apps/web/src/pages/DemandPlanPilotPage.tsx`
- Modify: `apps/web/src/router.tsx` — `data/demand-plan`
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`

**API 客户端（贴入 `api` 对象）：**

```ts
listDemandPlanVersions: () => request<Array<{ id: string; versionNo: string; versionName: string; status: string; projectGroup: string; warehouseCode: string }>>('/api/demand-plans'),
getDemandPlan: (id: string) => request<{ version: {...}; months: Array<{ id: string; skuCode?: string; period: string; systemDailyAvg: string; manualDailyAvg: string | null; championForecastDaily: string | null; source: string }> }>(`/api/demand-plans/${id}`),
generateDemandPlan: (body: { projectGroup: string; warehouseCode: string; versionName?: string }) =>
  request('/api/demand-plans/generate', { method: 'POST', body: JSON.stringify(body) }),
publishDemandPlan: (id: string) => request(`/api/demand-plans/${id}/publish`, { method: 'POST' }),
archiveDemandPlan: (id: string) => request(`/api/demand-plans/${id}/archive`, { method: 'POST' }),
updateDemandPlanMonth: (versionId: string, monthId: string, body: { manualDailyAvg: number | null; adjustReason: string }) =>
  request(`/api/demand-plans/${versionId}/months/${monthId}`, { method: 'PATCH', body: JSON.stringify(body) }),
```

工作台：列表 → 生成（项目组输入、仓默认 `US-WEST`）→ 明细表系统/人工/Champion → 发布/归档。不要复制预测矩阵全套交互。

规划页：需求口径旁增加「时间轴需求：需求计划|销售预测」；`championStockoutDateConfirmed` 有值则展示「若用预测缺货日」；`healthDemandNote` 展示在健康灯旁。

预测列表页顶部：`DEMAND_PLAN` 不在浏览器读 env 时，用 `GET /api/demand-plans` 若存在 `pilot_published` 则显示：「已发布需求计划试点，匹配项目组在 US-WEST 的补货以需求计划为准，本页改预测不改变该仓建议。」

- [ ] **Step 1: 实现 UI**

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add demand plan pilot UI and planning shadow columns

EOF
)"
```

---

### Task 10: 环境变量示例与通路回归

**Files:**
- Modify: `.env.example`（若文件只读，改仓库内已有 example 路径）增加：

```
# 需求计划试点（默认关闭）。启用后仅所列项目组 × 仓的时间轴/补货吃需求计划。
DEMAND_PLAN_PILOT_ENABLED=false
DEMAND_PLAN_PILOT_PROJECT_GROUPS=
DEMAND_PLAN_PILOT_WAREHOUSES=US-WEST
```

- [ ] **Step 1: 跑相关测试**

```
pnpm --filter @scm/web exec tsx --test server/lib/demand-plan-config.test.ts server/lib/demand-plan-eligibility.test.ts server/lib/demand-plan-reconstruct.test.ts server/lib/demand-plan-resolve.test.ts server/lib/demand-plan-service.test.ts server/lib/inventory-timeline-demand.test.ts server/lib/inventory-planning-service.test.ts
```

Expected: fail 0。

- [ ] **Step 2: 手工通路（实现者执行，不写进 CI）**

1. migrate `0095`
2. 开关 false：抽样 SKU 规划建议量与上线前一致
3. 填小项目组、生成并发布、开关 true：该组 `US-WEST` `planningDemandSource=demand_plan`；`US-EAST` 仍 forecast
4. 归档或开关 false：回到 forecast

- [ ] **Step 3: Commit env example**

```bash
git commit -m "$(cat <<'EOF'
docs: document demand plan pilot env flags

EOF
)"
```

---

## Spec coverage

| Spec 节 | Task |
|---------|------|
| 冻结预测、新表 | 1 |
| 环境开关与项目组/US-WEST | 2, 10 |
| SPU 跨组排除 | 2 |
| 还原 × 形状 × 占比 | 3, 7 |
| resolve 回退 | 4, 5 |
| 时间轴/补货/预警同一入口 | 5 |
| 规划影子列 | 6, 9 |
| 生成发布快照 | 7, 8 |
| 工作台/预测提示 | 9 |
| 健康灯不改 | 6 |
| 不做紧急出货等 | 未排任务 |

## 执行注意

Task 4 与 Task 5 对 `resolvePlanningDemandFromInputs` 的 `stationForecastMap` 必须一致；若 Task 4 已按旧签名提交，Task 5 第一步先改测试再改函数，不要留两套签名。
