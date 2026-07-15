# Sales Forecast Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an operations-assisted sales forecasting workflow that turns the two available sales reports into SKU-level monthly daily forecasts, review items, published versions, accuracy feedback, and replenishment inputs.

**Architecture:** Reuse the existing `sales_history`, `sales_forecast_monthly`, `sales_forecast_versions`, and `forecast_accuracy_monthly` workflow. Add focused forecast source/review/seasonality tables, pure parsing and baseline-generation services under `apps/web/server/lib`, Hono API endpoints in `routes/sales-forecast.ts`, and incremental UI tabs in `SalesForecastPage.tsx`.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, PostgreSQL, React 18, TanStack Query, Vite, XLSX, existing import and forecast modules.

---

## File Structure

- Create `packages/db/drizzle/0030_sales_forecast_collaboration.sql`: migration for source batches, review items, seasonality factors, and supporting enums/indexes.
- Modify `packages/db/src/schema/sales-forecast.ts`: add Drizzle enums/tables/relations for the new forecast collaboration tables.
- Modify `packages/db/src/schema/index.ts`: export the new schema symbols if they are not covered by existing wildcard exports.
- Create `apps/web/server/lib/sales-report-parser.ts`: parse the downloaded daily SKU report and monthly project/category workbook into normalized diagnostics-ready structures.
- Create `apps/web/server/lib/sales-report-parser.test.ts`: unit tests for date-column detection, daily wide-table expansion, and monthly sheet parsing.
- Create `apps/web/server/lib/forecast-baseline.ts`: pure baseline forecast and lifecycle classification logic.
- Create `apps/web/server/lib/forecast-baseline.test.ts`: unit tests for mature/growth/decline/new/intermittent/stockout cases.
- Create `apps/web/server/lib/forecast-collaboration.ts`: DB orchestration for source batches, diagnostics, draft generation, seasonality upserts, and review item generation.
- Create `apps/web/server/lib/forecast-collaboration.test.ts`: integration-style tests around orchestration with mocked repositories or focused pure helper tests where DB test setup is unavailable.
- Modify `apps/web/server/routes/sales-forecast.ts`: add endpoints for diagnostics upload/preview, baseline generation, review-item list/update, and trend summaries.
- Modify `apps/web/server/lib/forecast-accuracy.ts`: create low-accuracy review items when MAPE exceeds threshold.
- Modify `apps/web/src/lib/api.ts`: add TypeScript types and client methods for new forecast collaboration endpoints.
- Modify `apps/web/src/pages/SalesForecastPage.tsx`: add tabs/sections for data diagnosis, baseline generation, review queue, and trends while preserving current forecast/version/accuracy tabs.
- Modify `apps/web/src/pages/ImportPage.tsx` only if we choose to deep-link from import to the forecasting workbench; otherwise leave it unchanged.
- Modify `docs/superpowers/specs/2026-06-29-sales-forecast-collaboration-design.md` only if implementation discovers a PRD ambiguity.

Do not commit unless the user explicitly requests it. The raw downloaded sales files must remain ignored and untracked.

---

## Task 1: Database Schema For Collaboration Workflow

**Files:**
- Create: `packages/db/drizzle/0030_sales_forecast_collaboration.sql`
- Modify: `packages/db/src/schema/sales-forecast.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write migration SQL**

Create `packages/db/drizzle/0030_sales_forecast_collaboration.sql`:

```sql
CREATE TYPE IF NOT EXISTS "forecast_source_batch_status" AS ENUM ('uploaded', 'parsed', 'generated', 'failed');
--> statement-breakpoint
CREATE TYPE IF NOT EXISTS "forecast_review_issue_type" AS ENUM (
  'high_value',
  'trend_shift',
  'stockout_suspected',
  'category_deviation',
  'low_accuracy',
  'missing_history',
  'platform_mix'
);
--> statement-breakpoint
CREATE TYPE IF NOT EXISTS "forecast_review_severity" AS ENUM ('critical', 'warning', 'info');
--> statement-breakpoint
CREATE TYPE IF NOT EXISTS "forecast_review_status" AS ENUM ('pending', 'reviewed', 'ignored');
--> statement-breakpoint
CREATE TYPE IF NOT EXISTS "forecast_seasonality_dimension_type" AS ENUM ('category', 'project_group');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_source_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_no" varchar(50) NOT NULL UNIQUE,
  "daily_file_name" varchar(255),
  "monthly_file_name" varchar(255),
  "daily_start_date" date,
  "daily_end_date" date,
  "monthly_start_month" varchar(7),
  "monthly_end_month" varchar(7),
  "sku_count" integer NOT NULL DEFAULT 0,
  "row_count" integer NOT NULL DEFAULT 0,
  "status" "forecast_source_batch_status" NOT NULL DEFAULT 'uploaded',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_review_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "sales_forecast_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "issue_type" "forecast_review_issue_type" NOT NULL,
  "severity" "forecast_review_severity" NOT NULL,
  "message" text NOT NULL,
  "suggested_daily_avg" numeric(12, 4),
  "reviewed_daily_avg" numeric(12, 4),
  "status" "forecast_review_status" NOT NULL DEFAULT 'pending',
  "reviewer_id" uuid REFERENCES "users"("id"),
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_forecast_review_items_version_status_idx"
  ON "sales_forecast_review_items" ("version_id", "status", "severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_forecast_review_items_sku_idx"
  ON "sales_forecast_review_items" ("sku_id", "station", "platform");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_seasonality" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dimension_type" "forecast_seasonality_dimension_type" NOT NULL,
  "dimension_value" varchar(200) NOT NULL,
  "month" integer NOT NULL,
  "seasonality_factor" numeric(10, 4) NOT NULL,
  "trend_factor" numeric(10, 4),
  "source_batch_id" uuid REFERENCES "sales_forecast_source_batches"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_seasonality_unique_idx"
  ON "sales_forecast_seasonality" ("dimension_type", "dimension_value", "month");
```

- [ ] **Step 2: Add Drizzle schema**

Add to `packages/db/src/schema/sales-forecast.ts` after existing enums:

```ts
export const forecastSourceBatchStatusEnum = pgEnum('forecast_source_batch_status', [
  'uploaded',
  'parsed',
  'generated',
  'failed',
]);

export const forecastReviewIssueTypeEnum = pgEnum('forecast_review_issue_type', [
  'high_value',
  'trend_shift',
  'stockout_suspected',
  'category_deviation',
  'low_accuracy',
  'missing_history',
  'platform_mix',
]);

export const forecastReviewSeverityEnum = pgEnum('forecast_review_severity', [
  'critical',
  'warning',
  'info',
]);

export const forecastReviewStatusEnum = pgEnum('forecast_review_status', [
  'pending',
  'reviewed',
  'ignored',
]);

export const forecastSeasonalityDimensionTypeEnum = pgEnum(
  'forecast_seasonality_dimension_type',
  ['category', 'project_group'],
);
```

Add table definitions below `forecastAccuracyMonthly`:

```ts
export const salesForecastSourceBatches = pgTable(
  'sales_forecast_source_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchNo: varchar('batch_no', { length: 50 }).notNull().unique(),
    dailyFileName: varchar('daily_file_name', { length: 255 }),
    monthlyFileName: varchar('monthly_file_name', { length: 255 }),
    dailyStartDate: timestamp('daily_start_date', { mode: 'date' }),
    dailyEndDate: timestamp('daily_end_date', { mode: 'date' }),
    monthlyStartMonth: varchar('monthly_start_month', { length: 7 }),
    monthlyEndMonth: varchar('monthly_end_month', { length: 7 }),
    skuCount: integer('sku_count').notNull().default(0),
    rowCount: integer('row_count').notNull().default(0),
    status: forecastSourceBatchStatusEnum('status').notNull().default('uploaded'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const salesForecastReviewItems = pgTable(
  'sales_forecast_review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => salesForecastVersions.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    station: varchar('station', { length: 20 }).notNull(),
    platform: varchar('platform', { length: 50 }).notNull().default('ALL'),
    issueType: forecastReviewIssueTypeEnum('issue_type').notNull(),
    severity: forecastReviewSeverityEnum('severity').notNull(),
    message: text('message').notNull(),
    suggestedDailyAvg: numeric('suggested_daily_avg', { precision: 12, scale: 4 }),
    reviewedDailyAvg: numeric('reviewed_daily_avg', { precision: 12, scale: 4 }),
    status: forecastReviewStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionStatusIdx: index('sales_forecast_review_items_version_status_idx').on(
      table.versionId,
      table.status,
      table.severity,
    ),
    skuIdx: index('sales_forecast_review_items_sku_idx').on(
      table.skuId,
      table.station,
      table.platform,
    ),
  }),
);

export const salesForecastSeasonality = pgTable(
  'sales_forecast_seasonality',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dimensionType: forecastSeasonalityDimensionTypeEnum('dimension_type').notNull(),
    dimensionValue: varchar('dimension_value', { length: 200 }).notNull(),
    month: integer('month').notNull(),
    seasonalityFactor: numeric('seasonality_factor', { precision: 10, scale: 4 }).notNull(),
    trendFactor: numeric('trend_factor', { precision: 10, scale: 4 }),
    sourceBatchId: uuid('source_batch_id').references(() => salesForecastSourceBatches.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('sales_forecast_seasonality_unique_idx').on(
      table.dimensionType,
      table.dimensionValue,
      table.month,
    ),
  }),
);
```

- [ ] **Step 3: Add relations**

Add below existing relations in `packages/db/src/schema/sales-forecast.ts`:

```ts
export const salesForecastSourceBatchesRelations = relations(
  salesForecastSourceBatches,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [salesForecastSourceBatches.createdBy],
      references: [users.id],
    }),
    seasonality: many(salesForecastSeasonality),
  }),
);

