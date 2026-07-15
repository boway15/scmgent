import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';

export const procurementListTypeEnum = pgEnum('procurement_list_type', [
  'bulk_stock_request',
  'purchase_follow_up',
]);

export type ProcurementListType = (typeof procurementListTypeEnum.enumValues)[number];

export const procurementListMeta = pgTable('procurement_list_meta', {
  listType: procurementListTypeEnum('list_type').primaryKey(),
  columnOrder: jsonb('column_order').$type<string[]>().notNull().default([]),
  rowCount: integer('row_count').notNull().default(0),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncSource: varchar('last_sync_source', { length: 20 }),
  lastSyncBy: uuid('last_sync_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const procurementListRows = pgTable(
  'procurement_list_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listType: procurementListTypeEnum('list_type').notNull(),
    rowIndex: integer('row_index').notNull(),
    bitableRecordId: varchar('bitable_record_id', { length: 100 }),
    rowData: jsonb('row_data').$type<Record<string, string>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    listTypeIdx: index('procurement_list_rows_list_type_idx').on(table.listType),
    listTypeRowIdx: index('procurement_list_rows_list_type_row_index_idx').on(
      table.listType,
      table.rowIndex,
    ),
  }),
);

export const procurementListMetaRelations = relations(procurementListMeta, ({ one }) => ({
  lastSyncUser: one(users, {
    fields: [procurementListMeta.lastSyncBy],
    references: [users.id],
  }),
}));
