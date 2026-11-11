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
import { skus } from './inventory';

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
