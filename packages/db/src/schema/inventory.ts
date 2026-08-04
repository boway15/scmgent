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
export const safetyStockMethodEnum = pgEnum('safety_stock_method', [
  'coverage_days',
  'z_demand',
  'z_demand_leadtime',
]);
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
    category: varchar('category', { length: 500 }),
    /** C 生命周期（库存周转表） */
    lifecycle: varchar('lifecycle', { length: 50 }),
    /** E 销售国家（库存周转表） */
    salesCountry: varchar('sales_country', { length: 100 }),
    /** F 产品分类（库存周转表，区别于 A 品类） */
    productCategory: varchar('product_category', { length: 200 }),
    /** H 负责人 */
    ownerName: varchar('owner_name', { length: 100 }),
    /** I 开发人员 */
    developerName: varchar('developer_name', { length: 100 }),
    /** 规格属性，如 { color: "红", size: "L" } */
    specAttrs: jsonb('spec_attrs'),
    barcode: varchar('barcode', { length: 100 }),
    externalCode: varchar('external_code', { length: 20 }),
    internalCode: varchar('internal_code', { length: 12 }),
    skuKind: skuKindEnum('sku_kind').notNull().default('legacy'),
    divisionCode: varchar('division_code', { length: 1 }),
    distributionNo: integer('distribution_no'),
    spuNumericCode: varchar('spu_numeric_code', { length: 10 }),
    variantNo: varchar('variant_no', { length: 10 }),
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
    /** 强制纳入预测生成（无视销量准入） */
    forceForecast: boolean('force_forecast').notNull().default(false),
    /** SAP / 外部系统预留 */
    sourceSystem: varchar('source_system', { length: 50 }),
    externalId: varchar('external_id', { length: 100 }),
    externalVersion: varchar('external_version', { length: 50 }),
    syncStatus: varchar('sync_status', { length: 20 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
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

/** 飞书库存周转整表每日发布批次；同一业务日期仅一个 published 批次生效 */
export const inventorySnapshotRuns = pgTable(
  'inventory_snapshot_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotDate: date('snapshot_date').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    source: varchar('source', { length: 50 }).notNull().default('feishu-bitable'),
    status: varchar('status', { length: 20 }).notNull().default('published'),
    rowCount: integer('row_count').notNull(),
    importBatchId: uuid('import_batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    snapshotDateStatusIdx: index('inventory_snapshot_runs_date_status_idx').on(
      table.snapshotDate,
      table.status,
    ),
  }),
);

/** 完整 SKU 日快照；payload 固化总览当时全部字段，避免与当前主数据拼接污染历史 */
export const inventoryDailySnapshots = pgTable(
  'inventory_daily_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => inventorySnapshotRuns.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    skuCode: varchar('sku_code', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dateSkuUnique: uniqueIndex('inventory_daily_snapshots_date_sku_unique_idx').on(
      table.snapshotDate,
      table.skuId,
    ),
    skuDateIdx: index('inventory_daily_snapshots_sku_date_idx').on(
      table.skuId,
      table.snapshotDate,
    ),
    runIdx: index('inventory_daily_snapshots_run_id_idx').on(table.runId),
  }),
);

/** 库存查询（飞书分仓明细）每日发布批次；与库存总览快照隔离 */
export const inventoryQuerySnapshotRuns = pgTable(
  'inventory_query_snapshot_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotDate: date('snapshot_date').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    source: varchar('source', { length: 50 }).notNull().default('feishu-bitable'),
    status: varchar('status', { length: 20 }).notNull().default('published'),
    rowCount: integer('row_count').notNull(),
    /** 飞书表字段名顺序（与多维表格列完全对齐） */
    columns: jsonb('columns').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    snapshotDateStatusIdx: index('inventory_query_snapshot_runs_date_status_idx').on(
      table.snapshotDate,
      table.status,
    ),
  }),
);

/** 库存查询日快照；payload 为飞书明细列原名；sku_id 可空（未匹配本地主数据仍归档） */
export const inventoryQueryDailySnapshots = pgTable(
  'inventory_query_daily_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => inventoryQuerySnapshotRuns.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'set null' }),
    skuCode: varchar('sku_code', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dateSkuCodeUnique: uniqueIndex('inventory_query_daily_snapshots_date_sku_code_unique_idx').on(
      table.snapshotDate,
      table.skuCode,
    ),
    skuCodeDateIdx: index('inventory_query_daily_snapshots_sku_code_date_idx').on(
      table.skuCode,
      table.snapshotDate,
    ),
    runIdx: index('inventory_query_daily_snapshots_run_id_idx').on(table.runId),
  }),
);

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
    /** 品类快照，导入时从 SKU 主数据写入 */
    category: varchar('category', { length: 200 }),
    source: dataSourceEnum('source').notNull().default('manual'),
    importBatchId: uuid('import_batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuDateIdx: index('sales_history_sku_id_sale_date_idx').on(table.skuId, table.saleDate),
    skuWarehouseIdx: index('sales_history_sku_warehouse_idx').on(table.skuId, table.warehouseCode),
    categoryIdx: index('sales_history_category_idx').on(table.category),
    saleDateIdx: index('sales_history_sale_date_idx').on(table.saleDate),
    importBatchIdx: index('sales_history_import_batch_id_idx').on(table.importBatchId),
    sourceSkuDateIdx: index('sales_history_source_sku_date_idx').on(
      table.source,
      table.skuId,
      table.saleDate,
    ),
    skuDateChannelUnique: uniqueIndex('sales_history_sku_date_channel_unique_idx').on(
      table.skuId,
      table.saleDate,
      table.channel,
    ),
  }),
);

