# 规划地平线：6 个月 + 26 周 + 采用位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月预测固定 6 个月；需求计划改为 26 个 ISO 周；补货只读组×仓采用位；规划近窗 `U` 截止昨天，V4.1 训练仍截上月末。

**Architecture:** 先锁月预测常量与 API。再增 `demand_plan_weekly` / `planning_demand_adoptions`。纯函数处理 ISO 周、规划近窗、月形状插值到周。`resolvePlanningDemandFromInputs` 改认采用位；生成不再写 `demand_plan_monthly`。时间轴日余额公式不改。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `node:test` via `pnpm --filter @scm/web exec tsx --test`

**Spec:** `docs/superpowers/specs/2026-09-22-planning-horizon-weekly-monthly-design.md`

## Global Constraints

- **不改** V4.1 / `effectiveRecentWindowEnd` / `forecast-baseline` 生成公式。
- **不改** `projectDailyInventory` 日余额公式。
- **不把** 周计划写入 `sales_forecast_monthly`。
- **健康灯**仍用现网预测/历史；决策缺货日/建议量以时间轴为准。
- **开关默认 off**：`DEMAND_PLAN_PILOT_ENABLED` 非 `true` 时忽略采用位，全部回月预测。
- **本期不做**当月剩余日缩放、导销量自动生成、分层预测地平线、周 WMAPE 门禁、自动转 PMC。
- 中文 UI；标识符英文。迁移号：磁盘已有 `0097` → 本 plan 用 `0098`；若冲突取磁盘最大 +1。
- 测试命令：`pnpm --filter @scm/web exec tsx --test <files>`；Expected: `fail 0`。

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/forecast-limits.ts` | `FORECAST_HORIZON_MONTHS = 6`，`MAX_FORECAST_MONTH_COUNT = 6` |
| `apps/web/src/lib/forecast-horizon-meta.ts` | 前端同期常量；去掉 3/12 选项 |
| `apps/web/server/routes/sales-forecast.ts` | `monthCount` 必须为 6 |
| `apps/web/server/lib/forecast-collaboration.ts` | 生成地平线默认 6 |
| `apps/web/src/pages/SalesForecastListPage.tsx` | 去掉月数下拉 |
| `packages/db/src/schema/demand-plan.ts` | weekly / adoptions / start_week |
| `packages/db/drizzle/0098_demand_plan_weekly_adoption.sql` | 迁移 |
| `apps/web/server/lib/planning-calendar.ts` | ISO 周、规划近窗昨天 |
| `apps/web/server/lib/forecast-demand.ts` | 按周键取日均 |
| `apps/web/server/lib/demand-plan-reconstruct.ts` | 月形状 → 周日加权 |
| `apps/web/server/lib/demand-plan-service.ts` | 生成 26 周；发布/采用 |
| `apps/web/server/lib/demand-plan-resolve.ts` | 采用位 + weekly Map |
| `apps/web/server/lib/demand-plan-load.ts` | 读 weekly + adoption |
| `apps/web/server/routes/demand-plans.ts` | 发布并采用、采用月、改周行 |
| `apps/web/src/pages/DemandPlanPilotPage.tsx` | 26 周矩阵 + 采用按钮 |
| `apps/web/src/pages/SkuInventoryPlanningPage.tsx` | 采用位文案 |

---

### Task 1: 月预测地平线锁死 6 个月

**Files:**
- Modify: `apps/web/server/lib/forecast-limits.ts`
- Modify: `apps/web/src/lib/forecast-horizon-meta.ts`
- Modify: `apps/web/server/routes/sales-forecast.ts`（`MIN_BASELINE_MONTH_COUNT` / `MAX_BASELINE_MONTH_COUNT` / 默认 `monthCount`）
- Modify: `apps/web/server/lib/forecast-collaboration.ts`（`buildMonthlyForecastHorizon(today, input.monthCount ?? 12)` → `FORECAST_HORIZON_MONTHS`）
- Modify: `apps/web/server/lib/forecast-walkforward-backtest.ts`（新跑次固定 6）
- Create: `apps/web/server/lib/forecast-horizon-lock.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `export const FORECAST_HORIZON_MONTHS = 6`；`MAX_FORECAST_MONTH_COUNT = 6`；API 非 6 → 400

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORECAST_HORIZON_MONTHS, MAX_FORECAST_MONTH_COUNT } from './forecast-limits.js';

