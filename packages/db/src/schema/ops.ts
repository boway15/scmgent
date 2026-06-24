import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus, inventoryRecords } from './inventory';
import { pmcPlans, pmcPlanItems } from './pmc';

export const importBatchStatusEnum = pgEnum('import_batch_status', [
  'pending',
  'success',
  'partial',
  'failed',
]);

export const taskRunStatusEnum = pgEnum('task_run_status', ['running', 'success', 'failed']);

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 50 }).notNull(),
    fileName: varchar('file_name', { length: 255 }),
    rowCount: integer('row_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    status: importBatchStatusEnum('status').notNull().default('pending'),
    errorSummary: text('error_summary'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeCreatedIdx: index('import_batches_type_created_idx').on(table.type, table.createdAt),
  }),
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    userName: varchar('user_name', { length: 100 }),
    userEmail: varchar('user_email', { length: 200 }),
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }),
    resourceId: varchar('resource_id', { length: 100 }),
    detail: text('detail'),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
    userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
  }),
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const taskRuns = pgTable(
  'task_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskName: varchar('task_name', { length: 100 }).notNull(),
    status: taskRunStatusEnum('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    resultSummary: text('result_summary'),
    errorMessage: text('error_message'),
    triggeredBy: varchar('triggered_by', { length: 200 }),
  },
  (table) => ({
    taskStartedIdx: index('task_runs_task_started_idx').on(table.taskName, table.startedAt),
  }),
);

export const pmcReceipts = pgTable(
  'pmc_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => pmcPlans.id, { onDelete: 'cascade' }),
    planItemId: uuid('plan_item_id')
      .notNull()
      .references(() => pmcPlanItems.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    qtyReceived: integer('qty_received').notNull(),
    receivedDate: date('received_date').notNull(),
    inventoryRecordId: uuid('inventory_record_id').references(() => inventoryRecords.id),
    idempotencyKey: varchar('idempotency_key', { length: 100 }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planItemIdx: index('pmc_receipts_plan_item_idx').on(table.planItemId),
    idempotencyUnique: uniqueIndex('pmc_receipts_idempotency_key_idx').on(table.idempotencyKey),
  }),
);

export const importBatchesRelations = relations(importBatches, ({ one }) => ({
  creator: one(users, { fields: [importBatches.createdBy], references: [users.id] }),
}));

export const pmcReceiptsRelations = relations(pmcReceipts, ({ one }) => ({
  plan: one(pmcPlans, { fields: [pmcReceipts.planId], references: [pmcPlans.id] }),
  planItem: one(pmcPlanItems, { fields: [pmcReceipts.planItemId], references: [pmcPlanItems.id] }),
  sku: one(skus, { fields: [pmcReceipts.skuId], references: [skus.id] }),
  inventoryRecord: one(inventoryRecords, {
    fields: [pmcReceipts.inventoryRecordId],
    references: [inventoryRecords.id],
  }),
}));
