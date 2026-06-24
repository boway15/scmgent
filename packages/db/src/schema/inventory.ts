import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { spus } from './products';

export const calcMethodEnum = pgEnum('calc_method', ['manual', 'eoq', 'dify_ai']);
export const dataSourceEnum = pgEnum('data_source', ['manual', 'import', 'pmc_receipt']);
/** 补货亮灯：red=必补，yellow=同 SPU 有红灯 SKU 需补时才补，green=不补 */
export const replenishLightEnum = pgEnum('replenish_light', ['red', 'yellow', 'green']);
/** SKU 编码类型（HJ-IT-STP-2025-001） */
export const skuKindEnum = pgEnum('sku_kind', [
  'standard',
  'accessory',
  'multi_box',
  'return',
  'legacy',
]);

export const skus = pgTable(
  'skus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spuId: uuid('spu_id').references(() => spus.id),
    code: varchar('code', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull(),
    category: varchar('category', { length: 100 }),
    /** 规格属性，如 { color: "红", size: "L" } */
    specAttrs: jsonb('spec_attrs'),
    barcode: varchar('barcode', { length: 100 }),
    externalCode: varchar('external_code', { length: 20 }),
    internalCode: varchar('internal_code', { length: 12 }),
    skuKind: skuKindEnum('sku_kind').notNull().default('legacy'),
    divisionCode: varchar('division_code', { length: 1 }),
    distributionNo: integer('distribution_no'),
    spuNumericCode: varchar('spu_numeric_code', { length: 5 }),
    variantNo: varchar('variant_no', { length: 2 }),
    brandCode: varchar('brand_code', { length: 2 }),
    categoryCode: varchar('category_code', { length: 3 }),
    factorySuffix: varchar('factory_suffix', { length: 1 }),
    accessoryNo: varchar('accessory_no', { length: 3 }),
    boxNo: varchar('box_no', { length: 1 }),
    encodingValid: boolean('encoding_valid').notNull().default(false),
    encodingMeta: jsonb('encoding_meta'),
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
  },
  (table) => ({
    spuIdx: index('skus_spu_id_idx').on(table.spuId),
    internalCodeIdx: index('skus_internal_code_idx').on(table.internalCode),
    externalCodeIdx: index('skus_external_code_idx').on(table.externalCode),
  }),
);

export const bom = pgTable(
  'bom',
  {
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
  },
  (table) => ({
    finishedSkuIdx: index('bom_finished_sku_id_idx').on(table.finishedSkuId, table.isActive),
  }),
);

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

export const salesHistory = pgTable(
  'sales_history',
  {
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
  },
  (table) => ({
    skuDateIdx: index('sales_history_sku_id_sale_date_idx').on(table.skuId, table.saleDate),
    skuWarehouseIdx: index('sales_history_sku_warehouse_idx').on(table.skuId, table.warehouseCode),
  }),
);

export const safetyStockConfig = pgTable(
  'safety_stock_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    warehouseCode: varchar('warehouse_code', { length: 100 }).notNull().default('ALL'),
    safetyStockQty: integer('safety_stock_qty').notNull(),
    reorderPoint: integer('reorder_point').notNull(),
    reorderQty: integer('reorder_qty').notNull(),
    reviewCycleDays: integer('review_cycle_days'),
    /** 安全库存天数（覆盖天数模型） */
    safetyStockDays: integer('safety_stock_days').default(14),
    /** 目标库存覆盖天数；未设时由总提前期推导 */
    targetCoverageDays: integer('target_coverage_days'),
    /** 超备阈值（覆盖天数） */
    overstockThresholdDays: integer('overstock_threshold_days').default(180),
    serviceLevel: numeric('service_level', { precision: 4, scale: 2 }),
    calcMethod: calcMethodEnum('calc_method').notNull().default('manual'),
    lastCalcAt: timestamp('last_calc_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuWarehouseUnique: uniqueIndex('safety_stock_config_sku_warehouse_idx').on(
      table.skuId,
      table.warehouseCode,
    ),
  }),
);

/** 业务销量预测：按站点+月份维护预测日均（宽表导入后归一化） */
export const salesForecastMonthly = pgTable(
  'sales_forecast_monthly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    /** 站点，如 US / DE */
    station: varchar('station', { length: 20 }).notNull(),
    forecastYear: integer('forecast_year').notNull(),
    month: integer('month').notNull(),
    forecastDailyAvg: numeric('forecast_daily_avg', { precision: 12, scale: 4 }).notNull(),
    lifecycle: varchar('lifecycle', { length: 50 }),
    ownerName: varchar('owner_name', { length: 100 }),
    source: dataSourceEnum('source').notNull().default('import'),
    importBatchId: uuid('import_batch_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuStationMonthUnique: uniqueIndex('sales_forecast_monthly_sku_station_month_idx').on(
      table.skuId,
      table.station,
      table.forecastYear,
      table.month,
    ),
    skuStationIdx: index('sales_forecast_monthly_sku_station_idx').on(table.skuId, table.station),
  }),
);

export const skusRelations = relations(skus, ({ many, one }) => ({
  spu: one(spus, { fields: [skus.spuId], references: [spus.id] }),
  bomAsFinished: many(bom, { relationName: 'finishedSku' }),
  bomAsMaterial: many(bom, { relationName: 'materialSku' }),
  inventoryRecords: many(inventoryRecords),
  salesHistory: many(salesHistory),
  salesForecastMonthly: many(salesForecastMonthly),
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

export const salesForecastMonthlyRelations = relations(salesForecastMonthly, ({ one }) => ({
  sku: one(skus, { fields: [salesForecastMonthly.skuId], references: [skus.id] }),
}));

export const safetyStockConfigRelations = relations(safetyStockConfig, ({ one }) => ({
  sku: one(skus, { fields: [safetyStockConfig.skuId], references: [skus.id] }),
}));
