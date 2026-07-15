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
import { skus } from './inventory';
import { pmcPlanItems } from './pmc';

export const purchaseDraftStatusEnum = pgEnum('purchase_draft_status', [
  'draft',
  'submitted', // legacy, migrated to confirmed
  'confirmed',
  'in_production',
  'ready_to_ship',
  'in_transit',
  'partial_received',
  'received',
  'exception',
  'cancelled',
]);

export const purchaseDraftSourceEnum = pgEnum('purchase_draft_source', [
  'reorder',
  'pmc',
  'manual',
]);

export const purchaseDrafts = pgTable(
  'purchase_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftNo: varchar('draft_no', { length: 100 }).notNull().unique(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    qty: integer('qty').notNull(),
    expectedDate: date('expected_date'),
    source: purchaseDraftSourceEnum('source').notNull().default('manual'),
    sourceRefId: uuid('source_ref_id'),
    planItemId: uuid('plan_item_id').references(() => pmcPlanItems.id),
    status: purchaseDraftStatusEnum('status').notNull().default('draft'),
    supplierConfirmedAt: timestamp('supplier_confirmed_at', { withTimezone: true }),
    confirmedDeliveryDate: date('confirmed_delivery_date'),
    actualShipDate: date('actual_ship_date'),
    actualReceivedDate: date('actual_received_date'),
    receivedQty: integer('received_qty').notNull().default(0),
    exceptionReason: text('exception_reason'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    remark: text('remark'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('purchase_drafts_status_idx').on(table.status),
    skuIdx: index('purchase_drafts_sku_id_idx').on(table.skuId),
    planItemIdx: index('purchase_drafts_plan_item_id_idx').on(table.planItemId),
  }),
);

export const purchaseDraftsRelations = relations(purchaseDrafts, ({ one, many }) => ({
  sku: one(skus, { fields: [purchaseDrafts.skuId], references: [skus.id] }),
  creator: one(users, { fields: [purchaseDrafts.createdBy], references: [users.id] }),
  owner: one(users, { fields: [purchaseDrafts.ownerUserId], references: [users.id] }),
  planItem: one(pmcPlanItems, {
    fields: [purchaseDrafts.planItemId],
    references: [pmcPlanItems.id],
  }),
  followUpReminders: many(purchaseFollowUpReminders),
}));

export const purchaseFollowUpReminders = pgTable(
  'purchase_follow_up_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => purchaseDrafts.id, { onDelete: 'cascade' }),
    milestone: varchar('milestone', { length: 10 }).notNull(),
    dueDate: date('due_date').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    draftMilestoneUnique: uniqueIndex('purchase_follow_up_reminders_draft_milestone_idx').on(
      table.draftId,
      table.milestone,
    ),
    dueDateIdx: index('purchase_follow_up_reminders_due_date_idx').on(table.dueDate),
  }),
);

export const purchaseFollowUpRemindersRelations = relations(
  purchaseFollowUpReminders,
  ({ one }) => ({
    draft: one(purchaseDrafts, {
      fields: [purchaseFollowUpReminders.draftId],
      references: [purchaseDrafts.id],
    }),
  }),
);