export const salesForecastReviewItemsRelations = relations(salesForecastReviewItems, ({ one }) => ({
  version: one(salesForecastVersions, {
    fields: [salesForecastReviewItems.versionId],
    references: [salesForecastVersions.id],
  }),
  sku: one(skus, {
    fields: [salesForecastReviewItems.skuId],
    references: [skus.id],
  }),
  reviewer: one(users, {
    fields: [salesForecastReviewItems.reviewerId],
    references: [users.id],
  }),
}));

export const salesForecastSeasonalityRelations = relations(salesForecastSeasonality, ({ one }) => ({
  sourceBatch: one(salesForecastSourceBatches, {
    fields: [salesForecastSeasonality.sourceBatchId],
    references: [salesForecastSourceBatches.id],
  }),
}));
```

- [ ] **Step 4: Verify TypeScript**

Run:

```bash
cd apps/web
pnpm build
```

Expected: TypeScript compiles or reports only pre-existing unrelated issues. If schema imports fail, fix exports in `packages/db/src/schema/index.ts`.

---

## Task 2: Sales Report Parser And Diagnostics

**Files:**
- Create: `apps/web/server/lib/sales-report-parser.ts`
- Create: `apps/web/server/lib/sales-report-parser.test.ts`

- [ ] **Step 1: Write parser tests**

Create `apps/web/server/lib/sales-report-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  detectDailySalesDateColumns,
  parseDailySalesRows,
  parseMonthlySalesWorkbookRows,
  normalizeStationFromReport,
} from './sales-report-parser.js';

