import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  date,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { skus } from './inventory';

export const supplyLotPoolEnum = pgEnum('supply_lot_pool', [
  'overseas',
  'in_transit',
  'local',
]);

export const supplyLotProductionStatusEnum = pgEnum('supply_lot_production_status', [
  'in_production',
  'qc_pending',
  'completed',
]);

export const supplyLotSourceEnum = pgEnum('supply_lot_source', [
  'snapshot',
  'purchase_draft',
  'shipment',
  'manual',
]);

export const supplyLotStatusEnum = pgEnum('supply_lot_status', [
  'open',
  'consumed',
  'cancelled',
]);

/** 三池供给批次：时间轴以 available_at 为准，未知日期不进供给 */
export const inventorySupplyLots = pgTable(
  'inventory_supply_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull(),
    pool: supplyLotPoolEnum('pool').notNull(),
    qty: integer('qty').notNull(),
    factoryCode: varchar('factory_code', { length: 100 }),
    productionStatus: supplyLotProductionStatusEnum('production_status'),
    shipReadyAt: date('ship_ready_at'),
    latestShipDate: date('latest_ship_date'),
    availableAt: date('available_at'),
    source: supplyLotSourceEnum('source').notNull(),
    sourceId: varchar('source_id', { length: 100 }),
    status: supplyLotStatusEnum('status').notNull().default('open'),
    etaEstimated: boolean('eta_estimated').notNull().default(false),
    dateUnknown: boolean('date_unknown').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuWhPoolIdx: index('inventory_supply_lots_sku_wh_pool_idx').on(
      table.skuId,
      table.warehouseCode,
      table.pool,
      table.status,
    ),
    availableAtIdx: index('inventory_supply_lots_available_at_idx').on(table.availableAt),
    sourceUnique: uniqueIndex('inventory_supply_lots_source_unique_idx').on(
      table.source,
      table.sourceId,
      table.pool,
      table.warehouseCode,
    ),
  }),
);

export const inventorySupplyLotsRelations = relations(inventorySupplyLots, ({ one }) => ({
  sku: one(skus, {
    fields: [inventorySupplyLots.skuId],
    references: [skus.id],
  }),
}));
