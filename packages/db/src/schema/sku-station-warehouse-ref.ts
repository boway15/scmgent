import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type SkuWarehouseRefResolution = 'unique' | 'dominant';

/**
 * SKU × 站点 × 渠道 → 仓库参考。
 * resolution=unique：策略 A（组内仅一仓）；dominant：策略 B（多仓取 CSV 频次最高仓）。
 */
export const skuStationWarehouseRefs = pgTable(
  'sku_station_warehouse_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuCode: varchar('sku_code', { length: 100 }).notNull(),
    station: varchar('station', { length: 100 }).notNull(),
    channel: varchar('channel', { length: 100 }).notNull(),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    resolution: varchar('resolution', { length: 20 }).notNull().default('unique'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identityUq: uniqueIndex('sku_station_warehouse_refs_identity_uidx').on(
      t.skuCode,
      t.station,
      t.channel,
      t.resolution,
    ),
  }),
);
