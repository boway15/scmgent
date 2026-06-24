import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';
import { inventoryHealthEnum } from './reorder';

export const inventoryExceptionTypeEnum = pgEnum('inventory_exception_type', [
  'stockout',
  'overstock',
  'slow_moving',
  'lifecycle_eol',
]);

export const inventoryExceptionStatusEnum = pgEnum('inventory_exception_status', [
  'open',
  'in_progress',
  'resolved',
  'dismissed',
]);

export const inventoryHealthSnapshots = pgTable(
  'inventory_health_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    healthStatus: inventoryHealthEnum('health_status').notNull(),
    coverageDays: numeric('coverage_days', { precision: 10, scale: 2 }),
    effectiveQty: integer('effective_qty').notNull().default(0),
    avgDaily: numeric('avg_daily', { precision: 12, scale: 4 }).notNull().default('0'),
    demandSource: varchar('demand_source', { length: 20 }).notNull().default('historical'),
    totalLeadDays: integer('total_lead_days'),
    latestOrderDays: numeric('latest_order_days', { precision: 10, scale: 2 }),
    metrics: jsonb('metrics'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    runId: uuid('run_id'),
  },
  (table) => ({
    skuWhIdx: index('inventory_health_snapshots_sku_wh_idx').on(
      table.skuId,
      table.warehouseCode,
      table.computedAt,
    ),
    healthIdx: index('inventory_health_snapshots_health_idx').on(
      table.healthStatus,
      table.computedAt,
    ),
  }),
);

export const inventoryExceptions = pgTable(
  'inventory_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    exceptionType: inventoryExceptionTypeEnum('exception_type').notNull(),
    healthStatus: inventoryHealthEnum('health_status').notNull(),
    recommendedAction: text('recommended_action'),
    status: inventoryExceptionStatusEnum('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => users.id),
    dueDate: date('due_date'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('inventory_exceptions_status_idx').on(table.status, table.dueDate),
    skuWhTypeIdx: index('inventory_exceptions_sku_wh_type_idx').on(
      table.skuId,
      table.warehouseCode,
      table.exceptionType,
      table.status,
    ),
  }),
);

export const inventoryHealthSnapshotsRelations = relations(inventoryHealthSnapshots, ({ one }) => ({
  sku: one(skus, { fields: [inventoryHealthSnapshots.skuId], references: [skus.id] }),
}));

export const inventoryExceptionsRelations = relations(inventoryExceptions, ({ one }) => ({
  sku: one(skus, { fields: [inventoryExceptions.skuId], references: [skus.id] }),
  owner: one(users, { fields: [inventoryExceptions.ownerId], references: [users.id] }),
  resolver: one(users, { fields: [inventoryExceptions.resolvedBy], references: [users.id] }),
}));