/** SKU 月销量汇总：由日销量聚合或 SKU 月宽表导入，支撑 24～36 月同比与准确率回测 */
export const salesHistoryMonthly = pgTable(
  'sales_history_monthly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 100 }).notNull().default('UNKNOWN'),
    saleYear: integer('sale_year').notNull(),
    month: integer('month').notNull(),
    qtySold: integer('qty_sold').notNull(),
    /** 品类快照，导入时从 SKU 主数据写入 */
    category: varchar('category', { length: 200 }),
    source: dataSourceEnum('source').notNull().default('import'),
    importBatchId: uuid('import_batch_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuChannelMonthUnique: uniqueIndex('sales_history_monthly_sku_channel_month_unique_idx').on(
      table.skuId,
      table.channel,
      table.saleYear,
      table.month,
    ),
    skuYearMonthIdx: index('sales_history_monthly_sku_year_month_idx').on(
      table.skuId,
      table.saleYear,
      table.month,
    ),
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
    /** 安全库存计算方法；默认覆盖天数，可选 Z 值法 */
    safetyStockMethod: safetyStockMethodEnum('safety_stock_method').notNull().default('coverage_days'),
    /** 服务水平（Z 值法），如 0.950 */
    serviceLevel: numeric('service_level', { precision: 4, scale: 3 }),
    /** 需求标准差 σ_d（Z 值法） */
    demandStdDev: numeric('demand_std_dev'),
    /** 提前期标准差 σ_L（Z 值法，含需求与提前期波动） */
    leadTimeStdDev: numeric('lead_time_std_dev'),
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
    /** 在售平台，如 AMAZON / WALMART / ALL（全平台汇总） */
    platform: varchar('platform', { length: 50 }).notNull().default('ALL'),
    forecastYear: integer('forecast_year').notNull(),
    month: integer('month').notNull(),
    forecastDailyAvg: numeric('forecast_daily_avg', { precision: 12, scale: 4 }).notNull(),
    baselineDailyAvg: numeric('baseline_daily_avg', { precision: 12, scale: 4 }),
    manualDailyAvg: numeric('manual_daily_avg', { precision: 12, scale: 4 }),
    adjustReason: varchar('adjust_reason', { length: 200 }),
    confidenceLevel: varchar('confidence_level', { length: 20 }),
    versionId: uuid('version_id'),
    lifecycle: varchar('lifecycle', { length: 50 }),
    horizonFactors: jsonb('horizon_factors'),
    forecastProfileClass: varchar('forecast_profile_class', { length: 1 }),
    profileSegment: varchar('profile_segment', { length: 20 }),
    horizonBand: varchar('horizon_band', { length: 20 }),
    continuity12m: numeric('continuity_12m', { precision: 8, scale: 4 }),
    cv12m: numeric('cv_12m', { precision: 8, scale: 4 }),
    forecastDailyP10: numeric('forecast_daily_p10', { precision: 12, scale: 4 }),
    forecastDailyP90: numeric('forecast_daily_p90', { precision: 12, scale: 4 }),
    forecastModel: varchar('forecast_model', { length: 50 }),
    ownerName: varchar('owner_name', { length: 100 }),
    source: dataSourceEnum('source').notNull().default('import'),
    importBatchId: uuid('import_batch_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuStationMonthUnique: uniqueIndex('sales_forecast_monthly_version_unique_idx').on(
      table.skuId,
      table.station,
      table.platform,
      table.forecastYear,
      table.month,
      table.versionId,
    ),
    platformIdx: index('sales_forecast_monthly_platform_idx').on(table.platform, table.station),
    skuStationIdx: index('sales_forecast_monthly_sku_station_idx').on(table.skuId, table.station),
  }),
);

export const skusRelations = relations(skus, ({ many, one }) => ({
  spu: one(spus, { fields: [skus.spuId], references: [spus.id] }),
  bomAsFinished: many(bom, { relationName: 'finishedSku' }),
  bomAsMaterial: many(bom, { relationName: 'materialSku' }),
  inventoryRecords: many(inventoryRecords),
  salesHistory: many(salesHistory),
  salesHistoryMonthly: many(salesHistoryMonthly),
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

export const inventorySnapshotRunsRelations = relations(inventorySnapshotRuns, ({ many }) => ({
  snapshots: many(inventoryDailySnapshots),
}));

export const inventoryDailySnapshotsRelations = relations(
  inventoryDailySnapshots,
  ({ one }) => ({
    run: one(inventorySnapshotRuns, {
      fields: [inventoryDailySnapshots.runId],
      references: [inventorySnapshotRuns.id],
    }),
    sku: one(skus, {
      fields: [inventoryDailySnapshots.skuId],
      references: [skus.id],
    }),
  }),
);

export const salesHistoryRelations = relations(salesHistory, ({ one }) => ({
  sku: one(skus, { fields: [salesHistory.skuId], references: [skus.id] }),
}));

export const salesHistoryMonthlyRelations = relations(salesHistoryMonthly, ({ one }) => ({
  sku: one(skus, { fields: [salesHistoryMonthly.skuId], references: [skus.id] }),
}));

export const salesForecastMonthlyRelations = relations(salesForecastMonthly, ({ one }) => ({
  sku: one(skus, { fields: [salesForecastMonthly.skuId], references: [skus.id] }),
}));

export const safetyStockConfigRelations = relations(safetyStockConfig, ({ one }) => ({
  sku: one(skus, { fields: [safetyStockConfig.skuId], references: [skus.id] }),
}));
