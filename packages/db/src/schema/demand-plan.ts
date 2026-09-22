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
    startWeek: varchar('start_week', { length: 8 }),
    horizonWeeks: integer('horizon_weeks'),
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

export const demandPlanWeekly = pgTable(
  'demand_plan_weekly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => demandPlanVersions.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
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
      table.versionId,
      table.skuId,
      table.warehouseCode,
      table.period,
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
      table.projectGroup,
      table.warehouseCode,
    ),
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
  weeks: many(demandPlanWeekly),
}));

export const demandPlanMonthlyRelations = relations(demandPlanMonthly, ({ one }) => ({
  version: one(demandPlanVersions, {
    fields: [demandPlanMonthly.versionId],
    references: [demandPlanVersions.id],
  }),
  sku: one(skus, { fields: [demandPlanMonthly.skuId], references: [skus.id] }),
}));

export const demandPlanWeeklyRelations = relations(demandPlanWeekly, ({ one }) => ({
  version: one(demandPlanVersions, {
    fields: [demandPlanWeekly.versionId],
    references: [demandPlanVersions.id],
  }),
  sku: one(skus, { fields: [demandPlanWeekly.skuId], references: [skus.id] }),
}));

export const planningDemandAdoptionsRelations = relations(planningDemandAdoptions, ({ one }) => ({
  version: one(demandPlanVersions, {
    fields: [planningDemandAdoptions.demandPlanVersionId],
    references: [demandPlanVersions.id],
  }),
  adoptedByUser: one(users, {
    fields: [planningDemandAdoptions.adoptedBy],
    references: [users.id],
  }),
}));
