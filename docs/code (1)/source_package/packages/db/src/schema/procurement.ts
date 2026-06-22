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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const purchaseDraftStatusEnum = pgEnum('purchase_draft_status', [
  'draft',
  'submitted',
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
    status: purchaseDraftStatusEnum('status').notNull().default('draft'),
    remark: text('remark'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('purchase_drafts_status_idx').on(table.status),
    skuIdx: index('purchase_drafts_sku_id_idx').on(table.skuId),
  }),
);

export const purchaseDraftsRelations = relations(purchaseDrafts, ({ one }) => ({
  sku: one(skus, { fields: [purchaseDrafts.skuId], references: [skus.id] }),
  creator: one(users, { fields: [purchaseDrafts.createdBy], references: [users.id] }),
}));
