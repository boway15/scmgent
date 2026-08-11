import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, isNull, isNotNull } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const layeredForecastVersionStatusEnum = pgEnum('layered_forecast_version_status', [
  'draft',
  'published',
  'archived',
]);

export const layeredForecastLevelEnum = pgEnum('layered_forecast_level', [
  'project_group',
  'category',
  'platform',
  'sku',
]);

export type LayeredForecastAlgoMeta = {
  categoryRule?: string;
  platforms?: string[];
  zeroDraftRule?: string;
  [key: string]: unknown;
};

export const layeredForecastVersions = pgTable(
  'layered_forecast_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionNo: varchar('version_no', { length: 50 }).notNull().unique(),
    versionName: varchar('version_name', { length: 200 }).notNull(),
    status: layeredForecastVersionStatusEnum('status').notNull().default('draft'),
    /** 预测地平线首月 YYYY-MM */
    startMonth: varchar('start_month', { length: 7 }).notNull(),
    horizonMonths: integer('horizon_months').notNull().default(12),
    station: varchar('station', { length: 20 }).notNull().default('ALL'),
    algoMeta: jsonb('algo_meta').$type<LayeredForecastAlgoMeta>(),
    createdBy: uuid('created_by').references(() => users.id),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('layered_forecast_versions_status_idx').on(table.status, table.station),
  }),
);

export const layeredForecastNodes = pgTable(
  'layered_forecast_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => layeredForecastVersions.id, { onDelete: 'cascade' }),
    level: layeredForecastLevelEnum('level').notNull(),
    projectGroup: varchar('project_group', { length: 200 }).notNull(),
    category: varchar('category', { length: 200 }).notNull(),
    platform: varchar('platform', { length: 50 }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: 7 }).notNull(),
    qty: numeric('qty', { precision: 14, scale: 4 }).notNull(),
    systemQty: numeric('system_qty', { precision: 14, scale: 4 }).notNull(),
    draftQty: numeric('draft_qty', { precision: 14, scale: 4 }),
    locked: boolean('locked').notNull().default(false),
    seasonalityFactor: numeric('seasonality_factor', { precision: 10, scale: 4 }),
    trendFactor: numeric('trend_factor', { precision: 10, scale: 4 }),
    peakMonth: integer('peak_month'),
    manualEdited: boolean('manual_edited').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionIdx: index('layered_forecast_nodes_version_idx').on(table.versionId),
    versionLevelIdx: index('layered_forecast_nodes_version_level_idx').on(
      table.versionId,
      table.level,
      table.projectGroup,
      table.category,
      table.platform,
    ),
    upperUniqueIdx: uniqueIndex('layered_forecast_nodes_upper_unique_idx')
      .on(
        table.versionId,
        table.level,
        table.projectGroup,
        table.category,
        table.platform,
        table.period,
      )
      .where(isNull(table.skuId)),
    skuUniqueIdx: uniqueIndex('layered_forecast_nodes_sku_unique_idx')
      .on(
        table.versionId,
        table.level,
        table.projectGroup,
        table.category,
        table.platform,
        table.skuId,
        table.period,
      )
      .where(isNotNull(table.skuId)),
  }),
);

export const layeredForecastVersionsRelations = relations(
  layeredForecastVersions,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [layeredForecastVersions.createdBy],
      references: [users.id],
    }),
    publisher: one(users, {
      fields: [layeredForecastVersions.publishedBy],
      references: [users.id],
    }),
    nodes: many(layeredForecastNodes),
  }),
);

export const layeredForecastNodesRelations = relations(layeredForecastNodes, ({ one }) => ({
  version: one(layeredForecastVersions, {
    fields: [layeredForecastNodes.versionId],
    references: [layeredForecastVersions.id],
  }),
  sku: one(skus, { fields: [layeredForecastNodes.skuId], references: [skus.id] }),
}));