describe('forecast horizon lock', () => {
  it('locks generation horizon to 6 months', () => {
    assert.equal(FORECAST_HORIZON_MONTHS, 6);
    assert.equal(MAX_FORECAST_MONTH_COUNT, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/forecast-horizon-lock.test.ts`  
Expected: FAIL（`MAX_FORECAST_MONTH_COUNT` 仍为 12）

- [ ] **Step 3: Write minimal implementation**

`forecast-limits.ts`：

```ts
export const FORECAST_HORIZON_MONTHS = 6;
export const MAX_FORECAST_MONTH_COUNT = FORECAST_HORIZON_MONTHS;
```

`forecast-horizon-meta.ts`：

```ts
export const FORECAST_HORIZON_MONTHS = 6;
export const MAX_FORECAST_MONTH_COUNT = 6;
export const FORECAST_GENERATION_MONTH_OPTIONS = [6] as const;
export const FORECAST_HORIZON_FUTURE_MONTH_OPTIONS = [3, 6] as const;
export const HORIZON_BAND_LABELS: Record<HorizonBand, string> = {
  precision: '1–3 月（精准备货）',
  flex: '3–6 月（生产柔性）',
  strategic: '6 月地平线',
};
```

`sales-forecast.ts` 生成 baseline：

```ts
import { FORECAST_HORIZON_MONTHS, MAX_FORECAST_MONTH_COUNT } from '../lib/forecast-limits.js';

const monthCount = body.monthCount ?? FORECAST_HORIZON_MONTHS;
if (monthCount !== FORECAST_HORIZON_MONTHS) {
  return c.json({ message: `monthCount 仅支持 ${FORECAST_HORIZON_MONTHS}` }, 400);
}
```

`forecast-collaboration.ts`：`buildMonthlyForecastHorizon(today, FORECAST_HORIZON_MONTHS)`（忽略传入的其他 monthCount；调用方已校验）。

`forecast-walkforward-backtest.ts`：`const monthCount = FORECAST_HORIZON_MONTHS;`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/forecast-horizon-lock.test.ts apps/web/server/lib/forecast-baseline.test.ts`  
Expected: `fail 0`（`effectiveRecentWindowEnd` 行为不变）

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-limits.ts apps/web/src/lib/forecast-horizon-meta.ts apps/web/server/routes/sales-forecast.ts apps/web/server/lib/forecast-collaboration.ts apps/web/server/lib/forecast-walkforward-backtest.ts apps/web/server/lib/forecast-horizon-lock.test.ts
git commit -m "feat(forecast): lock generation horizon to 6 months"
```

---

### Task 2: 预测页去掉月数选择

**Files:**
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx` — 删除 `generationMonthCount` state 与下拉；生成固定传 `monthCount: 6`；列表 `version.stats.monthCount` 若不是 6 显示「历史周期」
- Modify: `apps/web/src/components/ForecastSkuDetailDrawer.tsx` — 若仍用 `MAX_FORECAST_MONTH_COUNT` 作默认展示月数，改为 6（历史销量 24 月不动）

**Interfaces:**
- Consumes: `FORECAST_HORIZON_MONTHS` from `@/lib/forecast-horizon-meta`
- Produces: 生成请求始终 `{ monthCount: 6 }`

- [ ] **Step 1: Remove the month-count select**

生成区改为：

```tsx
<span className="text-sm text-text-sub">预测周期：固定 6 个月</span>
```

`generateBaseline.mutate` body 使用 `monthCount: FORECAST_HORIZON_MONTHS`。删除 `FORECAST_GENERATION_MONTH_OPTIONS` 的 map。

列表版本行：

```tsx
<span className="text-text-sub">
  {' · '}
  {version.stats.monthCount || '-'} 月
  {version.stats.monthCount && version.stats.monthCount !== 6 ? '（历史周期）' : ''}
</span>
```

- [ ] **Step 2: Typecheck / lint the two pages**

Run: `pnpm --filter @scm/web exec tsc --noEmit --pretty false`（若项目惯用单测代替，至少保证页面无未定义变量）  
Expected: 无 `generationMonthCount` 引用错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/SalesForecastListPage.tsx apps/web/src/components/ForecastSkuDetailDrawer.tsx
git commit -m "feat(forecast): drop 3/12 month picker on generate form"
```

---

### Task 3: Schema — weekly 行、采用位、start_week

**Files:**
- Modify: `packages/db/src/schema/demand-plan.ts`
- Create: `packages/db/drizzle/0098_demand_plan_weekly_adoption.sql`

**Interfaces:**
- Produces: `demandPlanWeekly`；`planningDemandAdoptions`；`demandPlanVersions.startWeek` / `horizonWeeks`

- [ ] **Step 1: Extend schema**

在 `demandPlanVersions` 增加：

```ts
startWeek: varchar('start_week', { length: 8 }),
horizonWeeks: integer('horizon_weeks'),
```

`startMonth` / `horizonMonths` 保留（旧行、兼容）。

新增表（字段对齐 spec §5.3 / §5.4）：

```ts
export const demandPlanWeekly = pgTable(
  'demand_plan_weekly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id').notNull().references(() => demandPlanVersions.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id').notNull().references(() => skus.id, { onDelete: 'cascade' }),
    warehouseCode: varchar('warehouse_code', { length: 50 }).notNull(),
    period: varchar('period', { length: 8 }).notNull(),
    systemDailyAvg: numeric('system_daily_avg', { precision: 12, scale: 4 }).notNull(),
    manualDailyAvg: numeric('manual_daily_avg', { precision: 12, scale: 4 }),
    adjustReason: text('adjust_reason'),
    unconstrainedRecentDaily: numeric('unconstrained_recent_daily', { precision: 12, scale: 4 }),
    championForecastDaily: numeric('champion_forecast_daily', { precision: 12, scale: 4 }),
    source: varchar('source', { length: 30 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('demand_plan_weekly_unique_idx').on(
      table.versionId, table.skuId, table.warehouseCode, table.period,
    ),
  }),
);

export const planningDemandAdoptions = pgTable(
  'planning_demand_adoptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectGroup: varchar('project_group', { length: 20 }).notNull(),
    warehouseCode: varchar('warehouse_code', { length: 50 }).notNull(),
    source: varchar('source', { length: 20 }).notNull(),
    demandPlanVersionId: uuid('demand_plan_version_id').references(() => demandPlanVersions.id, {
      onDelete: 'set null',
    }),
    adoptedAt: timestamp('adopted_at', { withTimezone: true }).notNull().defaultNow(),
    adoptedBy: uuid('adopted_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('planning_demand_adoptions_group_wh_unique_idx').on(
      table.projectGroup, table.warehouseCode,
    ),
  }),
);
```

relations：versions `weeks: many(demandPlanWeekly)`。

- [ ] **Step 2: Write SQL migration `0098_demand_plan_weekly_adoption.sql`**

```sql
ALTER TABLE "demand_plan_versions"
  ADD COLUMN IF NOT EXISTS "start_week" varchar(8),
  ADD COLUMN IF NOT EXISTS "horizon_weeks" integer;

CREATE TABLE IF NOT EXISTS "demand_plan_weekly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "demand_plan_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "warehouse_code" varchar(50) NOT NULL,
  "period" varchar(8) NOT NULL,
  "system_daily_avg" numeric(12, 4) NOT NULL,
  "manual_daily_avg" numeric(12, 4),
  "adjust_reason" text,
  "unconstrained_recent_daily" numeric(12, 4),
  "champion_forecast_daily" numeric(12, 4),
  "source" varchar(30) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "demand_plan_weekly_unique_idx"
  ON "demand_plan_weekly" ("version_id", "sku_id", "warehouse_code", "period");

CREATE TABLE IF NOT EXISTS "planning_demand_adoptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_group" varchar(20) NOT NULL,
  "warehouse_code" varchar(50) NOT NULL,
  "source" varchar(20) NOT NULL,
  "demand_plan_version_id" uuid REFERENCES "demand_plan_versions"("id") ON DELETE SET NULL,
  "adopted_at" timestamptz NOT NULL DEFAULT now(),
  "adopted_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "planning_demand_adoptions_group_wh_unique_idx"
  ON "planning_demand_adoptions" ("project_group", "warehouse_code");
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/demand-plan.ts packages/db/drizzle/0098_demand_plan_weekly_adoption.sql
git commit -m "feat(db): add demand_plan_weekly and planning adoptions"
```

---

### Task 4: ISO 周、规划近窗、按周取日均

**Files:**
- Create: `apps/web/server/lib/planning-calendar.ts`
- Create: `apps/web/server/lib/planning-calendar.test.ts`
- Modify: `apps/web/server/lib/forecast-demand.ts` — `getForecastDailyForDate` 识别周键
- Modify: `apps/web/server/lib/forecast-demand.test.ts`

**Interfaces:**
- Produces:

```ts
export const DEMAND_PLAN_HORIZON_WEEKS = 26;
export function isIsoWeekPeriod(key: string): boolean; // /^\d{4}-W\d{2}$/
export function isoWeekKeyFromUtcDate(date: Date): string; // 2026-W03
export function addIsoWeeks(startWeek: string, offset: number): string;
export function buildIsoWeekHorizon(asOf: Date, count = 26): string[];
export function planningRecentWindowEnd(asOf: Date): Date; // Asia/Shanghai 昨天 00:00 UTC
export function monthKeyFromUtcDate(date: Date): string; // YYYY-MM
```

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addIsoWeeks,
  buildIsoWeekHorizon,
  isoWeekKeyFromUtcDate,
  planningRecentWindowEnd,
} from './planning-calendar.js';
import { getForecastDailyForDate } from './forecast-demand.js';

describe('planning-calendar', () => {
  it('uses ISO week Monday and 26-week horizon containing asOf', () => {
    // 2026-01-15 Thursday → ISO 2026-W03 (Mon 2026-01-12)
    assert.equal(isoWeekKeyFromUtcDate(new Date('2026-01-15T00:00:00.000Z')), '2026-W03');
    const weeks = buildIsoWeekHorizon(new Date('2026-01-15T00:00:00.000Z'), 26);
    assert.equal(weeks.length, 26);
    assert.equal(weeks[0], '2026-W03');
    assert.equal(weeks[25], addIsoWeeks('2026-W03', 25));
  });

  it('planning window ends yesterday in Asia/Shanghai', () => {
    const end = planningRecentWindowEnd(new Date('2026-01-15T02:00:00.000Z'));
    assert.equal(end.toISOString().slice(0, 10), '2026-01-14');
  });
});

describe('getForecastDailyForDate week map', () => {
  it('reads ISO week keys without month seasonal fallback', () => {
    const map = new Map([['2026-W03', 8]]);
    assert.equal(getForecastDailyForDate(map, new Date('2026-01-15T00:00:00.000Z'), 1), 8);
    assert.equal(getForecastDailyForDate(map, new Date('2026-01-20T00:00:00.000Z'), 1), 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/planning-calendar.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: Implement calendar**

ISO 周（UTC 日期）：

```ts
export function isoWeekKeyFromUtcDate(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
```

`planningRecentWindowEnd`：用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' })` 得到 asOf 的上海日历日，减 1 天，返回 `new Date(Date.UTC(y, m-1, d))`。

`getForecastDailyForDate` 开头：

```ts
const firstKey = forecasts.keys().next().value as string | undefined;
if (firstKey && isIsoWeekPeriod(firstKey)) {
  const value = forecasts.get(isoWeekKeyFromUtcDate(date));
  if (value != null && value > 0) return value;
  return fallbackDaily;
}
```

周 Map **不要**走「同月跨年」兜底。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/planning-calendar.test.ts apps/web/server/lib/forecast-demand.test.ts`  
Expected: `fail 0`（原月 Map 跨年兜底仍过）

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/planning-calendar.ts apps/web/server/lib/planning-calendar.test.ts apps/web/server/lib/forecast-demand.ts apps/web/server/lib/forecast-demand.test.ts
git commit -m "feat(planning): add ISO week horizon and yesterday window"
```

---

### Task 5: 月形状插值到周

**Files:**
- Modify: `apps/web/server/lib/demand-plan-reconstruct.ts`
- Modify: `apps/web/server/lib/demand-plan-reconstruct.test.ts`

**Interfaces:**
- Consumes: `isoWeekKeyFromUtcDate`, `addIsoWeeks`, `monthKeyFromUtcDate`, `clipDemandShape`, `systemDailyAvgForMonth`
- Produces:

```ts
export function weekWeightedForecastDaily(
  weekKey: string,
  monthlyDaily: Map<string, number>,
): number;

export function systemDailyAvgForWeek(input: {
  unconstrainedRecentDaily: number;
  share: number;
  weekForecastDaily: number;
  championRefDaily: number;
}): number; // 内部调用 systemDailyAvgForMonth({ monthForecastDaily: weekForecastDaily, ... })
```

- [ ] **Step 1: Write failing tests**

跨月周：`2026-W05` = Mon 2026-01-26 … Sun 2026-02-01 → 6 天 1 月 + 1 天 2 月。

```ts
it('weights a split week by calendar days', () => {
  const monthly = new Map([['2026-01', 10], ['2026-02', 20]]);
  const daily = weekWeightedForecastDaily('2026-W05', monthly);
  assert.equal(daily, Math.round(((10 * 6 + 20 * 1) / 7) * 10000) / 10000);
});

it('treats missing month as 0 and does not fill from F_ref', () => {
  const monthly = new Map([['2026-01', 10]]);
  const daily = weekWeightedForecastDaily('2026-W05', monthly);
  assert.equal(daily, Math.round(((10 * 6 + 0 * 1) / 7) * 10000) / 10000);
});
```

需要先实现「周键 → 该周周一 UTC」。`2026-W05` 周一是 `2026-01-26`。在 `planning-calendar.ts` 增加 `isoWeekMondayUtc(weekKey: string): Date`，Task 4 若未写则本任务补上并单测。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-reconstruct.test.ts`  
Expected: FAIL `weekWeightedForecastDaily` undefined

- [ ] **Step 3: Implement**

```ts
export function weekWeightedForecastDaily(
  weekKey: string,
  monthlyDaily: Map<string, number>,
): number {
  const monday = isoWeekMondayUtc(weekKey);
  let acc = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday.getTime() + i * 86400000);
    const monthKey = monthKeyFromUtcDate(day);
    acc += monthlyDaily.get(monthKey) ?? 0;
  }
  return Math.round((acc / 7) * 10000) / 10000;
}

export function systemDailyAvgForWeek(input: {
  unconstrainedRecentDaily: number;
  share: number;
  weekForecastDaily: number;
  championRefDaily: number;
}): number {
  return systemDailyAvgForMonth({
    unconstrainedRecentDaily: input.unconstrainedRecentDaily,
    share: input.share,
    monthForecastDaily: input.weekForecastDaily,
    championRefDaily: input.championRefDaily,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-reconstruct.test.ts`  
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/demand-plan-reconstruct.ts apps/web/server/lib/demand-plan-reconstruct.test.ts apps/web/server/lib/planning-calendar.ts apps/web/server/lib/planning-calendar.test.ts
git commit -m "feat(demand-plan): interpolate monthly shape onto ISO weeks"
```

---

### Task 6: 生成 26 周草稿，停写 monthly

**Files:**
- Modify: `apps/web/server/lib/demand-plan-service.ts` — `generateDemandPlanDraft`
- Modify: `apps/web/server/lib/demand-plan-service.test.ts`（若无生成单测则新增纯函数抽取后测「形状不足跳过」）

**Interfaces:**
- Consumes: `buildIsoWeekHorizon`, `planningRecentWindowEnd`, `weekWeightedForecastDaily`, `systemDailyAvgForWeek`, `DEMAND_PLAN_HORIZON_WEEKS`, `FORECAST_HORIZON_MONTHS`
- Produces: 新版本 `startWeek` + `horizonWeeks=26`；插入 `demand_plan_weekly`；**不再** `insert demandPlanMonthly`

生成规则（写进 `generateDemandPlanDraft`）：

1. `asOf = now`；`weeks = buildIsoWeekHorizon(asOf, 26)`；`startWeek = weeks[0]`。
2. `startMonth` 仍写入版本（周起点所在月），`horizonMonths = 6`（文档用，不是行数）。
3. 近 90 销：`windowEnd = planningRecentWindowEnd(asOf)`，加载 `[windowEnd-89, windowEnd]`，**不要**用 `effectiveRecentWindowEnd`。
4. Champion：`loadMergedPublishedForecastBySkuIds`。覆盖 `startMonth` 起连续 6 个 `YYYY-MM` 的键；不足 6 个有值 → skip `no_forecast`（3 月历史版不可用）。
5. `U`：沿用现网 `calcEffectiveDailyDemand`，但 `asOf` 用 `new Date(windowEnd.getTime() + 86400000)`（函数窗到 asOf-1 = windowEnd）。或直接把 sales 截到 windowEnd 再算。不要调用 `effectiveRecentWindowEnd`。
6. 对 26 周各写一行：`systemDailyAvgForWeek`，`championForecastDaily = weekWeighted * share`。
7. `source`：继续 `classifyReconstructSource`；无可用性序列时用 `calendar_recent`（spec 允许；若现网 enum 无此值，写入 `calendar_recent` 字符串即可）。

- [ ] **Step 1: Add a unit test for “3-month champion is insufficient”**

在 service 中抽出：

```ts
export function championCoversHorizon(
  forecastMap: Map<string, number>,
  startMonth: string,
  monthCount: number,
): boolean {
  // startMonth 起连续 monthCount 个键均存在且 >0
}
```

测试：3 个月 Map → false；6 个月 → true；12 个月取前 6 → true。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-service.test.ts`  
Expected: FAIL until helper exists

- [ ] **Step 3: Switch generate to weekly inserts**

替换 `horizonMonths(startMonth, 12)` / `insert demandPlanMonthly` 为 weekly 循环与 `insert demandPlanWeekly`。版本 values：

```ts
startWeek,
horizonWeeks: DEMAND_PLAN_HORIZON_WEEKS,
startMonth,
horizonMonths: FORECAST_HORIZON_MONTHS,
```

- [ ] **Step 4: Run service + reconstruct tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-service.test.ts apps/web/server/lib/demand-plan-reconstruct.test.ts`  
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/demand-plan-service.ts apps/web/server/lib/demand-plan-service.test.ts
git commit -m "feat(demand-plan): generate 26 ISO weeks instead of 12 months"
```

---

### Task 7: Resolver 与 load 改认采用位

**Files:**
- Modify: `apps/web/server/lib/demand-plan-resolve.ts`
- Modify: `apps/web/server/lib/demand-plan-resolve.test.ts`
- Modify: `apps/web/server/lib/demand-plan-load.ts`
- Modify: `apps/web/server/lib/demand-plan-load.test.ts`（有则改；无则为本任务新增 load 单测，deps 注入 adoption）

**Interfaces:**
- Consumes: `planningDemandAdoptions`、`demandPlanWeekly`
- Produces: 扩展 input：

```ts
type ResolvePlanningDemandInput = {
  pilotEnabled: boolean;
  adoptionSource: 'forecast' | 'demand_plan';
  excludedSpu: boolean;
  hasShare: boolean;
  demandRows: DemandRow[]; // period 可为 YYYY-Www
  championWarehouseRows: ChampionRow[];
  stationForecastMap: Map<string, number>;
};
```

```text
useWeekly = pilotEnabled && adoptionSource === 'demand_plan' && demandRows.length > 0 && hasShare && !excludedSpu
```

兼容：把旧字段 `inPilot` 删掉，**所有** `resolvePlanningDemandFromInputs` 调用点（含测试）改新字段。  
`inPilot: true` 旧语义 = `pilotEnabled: true, adoptionSource: 'demand_plan'`。

`defaultLoadPublishedDemandRows` 改为读 **adopted** `demand_plan_weekly`（`adoptions.source=demand_plan` 且 `version_id` 匹配且 version `pilot_published`）。不要再扫任意 `pilot_published` monthly。

`loadPlanningDemandForSkuWarehouse`：

```ts
if (!config.enabled) {
  return resolvePlanningDemandFromInputs({
    pilotEnabled: false,
    adoptionSource: 'forecast',
    ...
  });
}
const adoption = await loadAdoption(projectGroup, warehouse) // 无行 → forecast
```

- [ ] **Step 1: Rewrite resolve tests**

把现有 `inPilot: true` 改为 `pilotEnabled: true, adoptionSource: 'demand_plan'`。  
新增：

```ts
it('ignores weekly rows when pilot disabled even if adopted', () => {
  const result = resolvePlanningDemandFromInputs(
    baseInput({ pilotEnabled: false, adoptionSource: 'demand_plan', demandRows }),
  );
  assert.equal(result.source, 'forecast');
});

it('uses forecast when adopted weekly but demandRows empty', () => {
  const result = resolvePlanningDemandFromInputs(
    baseInput({
      pilotEnabled: true,
      adoptionSource: 'demand_plan',
      demandRows: [],
    }),
  );
  assert.equal(result.source, 'forecast');
  assert.deepEqual(result.flags, ['demand_missing_fallback_forecast']);
});
```

周键行：`period: '2026-W03'` 必须进入 `demandMap`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-resolve.test.ts`  
Expected: FAIL 旧 `inPilot` 字段

- [ ] **Step 3: Implement resolve + load**

按上面 input 改纯函数与 loader。`fallbackDaily`：周命中用 demandMap 按 period 排序后最后 3 个正值均值（现网 `meanOfLastThreePositive` 已按 key 排序，周键 `2026-W09` 字序可用）。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-resolve.test.ts apps/web/server/lib/demand-plan-load.test.ts`  
Expected: `fail 0`

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/demand-plan-resolve.ts apps/web/server/lib/demand-plan-resolve.test.ts apps/web/server/lib/demand-plan-load.ts apps/web/server/lib/demand-plan-load.test.ts
git commit -m "feat(demand-plan): resolve replenishment from explicit adoption"
```

---

### Task 8: 发布 / 发布并采用 / 采用月 / 归档回退

**Files:**
- Modify: `apps/web/server/lib/demand-plan-service.ts` — `publishDemandPlan`、`archiveDemandPlan`、新增 `adoptDemandPlan` / `adoptForecast`
- Modify: `apps/web/server/routes/demand-plans.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces:

```ts
export async function publishDemandPlan(params: {
  versionId: string;
  publishedBy?: string;
  adopt?: boolean;
}): Promise<{ version: DemandPlanVersion; adoption: AdoptionRow | null }>;

export async function adoptDemandPlan(params: {
  versionId: string;
  adoptedBy?: string;
}): Promise<AdoptionRow>;

export async function adoptForecast(params: {
  projectGroup: string;
  warehouseCode: string;
  adoptedBy?: string;
}): Promise<AdoptionRow>;
```

采用前校验（`canAdoptWeeklyVersion(versionId)`）：

- status === `pilot_published`（`adopt` 时由 publish 先完成）
- `horizonWeeks === 26` 且 `startWeek` 非空
- 存在 ≥1 个 SKU 恰好 26 周行
- 不存在 1–25 行的部分 SKU  
否则 `httpError('该版本周行不完整，不能采用', 400)`。  
仅有 monthly 的旧版：不可采用。

`publishDemandPlan`：**不**改采用位，除非 `adopt===true`（先发布再 `adoptDemandPlan`）。  
`archiveDemandPlan`：若采用行指向该 versionId → `adoptForecast`。

路由：

- `POST /demand-plans/:id/publish` body `{ adopt?: boolean }`
- `POST /demand-plans/:id/adopt`
- `POST /demand-plans/adopt-forecast` body `{ projectGroup, warehouseCode }`
- `PATCH /demand-plans/:id/weeks/:weekId`（从 months 复制校验；旧 `.../months/:monthId` 保留只读历史）

详情 GET：同时返回 `weeks`（weekly 表）与 `months`（旧数据）；`adoption` 当前组×仓采用行。

- [ ] **Step 1: Unit-test canAdoptWeeklyVersion**

```ts
assert.equal(canAdoptWeeklyCounts([26, 26]), true);
assert.equal(canAdoptWeeklyCounts([26, 13]), false);
assert.equal(canAdoptWeeklyCounts([]), false);
assert.equal(canAdoptWeeklyCounts([26]), true);
```

- [ ] **Step 2: Run to fail, then implement counts helper + service/routes**

- [ ] **Step 3: Run** `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/demand-plan-service.test.ts apps/web/server/routes/demand-plans.test.ts`  
Expected: `fail 0`

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/lib/demand-plan-service.ts apps/web/server/routes/demand-plans.ts apps/web/src/lib/api.ts apps/web/server/lib/demand-plan-service.test.ts apps/web/server/routes/demand-plans.test.ts
git commit -m "feat(demand-plan): publish without adopt; explicit adopt weekly or monthly"
```

---

### Task 9: 需求计划页与规划页文案

**Files:**
- Modify: `apps/web/src/pages/DemandPlanPilotPage.tsx`
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx` — 提示改为「采用周计划的组×仓：改月预测不改该仓建议」

**Interfaces:**
- Consumes: `api.publishDemandPlan(id, { adopt })`、`api.adoptDemandPlan`、`api.adoptForecast`、详情 `weeks` + `adoption`

- [ ] **Step 1: Update DemandPlanPilotPage**

- 矩阵列：`detail.weeks ?? detail.months`，表头「周」/「月」。
- 当前采用位：`forecast` → 「补货：月预测」；`demand_plan` → 「补货：周计划 {versionNo}」。
- 按钮：「发布」（`adopt: false`）、「发布并采用」（`adopt: true`）、「采用月预测」（`adoptForecast`）。草稿不可采用。
- 手工改数走 `updateDemandPlanWeek`。

- [ ] **Step 2: Planning page**

在需求口径旁增加：`planningDemandSource`（时间轴已有则展示 `demand_plan` / `forecast`）。文案：

```tsx
需求决策：{source === 'demand_plan' ? '已采用周需求计划' : '已发布月预测'}
```

不要改健康灯那一行的 `demandSource`。

- [ ] **Step 3: Manual click-path check**（无浏览器则过类型）

Run: `pnpm --filter @scm/web exec tsc --noEmit --pretty false`  
Expected: 无新增 TS 错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/DemandPlanPilotPage.tsx apps/web/src/pages/SkuInventoryPlanningPage.tsx apps/web/src/pages/SalesForecastListPage.tsx apps/web/src/lib/api.ts
git commit -m "feat(demand-plan): weekly matrix and adopt actions"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| 月预测仅 6 月、3/12 → 400 | 1 |
| UI 去月数、历史周期标注 | 2 |
| weekly 表 + adoptions + start_week | 3 |
| ISO 26 周、规划昨天、按周取日 | 4 |
| 跨月周日加权、clip 0.5–2 | 5 |
| 生成 26 周、停 monthly、3 月 Champion 不可用 | 6 |
| 采用位消费；开关 off 忽略采用 | 7 |
| 发布不采用；发布并采用；采用月；归档回退 | 8 |
| 页面按钮与文案 | 9 |
| 不改 V4.1 / 时间轴公式 / 健康灯 | 全局约束 |
| 当月剩余日缩放、自动导入生成 | 明确不做 |

## Type names (locked)

- `FORECAST_HORIZON_MONTHS` / `DEMAND_PLAN_HORIZON_WEEKS`
- `planningRecentWindowEnd` / `isoWeekKeyFromUtcDate` / `weekWeightedForecastDaily`
- `planningDemandAdoptions.source`: `'forecast' | 'demand_plan'`
- `ResolvePlanningDemandInput.pilotEnabled` + `adoptionSource`（不再使用 `inPilot`）
