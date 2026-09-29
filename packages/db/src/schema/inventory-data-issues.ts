import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const inventoryDataIssueTypeEnum = pgEnum('inventory_data_issue_type', [
  'missing_available_at',
  'unallocated_warehouse',
  'share_sum_mismatch',
  'unmapped_warehouse',
  'position_source_mismatch',
  'position_share_gap',
]);

export const inventoryDataIssueStatusEnum = pgEnum('inventory_data_issue_status', [
  'open',
  'in_progress',
  'resolved',
  'dismissed',
]);

export const inventoryDataIssues = pgTable(
  'inventory_data_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fingerprint: varchar('fingerprint', { length: 320 }).notNull(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    issueType: inventoryDataIssueTypeEnum('issue_type').notNull(),
    impactModule: varchar('impact_module', { length: 40 }).notNull(),
    example: text('example').notNull(),
    qty: integer('qty').notNull().default(0),
    details: jsonb('details'),
    status: inventoryDataIssueStatusEnum('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => users.id),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('inventory_data_issues_status_idx').on(table.status, table.issueType),
    skuTypeIdx: index('inventory_data_issues_sku_type_idx').on(
      table.skuId,
      table.issueType,
      table.status,
    ),
    fpIdx: index('inventory_data_issues_fp_idx').on(table.fingerprint),
  }),
);

export const inventoryDataIssuesRelations = relations(inventoryDataIssues, ({ one }) => ({
  sku: one(skus, { fields: [inventoryDataIssues.skuId], references: [skus.id] }),
  owner: one(users, { fields: [inventoryDataIssues.ownerId], references: [users.id] }),
  resolver: one(users, { fields: [inventoryDataIssues.resolvedBy], references: [users.id] }),
}));
