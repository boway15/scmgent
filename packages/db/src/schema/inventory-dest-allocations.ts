import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

/** 未定仓批次确认落仓；三池同步后按 source/sourceId/pool 套用 */
export const inventoryDestAllocations = pgTable(
  'inventory_dest_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    source: varchar('source', { length: 40 }).notNull(),
    sourceId: varchar('source_id', { length: 100 }).notNull(),
    pool: varchar('pool', { length: 20 }).notNull(),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    qty: integer('qty').notNull(),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceUnique: uniqueIndex('inventory_dest_allocations_source_wh_idx').on(
      table.source,
      table.sourceId,
      table.pool,
      table.warehouseCode,
    ),
    skuIdx: index('inventory_dest_allocations_sku_idx').on(table.skuId),
  }),
);

export const inventoryDestAllocationsRelations = relations(inventoryDestAllocations, ({ one }) => ({
  sku: one(skus, { fields: [inventoryDestAllocations.skuId], references: [skus.id] }),
  confirmer: one(users, { fields: [inventoryDestAllocations.confirmedBy], references: [users.id] }),
}));