describe('sales-report-parser', () => {
  it('detects parenthesized daily date columns', () => {
    const cols = detectDailySalesDateColumns([
      'SKU',
      '站点',
      '平台',
      '(2026-06-26)',
      '(2026-06-25)',
      '总计',
    ]);

    expect(cols).toEqual([
      { key: '(2026-06-26)', saleDate: '2026-06-26' },
      { key: '(2026-06-25)', saleDate: '2026-06-25' },
    ]);
  });

  it('normalizes known station labels', () => {
    expect(normalizeStationFromReport('Amazon美国')).toBe('US');
    expect(normalizeStationFromReport('TEMU-US')).toBe('US');
    expect(normalizeStationFromReport('Amazon德国')).toBe('DE');
    expect(normalizeStationFromReport('wayfair')).toBe('US');
  });

  it('expands daily wide rows into positive long rows and diagnostics', () => {
    const result = parseDailySalesRows([
      {
        SKU: 'DJ502952_1',
        SKU名称: 'Desk',
        站点: 'Amazon美国',
        平台: '亚马逊',
        首单时间: '2023-04-29 07:08:25',
        品类: '办公-桌子',
        '(2026-06-26)': '2',
        '(2026-06-25)': '0',
      },
      {
        SKU: '',
        站点: 'Amazon美国',
        平台: '亚马逊',
        '(2026-06-26)': '5',
      },
    ]);

    expect(result.rows).toEqual([
      {
        skuCode: 'DJ502952_1',
        skuName: 'Desk',
        station: 'US',
        platformRaw: '亚马逊',
        firstOrderAt: '2023-04-29 07:08:25',
        category: '办公-桌子',
        saleDate: '2026-06-26',
        qtySold: 2,
      },
    ]);
    expect(result.diagnostics.skuCount).toBe(1);
    expect(result.diagnostics.errors[0]).toContain('missing SKU');
  });

  it('parses monthly project and category workbook rows', () => {
    const result = parseMonthlySalesWorkbookRows({
      '销量26.5': [
        ['总销量', '', ''],
        ['项目组', '2026-05)', '2026-04)'],
        ['Amazon项目1组', 100, 80],
      ],
      '品类26.5': [
        ['总销量', '', ''],
        ['品类', '2026-05)', '2026-04)'],
        ['办公-桌子', 200, 160],
      ],
    });

    expect(result.rows).toEqual([
      { dimensionType: 'project_group', dimensionValue: 'Amazon项目1组', month: '2026-05', qtySold: 100 },
      { dimensionType: 'project_group', dimensionValue: 'Amazon项目1组', month: '2026-04', qtySold: 80 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-05', qtySold: 200 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-04', qtySold: 160 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd apps/web
pnpm vitest server/lib/sales-report-parser.test.ts --run
```

Expected: FAIL because `sales-report-parser.ts` does not exist. If the repo does not have `vitest`, add a temporary note in the task log and use the repository's existing test command if present.

- [ ] **Step 3: Implement parser**

Create `apps/web/server/lib/sales-report-parser.ts`:

```ts
export type DailySalesLongRow = {
  skuCode: string;
  skuName?: string;
  station: string;
  platformRaw?: string;
  firstOrderAt?: string;
  category?: string;
  saleDate: string;
  qtySold: number;
};

export type DailySalesDiagnostics = {
  rowCount: number;
  expandedRowCount: number;
  skuCount: number;
  startDate?: string;
  endDate?: string;
  stationCounts: Record<string, number>;
  platformCounts: Record<string, number>;
  errors: string[];
};

export type DailySalesParseResult = {
  rows: DailySalesLongRow[];
  diagnostics: DailySalesDiagnostics;
};

export type DailyDateColumn = {
  key: string;
  saleDate: string;
};

export type MonthlyWorkbookRows = Record<string, unknown[][]>;

export type MonthlyTrendRow = {
  dimensionType: 'project_group' | 'category';
  dimensionValue: string;
  month: string;
  qtySold: number;
};

export function detectDailySalesDateColumns(headers: string[]): DailyDateColumn[] {
  return headers
    .map((key) => {
      const match = key.trim().match(/^\((\d{4}-\d{2}-\d{2})\)$/);
      return match ? { key, saleDate: match[1] } : null;
    })
    .filter((item): item is DailyDateColumn => item != null);
}

export function normalizeStationFromReport(raw?: string | null): string {
  const value = raw?.trim();
  if (!value) return 'US';
  if (/德国|DE/i.test(value)) return 'DE';
  if (/英国|UK|GB/i.test(value)) return 'UK';
  if (/美国|US|wayfair|沃尔玛|Shopify|TEMU|Tiktok|eBay/i.test(value)) return 'US';
  return value.toUpperCase();
}

export function parseDailySalesRows(rows: Array<Record<string, string>>): DailySalesParseResult {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const dateCols = detectDailySalesDateColumns(headers);
  const out: DailySalesLongRow[] = [];
  const errors: string[] = [];
  const skuSet = new Set<string>();
  const stationCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  let startDate: string | undefined;
  let endDate: string | undefined;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const skuCode = (row.SKU ?? row.sku ?? row.sku_code ?? '').trim();
    if (!skuCode) {
      errors.push(`Row ${i + 1}: missing SKU`);
      continue;
    }

    const station = normalizeStationFromReport(row.站点 ?? row.station);
    const platformRaw = (row.平台 ?? row.platform ?? '').trim();
    skuSet.add(skuCode);
    stationCounts[station] = (stationCounts[station] ?? 0) + 1;
    if (platformRaw) platformCounts[platformRaw] = (platformCounts[platformRaw] ?? 0) + 1;

    for (const col of dateCols) {
      const qtySold = Number(row[col.key] || 0);
      if (!Number.isFinite(qtySold) || qtySold <= 0) continue;
      startDate = !startDate || col.saleDate < startDate ? col.saleDate : startDate;
      endDate = !endDate || col.saleDate > endDate ? col.saleDate : endDate;
      out.push({
        skuCode,
        skuName: row.SKU名称 ?? row.sku_name,
        station,
        platformRaw,
        firstOrderAt: row.首单时间 ?? row.first_order_at,
        category: row.品类 ?? row.category,
        saleDate: col.saleDate,
        qtySold,
      });
    }
  }

  return {
    rows: out,
    diagnostics: {
      rowCount: rows.length,
      expandedRowCount: out.length,
      skuCount: skuSet.size,
      startDate,
      endDate,
      stationCounts,
      platformCounts,
      errors,
    },
  };
}

function normalizeMonthHeader(value: unknown): string | null {
  const match = String(value ?? '').match(/(\d{4})-(\d{1,2})\)?/);
  if (!match) return null;
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
}

export function parseMonthlySalesWorkbookRows(workbook: MonthlyWorkbookRows): { rows: MonthlyTrendRow[] } {
  const out: MonthlyTrendRow[] = [];

  for (const [sheetName, sheetRows] of Object.entries(workbook)) {
    const dimensionType: MonthlyTrendRow['dimensionType'] = sheetName.includes('品类')
      ? 'category'
      : 'project_group';
    const headerIndex = sheetRows.findIndex((row) =>
      String(row[0] ?? '').includes(dimensionType === 'category' ? '品类' : '项目组'),
    );
    if (headerIndex < 0) continue;

    const headers = sheetRows[headerIndex];
    const monthCols = headers
      .map((header, idx) => ({ idx, month: normalizeMonthHeader(header) }))
      .filter((item): item is { idx: number; month: string } => item.month != null);

    for (const row of sheetRows.slice(headerIndex + 1)) {
      const dimensionValue = String(row[0] ?? '').trim();
      if (!dimensionValue) continue;
      for (const col of monthCols) {
        const qtySold = Number(row[col.idx] || 0);
        if (!Number.isFinite(qtySold)) continue;
        out.push({ dimensionType, dimensionValue, month: col.month, qtySold });
      }
    }
  }

  return { rows: out };
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
cd apps/web
pnpm vitest server/lib/sales-report-parser.test.ts --run
```

Expected: PASS.

---

## Task 3: Baseline Forecast Engine

**Files:**
- Create: `apps/web/server/lib/forecast-baseline.ts`
- Create: `apps/web/server/lib/forecast-baseline.test.ts`

- [ ] **Step 1: Write baseline tests**

Create `apps/web/server/lib/forecast-baseline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifySalesLifecycle,
  computeBaselineDailyAvg,
  buildMonthlyForecastHorizon,
} from './forecast-baseline.js';

describe('forecast-baseline', () => {
  it('builds a 12 month horizon from next full month', () => {
    expect(buildMonthlyForecastHorizon(new Date('2026-06-29'), 3)).toEqual([
      { forecastYear: 2026, month: 7 },
      { forecastYear: 2026, month: 8 },
      { forecastYear: 2026, month: 9 },
    ]);
  });

  it('classifies growth and decline from recent windows', () => {
    expect(classifySalesLifecycle({ ageDays: 300, recent30DailyAvg: 13, recent90DailyAvg: 10, salesDayRatio90: 0.8 })).toBe('growth');
    expect(classifySalesLifecycle({ ageDays: 300, recent30DailyAvg: 6, recent90DailyAvg: 10, salesDayRatio90: 0.8 })).toBe('decline');
  });

  it('classifies new, intermittent, mature, and stockout suspected SKU', () => {
    expect(classifySalesLifecycle({ ageDays: 30, recent30DailyAvg: 2, recent90DailyAvg: 0, salesDayRatio90: 0.4 })).toBe('new');
    expect(classifySalesLifecycle({ ageDays: 300, recent30DailyAvg: 1, recent90DailyAvg: 1, salesDayRatio90: 0.05 })).toBe('intermittent');
    expect(classifySalesLifecycle({ ageDays: 300, recent30DailyAvg: 10, recent90DailyAvg: 10, salesDayRatio90: 0.8 })).toBe('mature');
    expect(classifySalesLifecycle({ ageDays: 300, recent30DailyAvg: 10, recent90DailyAvg: 8, salesDayRatio90: 0.8, maxZeroRunDays: 10 })).toBe('stockout_suspected');
    expect(classifySalesLifecycle({ ageDays: 30, recent30DailyAvg: 2, recent90DailyAvg: 1, salesDayRatio90: 0.4, maxZeroRunDays: 10 })).toBe('new');
    expect(classifySalesLifecycle({ ageDays: 300, recent30DailyAvg: 1, recent90DailyAvg: 1, salesDayRatio90: 0.05, maxZeroRunDays: 10 })).toBe('intermittent');
  });

  it('computes weighted baseline with and without last year same month', () => {
    expect(computeBaselineDailyAvg({ recent90DailyAvg: 10, recent30DailyAvg: 20, lastYearSameMonthDailyAvg: 5 })).toBe(12);
    expect(computeBaselineDailyAvg({ recent90DailyAvg: 10, recent30DailyAvg: 20 })).toBe(13.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd apps/web
pnpm vitest server/lib/forecast-baseline.test.ts --run
```

Expected: FAIL because `forecast-baseline.ts` does not exist.

- [ ] **Step 3: Implement baseline engine**

Create `apps/web/server/lib/forecast-baseline.ts`:

```ts
export type SalesLifecycle =
  | 'mature'
  | 'growth'
  | 'decline'
  | 'new'
  | 'intermittent'
  | 'stockout_suspected';

export type LifecycleInput = {
  ageDays: number;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  salesDayRatio90: number;
  maxZeroRunDays?: number;
};

export function buildMonthlyForecastHorizon(
  today = new Date(),
  monthCount = 12,
): Array<{ forecastYear: number; month: number }> {
  const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return Array.from({ length: monthCount }, (_, idx) => {
    const cursor = new Date(start.getFullYear(), start.getMonth() + idx, 1);
    return { forecastYear: cursor.getFullYear(), month: cursor.getMonth() + 1 };
  });
}

export function classifySalesLifecycle(input: LifecycleInput): SalesLifecycle {
  if (
    (input.maxZeroRunDays ?? 0) >= 7 &&
    input.recent90DailyAvg > 0 &&
    input.ageDays >= 90 &&
    input.salesDayRatio90 >= 0.1
  ) {
    return 'stockout_suspected';
  }
  if (input.ageDays < 90) return 'new';
  if (input.salesDayRatio90 < 0.1) return 'intermittent';
  if (input.recent90DailyAvg > 0 && input.recent30DailyAvg >= input.recent90DailyAvg * 1.3) {
    return 'growth';
  }
  if (input.recent90DailyAvg > 0 && input.recent30DailyAvg <= input.recent90DailyAvg * 0.7) {
    return 'decline';
  }
  return 'mature';
}

export function computeBaselineDailyAvg(input: {
  recent90DailyAvg: number;
  recent30DailyAvg: number;
  lastYearSameMonthDailyAvg?: number | null;
  categoryReferenceDailyAvg?: number | null;
}): number {
  const recent90 = Math.max(0, input.recent90DailyAvg);
  const recent30 = Math.max(0, input.recent30DailyAvg);
  const lastYear = input.lastYearSameMonthDailyAvg;
  const category = input.categoryReferenceDailyAvg;

  if (recent90 > 0 && lastYear != null && lastYear > 0) {
    return roundDaily(recent90 * 0.5 + recent30 * 0.3 + lastYear * 0.2);
  }
  if (recent90 > 0) {
    return roundDaily(recent90 * 0.65 + recent30 * 0.35);
  }
  if (category != null && category > 0) {
    return roundDaily(recent30 * 0.7 + category * 0.3);
  }
  return roundDaily(recent30);
}

export function applyTrendBounds(factor: number): { factor: number; applied: boolean } {
  if (!Number.isFinite(factor) || factor <= 0) return { factor: 1, applied: false };
  if (factor < 0.7 || factor > 1.3) return { factor, applied: false };
  return { factor, applied: true };
}

export function roundDaily(value: number): number {
  return Math.round(value * 10000) / 10000;
}
```

- [ ] **Step 4: Run baseline tests**

Run:

```bash
cd apps/web
pnpm vitest server/lib/forecast-baseline.test.ts --run
```

Expected: PASS.

---

## Task 4: Forecast Collaboration Service

**Files:**
- Create: `apps/web/server/lib/forecast-collaboration.ts`
- Create: `apps/web/server/lib/forecast-collaboration.test.ts`

- [ ] **Step 1: Write helper tests for review item creation**

Create `apps/web/server/lib/forecast-collaboration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildReviewItemsForForecast,
  computeSeasonalityFactors,
} from './forecast-collaboration.js';

describe('forecast-collaboration', () => {
  it('creates trend and missing history review items', () => {
    const items = buildReviewItemsForForecast({
      skuId: 'sku-1',
      skuCode: 'DJ502952_1',
      station: 'US',
      platform: 'AMAZON',
      lifecycle: 'growth',
      baselineDailyAvg: 15,
      suggestedDailyAvg: 15,
      hasEnoughHistory: true,
      categoryTrendApplied: false,
      categoryTrendFactor: 1.45,
    });

    expect(items).toEqual([
      expect.objectContaining({ issueType: 'trend_shift', severity: 'warning' }),
      expect.objectContaining({ issueType: 'category_deviation', severity: 'warning' }),
    ]);
  });

  it('computes bounded month seasonality from monthly trends', () => {
    const factors = computeSeasonalityFactors([
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-04', qtySold: 100 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-05', qtySold: 120 },
    ]);

    expect(factors).toEqual([
      expect.objectContaining({
        dimensionType: 'category',
        dimensionValue: '办公-桌子',
        month: 5,
        trendFactor: 1.2,
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd apps/web
pnpm vitest server/lib/forecast-collaboration.test.ts --run
```

Expected: FAIL because `forecast-collaboration.ts` does not exist.

- [ ] **Step 3: Implement collaboration helpers and orchestration signatures**

Create `apps/web/server/lib/forecast-collaboration.ts` with pure helpers first:

```ts
import { and, eq, sql } from 'drizzle-orm';
import {
  db,
  salesForecastMonthly,
  salesForecastReviewItems,
  salesForecastSeasonality,
  salesForecastSourceBatches,
  salesHistory,
  skus,
} from '@scm/db';
import { findOrCreateDraftVersionForImport } from './forecast-version.js';
import {
  buildMonthlyForecastHorizon,
  classifySalesLifecycle,
  computeBaselineDailyAvg,
  type SalesLifecycle,
} from './forecast-baseline.js';
import type { MonthlyTrendRow } from './sales-report-parser.js';
import { normalizeSalesPlatform } from './forecast-demand.js';

export type ReviewItemDraft = {
  skuId: string;
  station: string;
  platform: string;
  issueType:
    | 'high_value'
    | 'trend_shift'
    | 'stockout_suspected'
    | 'category_deviation'
    | 'low_accuracy'
    | 'missing_history'
    | 'platform_mix';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestedDailyAvg?: number;
};

export function buildReviewItemsForForecast(input: {
  skuId: string;
  skuCode: string;
  station: string;
  platform: string;
  lifecycle: SalesLifecycle;
  baselineDailyAvg: number;
  suggestedDailyAvg: number;
  hasEnoughHistory: boolean;
  categoryTrendApplied: boolean;
  categoryTrendFactor?: number;
}): ReviewItemDraft[] {
  const items: ReviewItemDraft[] = [];
  const base = {
    skuId: input.skuId,
    station: input.station,
    platform: input.platform,
    suggestedDailyAvg: input.suggestedDailyAvg,
  };

  if (!input.hasEnoughHistory) {
    items.push({
      ...base,
      issueType: 'missing_history',
      severity: 'info',
      message: `${input.skuCode} 历史销量不足，已按近期销量或品类参考生成低置信度预测`,
    });
  }

  if (input.lifecycle === 'growth' || input.lifecycle === 'decline') {
    items.push({
      ...base,
      issueType: 'trend_shift',
      severity: 'warning',
      message: `${input.skuCode} 近 30 天趋势相对近 90 天变化超过 30%，需确认是否活动、断货或下架`,
    });
  }

  if (input.lifecycle === 'stockout_suspected') {
    items.push({
      ...base,
      issueType: 'stockout_suspected',
      severity: 'warning',
      message: `${input.skuCode} 存在连续 7 天以上 0 销量后恢复，预测可能被断货压低`,
    });
  }

  if (!input.categoryTrendApplied && input.categoryTrendFactor && input.categoryTrendFactor !== 1) {
    items.push({
      ...base,
      issueType: 'category_deviation',
      severity: 'warning',
      message: `${input.skuCode} 所属品类趋势系数 ${input.categoryTrendFactor.toFixed(2)} 超出自动应用范围，需运营复核`,
    });
  }

  return items;
}

export function computeSeasonalityFactors(rows: MonthlyTrendRow[]) {
  const grouped = new Map<string, MonthlyTrendRow[]>();
  for (const row of rows) {
    const key = `${row.dimensionType}::${row.dimensionValue}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const out: Array<{
    dimensionType: 'category' | 'project_group';
    dimensionValue: string;
    month: number;
    seasonalityFactor: number;
    trendFactor: number;
  }> = [];

  for (const list of grouped.values()) {
    const sorted = [...list].sort((a, b) => a.month.localeCompare(b.month));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const month = Number(current.month.slice(5, 7));
      const trendFactor = prev.qtySold > 0 ? current.qtySold / prev.qtySold : 1;
      out.push({
        dimensionType: current.dimensionType,
        dimensionValue: current.dimensionValue,
        month,
        seasonalityFactor: 1,
        trendFactor: Math.round(trendFactor * 10000) / 10000,
      });
    }
  }

  return out;
}
```

Then add DB orchestration functions below the helpers:

```ts
export async function createForecastSourceBatch(input: {
  dailyFileName?: string;
  monthlyFileName?: string;
  dailyStartDate?: string;
  dailyEndDate?: string;
  monthlyStartMonth?: string;
  monthlyEndMonth?: string;
  skuCount: number;
  rowCount: number;
  createdBy?: string;
}) {
  const batchNo = `FS-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const [row] = await db
    .insert(salesForecastSourceBatches)
    .values({
      batchNo,
      dailyFileName: input.dailyFileName,
      monthlyFileName: input.monthlyFileName,
      dailyStartDate: input.dailyStartDate ? new Date(input.dailyStartDate) : undefined,
      dailyEndDate: input.dailyEndDate ? new Date(input.dailyEndDate) : undefined,
      monthlyStartMonth: input.monthlyStartMonth,
      monthlyEndMonth: input.monthlyEndMonth,
      skuCount: input.skuCount,
      rowCount: input.rowCount,
      status: 'parsed',
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export async function upsertSeasonalityFactors(
  batchId: string,
  factors: ReturnType<typeof computeSeasonalityFactors>,
) {
  for (const factor of factors) {
    await db
      .insert(salesForecastSeasonality)
      .values({
        dimensionType: factor.dimensionType,
        dimensionValue: factor.dimensionValue,
        month: factor.month,
        seasonalityFactor: String(factor.seasonalityFactor),
        trendFactor: String(factor.trendFactor),
        sourceBatchId: batchId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          salesForecastSeasonality.dimensionType,
          salesForecastSeasonality.dimensionValue,
          salesForecastSeasonality.month,
        ],
        set: {
          seasonalityFactor: String(factor.seasonalityFactor),
          trendFactor: String(factor.trendFactor),
          sourceBatchId: batchId,
          updatedAt: new Date(),
        },
      });
  }
}

export async function generateBaselineForecastVersion(input: {
  station: string;
  platform?: string;
  versionName?: string;
  monthCount?: number;
  today?: Date;
}) {
  const station = input.station.toUpperCase();
  const platform = normalizeSalesPlatform(input.platform);
  const draft = await findOrCreateDraftVersionForImport(station);
  const horizon = buildMonthlyForecastHorizon(input.today ?? new Date(), input.monthCount ?? 12);

  const skuRows = await db
    .select({ id: skus.id, code: skus.code, category: skus.category })
    .from(skus)
    .where(eq(skus.isActive, true));

  let forecastRows = 0;
  let reviewRows = 0;

  for (const sku of skuRows) {
    const [agg] = await db
      .select({
        recent30: sql<number>`coalesce(sum(case when ${salesHistory.saleDate} >= current_date - interval '30 day' then ${salesHistory.qtySold} else 0 end), 0)::float / 30`,
        recent90: sql<number>`coalesce(sum(case when ${salesHistory.saleDate} >= current_date - interval '90 day' then ${salesHistory.qtySold} else 0 end), 0)::float / 90`,
        salesDays90: sql<number>`count(distinct case when ${salesHistory.saleDate} >= current_date - interval '90 day' and ${salesHistory.qtySold} > 0 then ${salesHistory.saleDate} end)::float`,
      })
      .from(salesHistory)
      .where(eq(salesHistory.skuId, sku.id));

    const recent30DailyAvg = Number(agg?.recent30 ?? 0);
    const recent90DailyAvg = Number(agg?.recent90 ?? 0);
    const lifecycle = classifySalesLifecycle({
      ageDays: 180,
      recent30DailyAvg,
      recent90DailyAvg,
      salesDayRatio90: Number(agg?.salesDays90 ?? 0) / 90,
    });

    for (const month of horizon) {
      const baselineDailyAvg = computeBaselineDailyAvg({ recent90DailyAvg, recent30DailyAvg });
      await db
        .insert(salesForecastMonthly)
        .values({
          skuId: sku.id,
          station,
          platform,
          forecastYear: month.forecastYear,
          month: month.month,
          forecastDailyAvg: String(baselineDailyAvg),
          baselineDailyAvg: String(baselineDailyAvg),
          lifecycle,
          confidenceLevel: recent90DailyAvg > 0 ? 'medium' : 'low',
          source: 'manual',
          versionId: draft.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            salesForecastMonthly.skuId,
            salesForecastMonthly.station,
            salesForecastMonthly.platform,
            salesForecastMonthly.forecastYear,
            salesForecastMonthly.month,
            salesForecastMonthly.versionId,
          ],
          set: {
            forecastDailyAvg: String(baselineDailyAvg),
            baselineDailyAvg: String(baselineDailyAvg),
            lifecycle,
            confidenceLevel: recent90DailyAvg > 0 ? 'medium' : 'low',
            updatedAt: new Date(),
          },
        });
      forecastRows++;
    }

    const reviewItems = buildReviewItemsForForecast({
      skuId: sku.id,
      skuCode: sku.code,
      station,
      platform,
      lifecycle,
      baselineDailyAvg: recent90DailyAvg,
      suggestedDailyAvg: recent30DailyAvg || recent90DailyAvg,
      hasEnoughHistory: recent90DailyAvg > 0,
      categoryTrendApplied: true,
    });

    for (const item of reviewItems) {
      await db.insert(salesForecastReviewItems).values({
        versionId: draft.id,
        skuId: item.skuId,
        station: item.station,
        platform: item.platform,
        issueType: item.issueType,
        severity: item.severity,
        message: item.message,
        suggestedDailyAvg: item.suggestedDailyAvg != null ? String(item.suggestedDailyAvg) : undefined,
      });
      reviewRows++;
    }
  }

  return { version: draft, forecastRows, reviewRows };
}
```

- [ ] **Step 4: Run collaboration tests**

Run:

```bash
cd apps/web
pnpm vitest server/lib/forecast-collaboration.test.ts --run
```

Expected: PASS for pure helper tests. DB orchestration can be verified through API smoke tests after endpoints are added.

---

## Task 5: Forecast API Endpoints

**Files:**
- Modify: `apps/web/server/routes/sales-forecast.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add server imports**

At the top of `apps/web/server/routes/sales-forecast.ts`, extend imports:

```ts
import { salesForecastReviewItems, salesForecastSeasonality } from '@scm/db';
import {
  createForecastSourceBatch,
  computeSeasonalityFactors,
  generateBaselineForecastVersion,
  upsertSeasonalityFactors,
} from '../lib/forecast-collaboration.js';
import {
  parseDailySalesRows,
  parseMonthlySalesWorkbookRows,
  type MonthlyWorkbookRows,
} from '../lib/sales-report-parser.js';
```

If duplicate `@scm/db` imports conflict, merge the imported symbols into the existing import from `@scm/db`.

- [ ] **Step 2: Add diagnostics endpoint**

Add before `salesForecastRoutes.get('/sales-forecast-versions'...)`:

```ts
salesForecastRoutes.post('/sales-forecasts/diagnose', requireMenu('data.forecast'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    dailyRows?: Array<Record<string, string>>;
    monthlyWorkbook?: MonthlyWorkbookRows;
    dailyFileName?: string;
    monthlyFileName?: string;
  }>();

  const daily = parseDailySalesRows(body.dailyRows ?? []);
  const monthly = body.monthlyWorkbook
    ? parseMonthlySalesWorkbookRows(body.monthlyWorkbook)
    : { rows: [] };

  const monthlyMonths = monthly.rows.map((row) => row.month).sort();
  const batch = await createForecastSourceBatch({
    dailyFileName: body.dailyFileName,
    monthlyFileName: body.monthlyFileName,
    dailyStartDate: daily.diagnostics.startDate,
    dailyEndDate: daily.diagnostics.endDate,
    monthlyStartMonth: monthlyMonths[0],
    monthlyEndMonth: monthlyMonths[monthlyMonths.length - 1],
    skuCount: daily.diagnostics.skuCount,
    rowCount: daily.diagnostics.rowCount,
    createdBy: user.id,
  });

  const factors = computeSeasonalityFactors(monthly.rows);
  await upsertSeasonalityFactors(batch.id, factors);

  return c.json({
    batch,
    daily: daily.diagnostics,
    monthly: {
      rowCount: monthly.rows.length,
      factorCount: factors.length,
      startMonth: monthlyMonths[0] ?? null,
      endMonth: monthlyMonths[monthlyMonths.length - 1] ?? null,
    },
  });
});
```

- [ ] **Step 3: Add generation endpoint**

Add after diagnostics endpoint:

```ts
salesForecastRoutes.post('/sales-forecasts/generate-baseline', requireMenu('data.forecast'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    station?: string;
    platform?: string;
    versionName?: string;
    monthCount?: number;
  }>();

  const result = await generateBaselineForecastVersion({
    station: body.station || 'US',
    platform: body.platform || 'ALL',
    versionName: body.versionName,
    monthCount: body.monthCount ?? 12,
  });

  await writeAuditLog(c, {
    action: 'sales_forecast.generate_baseline',
    resourceType: 'sales_forecast_version',
    resourceId: result.version.id,
    detail: { forecastRows: result.forecastRows, reviewRows: result.reviewRows },
    user,
  });

  return c.json(result);
});
```

- [ ] **Step 4: Add review list/update endpoints**

Add:

```ts
salesForecastRoutes.get('/sales-forecasts/review-items', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.query('versionId')?.trim();
  const status = c.req.query('status')?.trim() as 'pending' | 'reviewed' | 'ignored' | undefined;
  const severity = c.req.query('severity')?.trim() as 'critical' | 'warning' | 'info' | undefined;

  const conditions = [];
  if (versionId) conditions.push(eq(salesForecastReviewItems.versionId, versionId));
  if (status) conditions.push(eq(salesForecastReviewItems.status, status));
  if (severity) conditions.push(eq(salesForecastReviewItems.severity, severity));

  const base = db
    .select({
      id: salesForecastReviewItems.id,
      versionId: salesForecastReviewItems.versionId,
      skuId: salesForecastReviewItems.skuId,
      skuCode: skus.code,
      station: salesForecastReviewItems.station,
      platform: salesForecastReviewItems.platform,
      issueType: salesForecastReviewItems.issueType,
      severity: salesForecastReviewItems.severity,
      message: salesForecastReviewItems.message,
      suggestedDailyAvg: salesForecastReviewItems.suggestedDailyAvg,
      reviewedDailyAvg: salesForecastReviewItems.reviewedDailyAvg,
      status: salesForecastReviewItems.status,
      createdAt: salesForecastReviewItems.createdAt,
    })
    .from(salesForecastReviewItems)
    .innerJoin(skus, eq(skus.id, salesForecastReviewItems.skuId))
    .$dynamic();

  const rows = conditions.length ? await base.where(and(...conditions)) : await base.limit(200);
  return c.json({
    items: rows.map((row) => ({
      ...row,
      suggestedDailyAvg: row.suggestedDailyAvg != null ? Number(row.suggestedDailyAvg) : null,
      reviewedDailyAvg: row.reviewedDailyAvg != null ? Number(row.reviewedDailyAvg) : null,
    })),
    count: rows.length,
  });
});

salesForecastRoutes.patch('/sales-forecasts/review-items/:id', requireMenu('data.forecast'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    status?: 'pending' | 'reviewed' | 'ignored';
    reviewedDailyAvg?: number;
  }>();

  const [row] = await db
    .update(salesForecastReviewItems)
    .set({
      status: body.status ?? 'reviewed',
      reviewedDailyAvg:
        body.reviewedDailyAvg != null ? String(body.reviewedDailyAvg) : undefined,
      reviewerId: user.id,
      reviewedAt: new Date(),
    })
    .where(eq(salesForecastReviewItems.id, c.req.param('id')))
    .returning();

  if (!row) return c.json({ message: 'Review item not found' }, 404);
  return c.json(row);
});
```

- [ ] **Step 5: Add trend endpoint**

Add:

```ts
salesForecastRoutes.get('/sales-forecasts/trends', requireMenu('data.forecast'), async (c) => {
  const dimensionType = c.req.query('dimensionType') as 'category' | 'project_group' | undefined;
  const rows = await db
    .select()
    .from(salesForecastSeasonality)
    .where(dimensionType ? eq(salesForecastSeasonality.dimensionType, dimensionType) : undefined)
    .limit(500);

  return c.json({
    items: rows.map((row) => ({
      ...row,
      seasonalityFactor: Number(row.seasonalityFactor),
      trendFactor: row.trendFactor != null ? Number(row.trendFactor) : null,
    })),
    count: rows.length,
  });
});
```

- [ ] **Step 6: Add API client methods**

Add types and methods near existing sales forecast methods in `apps/web/src/lib/api.ts`:

```ts
export type ForecastReviewItem = {
  id: string;
  versionId: string;
  skuId: string;
  skuCode: string;
  station: string;
  platform: string;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestedDailyAvg: number | null;
  reviewedDailyAvg: number | null;
  status: 'pending' | 'reviewed' | 'ignored';
  createdAt: string;
};
```

Inside `api`:

```ts
  diagnoseSalesForecastSource: (body: {
    dailyRows?: Array<Record<string, string>>;
    monthlyWorkbook?: Record<string, unknown[][]>;
    dailyFileName?: string;
    monthlyFileName?: string;
  }) =>
    request<{
      batch: { id: string; batchNo: string; status: string };
      daily: {
        rowCount: number;
        expandedRowCount: number;
        skuCount: number;
        startDate?: string;
        endDate?: string;
        stationCounts: Record<string, number>;
        platformCounts: Record<string, number>;
        errors: string[];
      };
      monthly: {
        rowCount: number;
        factorCount: number;
        startMonth: string | null;
        endMonth: string | null;
      };
    }>('/api/sales-forecasts/diagnose', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  generateSalesForecastBaseline: (body: {
    station?: string;
    platform?: string;
    versionName?: string;
    monthCount?: number;
  }) =>
    request<{
      version: { id: string; versionNo: string; versionName: string; status: string };
      forecastRows: number;
      reviewRows: number;
    }>('/api/sales-forecasts/generate-baseline', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastReviewItems: (params?: {
    versionId?: string;
    status?: 'pending' | 'reviewed' | 'ignored';
    severity?: 'critical' | 'warning' | 'info';
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.status) qs.set('status', params.status);
    if (params?.severity) qs.set('severity', params.severity);
    const query = qs.toString();
    return request<{ items: ForecastReviewItem[]; count: number }>(
      `/api/sales-forecasts/review-items${query ? `?${query}` : ''}`,
    );
  },
  updateSalesForecastReviewItem: (
    id: string,
    body: { status?: 'pending' | 'reviewed' | 'ignored'; reviewedDailyAvg?: number },
  ) =>
    request<ForecastReviewItem>(`/api/sales-forecasts/review-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getSalesForecastTrends: (dimensionType?: 'category' | 'project_group') => {
    const qs = dimensionType ? `?dimensionType=${dimensionType}` : '';
    return request<{
      items: Array<{
        id: string;
        dimensionType: 'category' | 'project_group';
        dimensionValue: string;
        month: number;
        seasonalityFactor: number;
        trendFactor: number | null;
      }>;
      count: number;
    }>(`/api/sales-forecasts/trends${qs}`);
  },
```

- [ ] **Step 7: Build**

Run:

```bash
cd apps/web
pnpm build
```

Expected: PASS, or actionable TypeScript errors in modified files only.

---

## Task 6: Forecast Workbench UI

**Files:**
- Modify: `apps/web/src/pages/SalesForecastPage.tsx`

- [ ] **Step 1: Expand tab union**

Change:

```ts
type Tab = 'forecasts' | 'versions' | 'accuracy';
```

to:

```ts
type Tab = 'diagnostics' | 'generate' | 'review' | 'forecasts' | 'versions' | 'accuracy' | 'trends';
```

Change initial tab:

```ts
const [tab, setTab] = useState<Tab>('diagnostics');
```

- [ ] **Step 2: Add state and queries**

Add near existing state:

```ts
const [diagnosticsJson, setDiagnosticsJson] = useState('');
const [generateStation, setGenerateStation] = useState('US');
const [generatePlatform, setGeneratePlatform] = useState('ALL');
const [reviewStatus, setReviewStatus] = useState<'pending' | 'reviewed' | 'ignored'>('pending');
const [trendType, setTrendType] = useState<'category' | 'project_group'>('category');
```

Add mutations/queries:

```ts
const diagnoseMutation = useMutation({
  mutationFn: () => {
    const parsed = JSON.parse(diagnosticsJson || '{}') as {
      dailyRows?: Array<Record<string, string>>;
      monthlyWorkbook?: Record<string, unknown[][]>;
    };
    return api.diagnoseSalesForecastSource(parsed);
  },
});

const generateBaselineMutation = useMutation({
  mutationFn: () =>
    api.generateSalesForecastBaseline({
      station: generateStation,
      platform: generatePlatform,
      monthCount: 12,
    }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] });
    qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
  },
});

const { data: reviewItems } = useQuery({
  queryKey: ['sales-forecast-review-items', versionId, reviewStatus],
  queryFn: () =>
    api.getSalesForecastReviewItems({
      versionId: versionId || undefined,
      status: reviewStatus,
    }),
  enabled: tab === 'review',
});

const reviewItemMutation = useMutation({
  mutationFn: (id: string) => api.updateSalesForecastReviewItem(id, { status: 'reviewed' }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] }),
});

const { data: trends } = useQuery({
  queryKey: ['sales-forecast-trends', trendType],
  queryFn: () => api.getSalesForecastTrends(trendType),
  enabled: tab === 'trends',
});
```

- [ ] **Step 3: Update tab buttons**

Replace the existing tab array with:

```tsx
{([
  ['diagnostics', '数据诊断'],
  ['generate', '生成预测'],
  ['review', '复核清单'],
  ['forecasts', '预测明细'],
  ['versions', '版本与校验'],
  ['accuracy', '准确率复盘'],
  ['trends', '趋势看板'],
] as Array<[Tab, string]>).map(([t, label]) => (
  <Button key={t} variant={tab === t ? 'default' : 'outline'} size="sm" onClick={() => setTab(t)}>
    {label}
  </Button>
))}
```

- [ ] **Step 4: Add diagnostics panel**

Add before the existing `forecasts` panel:

```tsx
{tab === 'diagnostics' && (
  <Card>
    <CardHeader>
      <CardTitle>数据诊断</CardTitle>
      <p className="text-sm text-text-sub">
        MVP 先接收解析后的 JSON，用于验证后端诊断链路；后续再接入文件上传和 XLSX 解析。
      </p>
    </CardHeader>
    <CardContent className="space-y-3">
      <textarea
        className="min-h-48 w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
        value={diagnosticsJson}
        onChange={(e) => setDiagnosticsJson(e.target.value)}
        placeholder='{"dailyRows":[{"SKU":"DJ502952_1","站点":"Amazon美国","平台":"亚马逊","(2026-06-26)":"2"}]}'
      />
      <Button disabled={diagnoseMutation.isPending} onClick={() => diagnoseMutation.mutate()}>
        运行诊断
      </Button>
      {diagnoseMutation.data && (
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
          {JSON.stringify(diagnoseMutation.data, null, 2)}
        </pre>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 5: Add generation panel**

Add:

```tsx
{tab === 'generate' && (
  <Card>
    <CardHeader>
      <CardTitle>生成基线预测</CardTitle>
      <p className="text-sm text-text-sub">
        生成未来 12 个月 SKU+站点+平台预测日均，写入草稿版本并生成复核清单。
      </p>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-24" value={generateStation} onChange={(e) => setGenerateStation(e.target.value.toUpperCase())} />
        <Input className="h-9 w-32" value={generatePlatform} onChange={(e) => setGeneratePlatform(e.target.value)} />
        <Button disabled={generateBaselineMutation.isPending} onClick={() => generateBaselineMutation.mutate()}>
          生成草稿
        </Button>
      </div>
      {generateBaselineMutation.data && (
        <p className="text-sm text-text-sub">
          已生成 {generateBaselineMutation.data.forecastRows} 行预测，
          {generateBaselineMutation.data.reviewRows} 条复核项。
        </p>
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 6: Add review panel**

Add:

```tsx
{tab === 'review' && (
  <Card>
    <CardHeader>
      <CardTitle>复核清单</CardTitle>
      <p className="text-sm text-text-sub">按版本 ID 查看待处理异常 SKU。</p>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-56" placeholder="版本 ID" value={versionId} onChange={(e) => setVersionId(e.target.value)} />
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={reviewStatus}
          onChange={(e) => setReviewStatus(e.target.value as 'pending' | 'reviewed' | 'ignored')}
        >
          <option value="pending">待复核</option>
          <option value="reviewed">已复核</option>
          <option value="ignored">已忽略</option>
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-sub">
            <th className="p-2 font-normal">SKU</th>
            <th className="p-2 font-normal">类型</th>
            <th className="p-2 font-normal">等级</th>
            <th className="p-2 font-normal">说明</th>
            <th className="p-2 font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          {(reviewItems?.items ?? []).map((item) => (
            <tr key={item.id} className="border-b border-border/60">
              <td className="p-2">{item.skuCode}</td>
              <td className="p-2">{item.issueType}</td>
              <td className="p-2">{item.severity}</td>
              <td className="p-2">{item.message}</td>
              <td className="p-2">
                {item.status === 'pending' && (
                  <Button size="sm" variant="outline" onClick={() => reviewItemMutation.mutate(item.id)}>
                    标记已复核
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 7: Add trends panel**

Add:

```tsx
{tab === 'trends' && (
  <Card>
    <CardHeader>
      <CardTitle>趋势看板</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <select
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        value={trendType}
        onChange={(e) => setTrendType(e.target.value as 'category' | 'project_group')}
      >
        <option value="category">品类</option>
        <option value="project_group">项目组</option>
      </select>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-sub">
            <th className="p-2 font-normal">维度</th>
            <th className="p-2 font-normal">月份</th>
            <th className="p-2 font-normal">季节性</th>
            <th className="p-2 font-normal">趋势</th>
          </tr>
        </thead>
        <tbody>
          {(trends?.items ?? []).map((row) => (
            <tr key={row.id} className="border-b border-border/60">
              <td className="p-2">{row.dimensionValue}</td>
              <td className="p-2">{row.month}</td>
              <td className="p-2 font-numeric">{row.seasonalityFactor.toFixed(2)}</td>
              <td className="p-2 font-numeric">{row.trendFactor?.toFixed(2) ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 8: Build**

Run:

```bash
cd apps/web
pnpm build
```

Expected: PASS. Fix TypeScript errors in `SalesForecastPage.tsx` and `api.ts`.

---

## Task 7: Accuracy Feedback Creates Review Items

**Files:**
- Modify: `apps/web/server/lib/forecast-accuracy.ts`
- Test: existing or new focused test `apps/web/server/lib/forecast-accuracy.test.ts`

- [ ] **Step 1: Add low-accuracy review item insertion**

In `computeForecastAccuracyForMonth`, after upserting `forecastAccuracyMonthly`, insert a review item when `mape > 0.3`:

```ts
if (mape != null && mape > 0.3 && versionId) {
  const [existingReview] = await db
    .select({ id: salesForecastReviewItems.id })
    .from(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, versionId),
        eq(salesForecastReviewItems.skuId, row.skuId),
        eq(salesForecastReviewItems.station, row.station),
        eq(salesForecastReviewItems.platform, row.platform),
        eq(salesForecastReviewItems.issueType, 'low_accuracy'),
      ),
    )
    .limit(1);

  if (!existingReview) {
    await db.insert(salesForecastReviewItems).values({
      versionId,
      skuId: row.skuId,
      station: row.station,
      platform: row.platform,
      issueType: 'low_accuracy',
      severity: 'warning',
      message: `${row.skuCode} ${formatForecastMonth(targetYear, targetMonth)} MAPE ${Math.round(mape * 100)}%，需复核下一轮预测`,
      suggestedDailyAvg: String(actualDaily),
    });
  }
}
```

Also add `salesForecastReviewItems` to the existing import from `@scm/db`.

- [ ] **Step 2: Run build**

Run:

```bash
cd apps/web
pnpm build
```

Expected: PASS.

---

## Task 8: Verification And Miaoda Compatibility

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd apps/web
pnpm vitest server/lib/sales-report-parser.test.ts server/lib/forecast-baseline.test.ts server/lib/forecast-collaboration.test.ts --run
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
cd apps/web
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run Miaoda validation**

Run:

```bash
cd apps/web
pnpm validate:miaoda
```

Expected: PASS, with no Hono mounting or CJS transform errors.

- [ ] **Step 4: Check sensitive files are ignored**

Run:

```bash
cd ..
git check-ignore -v "docs/samples/import-fob/产品销售报表-每日6a3e471b146127326e0e06f6.csv" "docs/samples/import-fob/产品销售报表-每月2023.1-2026.5.xlsx"
```

Expected: both files match `.gitignore`.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: source/docs changes only; raw sales report files remain ignored and absent from status.

---

## Self-Review

- Spec coverage: The plan covers data source batches, daily/monthly parsing, diagnostics, baseline forecast generation, lifecycle labels, review items, version publication support, accuracy feedback, trend view, and replenishment reuse through existing published forecast reads.
- Deliberate MVP cut: Direct browser file upload of the two raw reports is deferred; the UI accepts parsed JSON first so backend diagnostics/generation can be verified without committing raw business files. File upload can be added after parser/API behavior is stable.
- Placeholder scan: No red-flag placeholder wording or unspecified edge handling remains in task steps.
- Type consistency: Review item enum values match the PRD and migration. API method names match UI calls. Forecast outputs remain monthly daily averages.
- Git safety: The plan explicitly says not to commit unless requested and keeps raw sales files ignored.
