import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/** 物理仓 + 区域仓网（US 四仓可互调履约） */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    regionGroup: varchar('region_group', { length: 50 }).notNull(),
    countryCode: varchar('country_code', { length: 10 }),
    allowCrossFulfill: boolean('allow_cross_fulfill').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    regionIdx: uniqueIndex('warehouses_code_idx').on(table.code),
  }),
);

/** 渠道主仓 + 溢出仓顺序；last_mile_cost_index 越高表示互调尾程越贵 */
export const channelWarehousePrefs = pgTable(
  'channel_warehouse_prefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: varchar('channel', { length: 100 }).notNull().unique(),
    primaryWarehouseCode: varchar('primary_warehouse_code', { length: 100 }).notNull(),
    overflowWarehouseCodes: varchar('overflow_warehouse_codes', { length: 500 }),
    lastMileCostIndex: numeric('last_mile_cost_index', { precision: 6, scale: 2 })
      .notNull()
      .default('1'),
    isActive: boolean('is_active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const channelWarehousePrefsRelations = relations(channelWarehousePrefs, ({ one }) => ({
  primaryWarehouse: one(warehouses, {
    fields: [channelWarehousePrefs.primaryWarehouseCode],
    references: [warehouses.code],
  }),
}));
