import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** 销量原文站点 → 销售区域。权威映射，不从国名推断。 */
export const stationSalesRegionMaps = pgTable(
  'station_sales_region_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    station: varchar('station', { length: 100 }).notNull(),
    salesRegion: varchar('sales_region', { length: 20 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stationUq: uniqueIndex('station_sales_region_maps_station_uidx').on(t.station),
  }),
);

/** 仓库编码 → 履约区域。权威映射，不从仓名推断。 */
export const warehouseFulfillmentRegionMaps = pgTable(
  'warehouse_fulfillment_region_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    fulfillmentRegion: varchar('fulfillment_region', { length: 20 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    whUq: uniqueIndex('warehouse_fulfillment_region_maps_wh_uidx').on(t.warehouseCode),
  }),
);
