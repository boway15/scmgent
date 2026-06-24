import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  jsonb,
  date,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';
import { pmcPlans } from './pmc';

export const reorderStatusEnum = pgEnum('reorder_status', ['pending', 'accepted', 'ignored']);
export const alertTypeEnum = pgEnum('alert_type', ['below_safety', 'below_rop', 'stockout']);
/** 库存健康灯：红=必须补货，黄=有风险，绿=健康，蓝=超多，灰=滞销/停售 */
export const inventoryHealthEnum = pgEnum('inventory_health', [
  'red',
  'yellow',
  'green',
  'blue',
  'gray',
]);

export const reorderSuggestions = pgTable('reorder_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id')
    .notNull()
    .references(() => skus.id),
  suggestedQty: integer('suggested_qty').notNull(),
  warehouseCode: varchar('warehouse_code', { length: 100 }),
  suggestedDate: date('suggested_date').notNull(),
  reason: text('reason'),
  healthStatus: inventoryHealthEnum('health_status'),
  coverageDays: numeric('coverage_days', { precision: 10, scale: 2 }),
  totalLeadDays: integer('total_lead_days'),
  latestOrderDays: numeric('latest_order_days', { precision: 10, scale: 2 }),
  metrics: jsonb('metrics'),
  status: reorderStatusEnum('status').notNull().default('pending'),
  planId: uuid('plan_id').references(() => pmcPlans.id),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
});

export const stockAlerts = pgTable('stock_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id')
    .notNull()
    .references(() => skus.id),
  warehouseCode: varchar('warehouse_code', { length: 100 }),
  alertType: alertTypeEnum('alert_type').notNull(),
  currentQty: integer('current_qty').notNull(),
  safetyQty: integer('safety_qty').notNull(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull().defaultNow(),
  isResolved: boolean('is_resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id),
});

export const reorderSuggestionsRelations = relations(reorderSuggestions, ({ one }) => ({
  sku: one(skus, { fields: [reorderSuggestions.skuId], references: [skus.id] }),
  plan: one(pmcPlans, { fields: [reorderSuggestions.planId], references: [pmcPlans.id] }),
  reviewer: one(users, { fields: [reorderSuggestions.reviewedBy], references: [users.id] }),
}));

export const stockAlertsRelations = relations(stockAlerts, ({ one }) => ({
  sku: one(skus, { fields: [stockAlerts.skuId], references: [skus.id] }),
  resolver: one(users, { fields: [stockAlerts.resolvedBy], references: [users.id] }),
}));
