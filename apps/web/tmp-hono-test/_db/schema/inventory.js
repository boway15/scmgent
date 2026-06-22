import { pgTable, pgEnum, uuid, varchar, boolean, integer, numeric, date, timestamp, jsonb, index, uniqueIndex, } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';
import { spus } from './products.js';
export const calcMethodEnum = pgEnum('calc_method', ['manual', 'eoq', 'dify_ai']);
export const dataSourceEnum = pgEnum('data_source', ['manual', 'import', 'pmc_receipt']);
/** 补货亮灯：red=必补，yellow=同 SPU 有红灯 SKU 需补时才补，green=不补 */
export const replenishLightEnum = pgEnum('replenish_light', ['red', 'yellow', 'green']);
export const skus = pgTable('skus', {
    id: uuid('id').primaryKey().defaultRandom(),
    spuId: uuid('spu_id').references(() => spus.id),
    code: varchar('code', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull(),
    category: varchar('category', { length: 100 }),
    /** 规格属性，如 { color: "红", size: "L" } */
    specAttrs: jsonb('spec_attrs'),
    barcode: varchar('barcode', { length: 100 }),
    leadTimeDays: integer('lead_time_days'),
    moq: integer('moq'),
    unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
    /** 默认供货商家冗余字段，由 sku_suppliers.is_default 同步 */
    merchantCode: varchar('merchant_code', { length: 100 }),
    merchantName: varchar('merchant_name', { length: 200 }),
    replenishLight: replenishLightEnum('replenish_light').notNull().default('red'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    spuIdx: index('skus_spu_id_idx').on(table.spuId),
}));
export const bom = pgTable('bom', {
    id: uuid('id').primaryKey().defaultRandom(),
    finishedSkuId: uuid('finished_sku_id')
        .notNull()
        .references(() => skus.id),
    materialSkuId: uuid('material_sku_id')
        .notNull()
        .references(() => skus.id),
    qtyPerUnit: numeric('qty_per_unit', { precision: 12, scale: 4 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull(),
    version: varchar('version', { length: 20 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    finishedSkuIdx: index('bom_finished_sku_id_idx').on(table.finishedSkuId, table.isActive),
}));
export const inventoryRecords = pgTable('inventory_records', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .notNull()
        .references(() => skus.id),
    warehouse: varchar('warehouse', { length: 100 }).notNull(),
    qtyAvailable: integer('qty_available').notNull(),
    qtyInTransit: integer('qty_in_transit').default(0),
    qtyInProduction: integer('qty_in_production').default(0),
    qtyReserved: integer('qty_reserved').default(0),
    recordedDate: date('recorded_date').notNull(),
    source: dataSourceEnum('source').notNull().default('manual'),
    importBatchId: uuid('import_batch_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const salesHistory = pgTable('sales_history', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .notNull()
        .references(() => skus.id),
    saleDate: date('sale_date').notNull(),
    qtySold: integer('qty_sold').notNull(),
    channel: varchar('channel', { length: 100 }),
    /** 实际发货仓 code，如 US-WEST */
    warehouseCode: varchar('warehouse_code', { length: 100 }),
    source: dataSourceEnum('source').notNull().default('manual'),
    importBatchId: uuid('import_batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    skuDateIdx: index('sales_history_sku_id_sale_date_idx').on(table.skuId, table.saleDate),
    skuWarehouseIdx: index('sales_history_sku_warehouse_idx').on(table.skuId, table.warehouseCode),
}));
export const safetyStockConfig = pgTable('safety_stock_config', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .notNull()
        .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull().default('ALL'),
    safetyStockQty: integer('safety_stock_qty').notNull(),
    reorderPoint: integer('reorder_point').notNull(),
    reorderQty: integer('reorder_qty').notNull(),
    reviewCycleDays: integer('review_cycle_days'),
    serviceLevel: numeric('service_level', { precision: 4, scale: 2 }),
    calcMethod: calcMethodEnum('calc_method').notNull().default('manual'),
    lastCalcAt: timestamp('last_calc_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    skuWarehouseUnique: uniqueIndex('safety_stock_config_sku_warehouse_idx').on(table.skuId, table.warehouseCode),
}));
export const skusRelations = relations(skus, ({ many, one }) => ({
    spu: one(spus, { fields: [skus.spuId], references: [spus.id] }),
    bomAsFinished: many(bom, { relationName: 'finishedSku' }),
    bomAsMaterial: many(bom, { relationName: 'materialSku' }),
    inventoryRecords: many(inventoryRecords),
    salesHistory: many(salesHistory),
    safetyStockConfig: one(safetyStockConfig),
}));
export const bomRelations = relations(bom, ({ one }) => ({
    finishedSku: one(skus, {
        fields: [bom.finishedSkuId],
        references: [skus.id],
        relationName: 'finishedSku',
    }),
    materialSku: one(skus, {
        fields: [bom.materialSkuId],
        references: [skus.id],
        relationName: 'materialSku',
    }),
}));
export const inventoryRecordsRelations = relations(inventoryRecords, ({ one }) => ({
    sku: one(skus, { fields: [inventoryRecords.skuId], references: [skus.id] }),
    creator: one(users, { fields: [inventoryRecords.createdBy], references: [users.id] }),
}));
export const salesHistoryRelations = relations(salesHistory, ({ one }) => ({
    sku: one(skus, { fields: [salesHistory.skuId], references: [skus.id] }),
}));
export const safetyStockConfigRelations = relations(safetyStockConfig, ({ one }) => ({
    sku: one(skus, { fields: [safetyStockConfig.skuId], references: [skus.id] }),
}));
