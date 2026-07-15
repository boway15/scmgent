import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const forecastVersionStatusEnum = pgEnum('forecast_version_status', [
  'draft',
  'published',
  'archived',
]);

export const forecastConfidenceLevelEnum = pgEnum('forecast_confidence_level', [
  'high',
  'medium',
  'low',
]);

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
  'forecast_skipped',
  'precision_review',
  'exogenous_shock',
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

export const salesPlatforms = pgTable(
  'sales_platforms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    station: varchar('station', { length: 20 }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stationIdx: index('sales_platforms_station_idx').on(table.station),
  }),
);

export const salesPlatformAliases = pgTable(
  'sales_platform_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alias: varchar('alias', { length: 100 }).notNull().unique(),
    platformCode: varchar('platform_code', { length: 50 })
      .notNull()
      .references(() => salesPlatforms.code),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const salesForecastVersions = pgTable(
  'sales_forecast_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionNo: varchar('version_no', { length: 50 }).notNull().unique(),
    versionName: varchar('version_name', { length: 200 }).notNull(),
    station: varchar('station', { length: 20 }),
    status: forecastVersionStatusEnum('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => users.id),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('sales_forecast_versions_status_idx').on(table.status, table.station),
  }),
);

export const forecastAccuracyMonthly = pgTable(
  'forecast_accuracy_monthly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    station: varchar('station', { length: 20 }).notNull(),
    platform: varchar('platform', { length: 50 }).notNull().default('ALL'),
    forecastYear: integer('forecast_year').notNull(),
    month: integer('month').notNull(),
    forecastDailyAvg: numeric('forecast_daily_avg', { precision: 12, scale: 4 }).notNull(),
    actualDailyAvg: numeric('actual_daily_avg', { precision: 12, scale: 4 }).notNull(),
    biasRate: numeric('bias_rate', { precision: 10, scale: 4 }),
    mape: numeric('mape', { precision: 10, scale: 4 }),
    versionId: uuid('version_id').references(() => salesForecastVersions.id),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('forecast_accuracy_monthly_unique_idx').on(
      table.skuId,
      table.station,
      table.platform,
      table.forecastYear,
      table.month,
      table.versionId,
    ),
  }),
);

export const salesForecastSourceBatches = pgTable('sales_forecast_source_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchNo: varchar('batch_no', { length: 50 }).notNull().unique(),
  dailyFileName: varchar('daily_file_name', { length: 255 }),
  monthlyFileName: varchar('monthly_file_name', { length: 255 }),
  dailyStartDate: date('daily_start_date'),
  dailyEndDate: date('daily_end_date'),
  monthlyStartMonth: varchar('monthly_start_month', { length: 7 }),
  monthlyEndMonth: varchar('monthly_end_month', { length: 7 }),
  skuCount: integer('sku_count').notNull().default(0),
  rowCount: integer('row_count').notNull().default(0),
  status: forecastSourceBatchStatusEnum('status').notNull().default('uploaded'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    identityUniqueIdx: uniqueIndex('sales_forecast_review_items_identity_unique_idx').on(
      table.versionId,
      table.skuId,
      table.station,
      table.platform,
      table.issueType,
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

export const forecastExogenousReasonEnum = pgEnum('forecast_exogenous_reason', [
  'ad',
  'price_change',
  'promo',
  'listing_change',
  'other',
]);

export const forecastPromoCalendar = pgTable(
  'forecast_promo_calendar',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    station: varchar('station', { length: 20 }).notNull(),
    platform: varchar('platform', { length: 50 }).notNull().default('ALL'),
    promoYear: integer('promo_year').notNull(),
    promoMonth: integer('promo_month').notNull(),
    intensity: numeric('intensity', { precision: 6, scale: 4 }).notNull().default('1'),
    label: varchar('label', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('forecast_promo_calendar_unique_idx').on(
      table.station,
      table.platform,
      table.promoYear,
      table.promoMonth,
    ),
  }),
);

export const forecastExogenousFlags = pgTable(
  'forecast_exogenous_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    station: varchar('station', { length: 20 }).notNull().default('US'),
    platform: varchar('platform', { length: 50 }).notNull().default('ALL'),
    /** 为空表示该 SKU 在站点下所有预测月均剔除 */
    flagYear: integer('flag_year'),
    flagMonth: integer('flag_month'),
    reason: forecastExogenousReasonEnum('reason').notNull().default('other'),
    note: text('note'),
    excludeFromKpi: boolean('exclude_from_kpi').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuStationIdx: index('forecast_exogenous_flags_sku_station_idx').on(
      table.skuId,
      table.station,
      table.platform,
    ),
    uniqueIdx: uniqueIndex('forecast_exogenous_flags_unique_idx').on(
      table.skuId,
      table.station,
      table.platform,
      table.flagYear,
      table.flagMonth,
      table.reason,
    ),
  }),
);

export const forecastExogenousFlagsRelations = relations(forecastExogenousFlags, ({ one }) => ({
  sku: one(skus, { fields: [forecastExogenousFlags.skuId], references: [skus.id] }),
  creator: one(users, { fields: [forecastExogenousFlags.createdBy], references: [users.id] }),
}));

export const salesPlatformsRelations = relations(salesPlatforms, ({ many }) => ({
  aliases: many(salesPlatformAliases),
}));

export const salesPlatformAliasesRelations = relations(salesPlatformAliases, ({ one }) => ({
  platform: one(salesPlatforms, {
    fields: [salesPlatformAliases.platformCode],
    references: [salesPlatforms.code],
  }),
}));

export const salesForecastVersionsRelations = relations(salesForecastVersions, ({ one, many }) => ({
  creator: one(users, { fields: [salesForecastVersions.createdBy], references: [users.id] }),
  publisher: one(users, { fields: [salesForecastVersions.publishedBy], references: [users.id] }),
  reviewItems: many(salesForecastReviewItems),
}));

export const forecastAccuracyMonthlyRelations = relations(forecastAccuracyMonthly, ({ one }) => ({
  sku: one(skus, { fields: [forecastAccuracyMonthly.skuId], references: [skus.id] }),
  version: one(salesForecastVersions, {
    fields: [forecastAccuracyMonthly.versionId],
    references: [salesForecastVersions.id],
  }),
}));

export const salesForecastSourceBatchesRelations = relations(
  salesForecastSourceBatches,
  ({ one, many }) => ({
    creator: one(users, { fields: [salesForecastSourceBatches.createdBy], references: [users.id] }),
    seasonalities: many(salesForecastSeasonality),
  }),
);

export const salesForecastReviewItemsRelations = relations(
  salesForecastReviewItems,
  ({ one }) => ({
    version: one(salesForecastVersions, {
      fields: [salesForecastReviewItems.versionId],
      references: [salesForecastVersions.id],
    }),
    sku: one(skus, { fields: [salesForecastReviewItems.skuId], references: [skus.id] }),
    reviewer: one(users, {
      fields: [salesForecastReviewItems.reviewerId],
      references: [users.id],
    }),
  }),
);

export const salesForecastSeasonalityRelations = relations(
  salesForecastSeasonality,
  ({ one }) => ({
    sourceBatch: one(salesForecastSourceBatches, {
      fields: [salesForecastSeasonality.sourceBatchId],
      references: [salesForecastSourceBatches.id],
    }),
  }),
);

/** 历史默认发布版本 ID（迁移种子） */
export const LEGACY_FORECAST_VERSION_ID = '00000000-0000-0000-0000-000000000001';
