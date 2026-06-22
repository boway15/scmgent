import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';

export const fobSettlementStatusEnum = pgEnum('fob_settlement_status', [
  'draft',
  'imported',
  'reviewed',
  'calculated',
  'confirmed',
]);

export const fobCostStageEnum = pgEnum('fob_cost_stage', [
  'trucking',
  'freight',
  'customs',
  'other',
]);

export const fobAllocationMethodEnum = pgEnum('fob_allocation_method', [
  'by_volume',
  'by_ticket',
  'fixed',
  'manual',
]);

export const fobExceptionStatusEnum = pgEnum('fob_exception_status', [
  'pending',
  'confirmed',
  'rejected',
]);

export const fobAdjustTypeEnum = pgEnum('fob_adjust_type', [
  'amount',
  'merchant',
  'exclude',
  'ticket_count',
]);

export const fobSettlementTypeEnum = pgEnum('fob_settlement_type', ['trucking', 'freight']);

export const fobProviderTypeEnum = pgEnum('fob_provider_type', ['trucking', 'freight']);

export const fobPaymentStatusEnum = pgEnum('fob_payment_status', ['paid', 'unpaid', 'not_required']);

export const fobServiceProviders = pgTable(
  'fob_service_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    providerType: fobProviderTypeEnum('provider_type').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeActiveIdx: index('fob_service_providers_type_active_idx').on(
      table.providerType,
      table.isActive,
    ),
  }),
);

export const fobSettlementBatches = pgTable(
  'fob_settlement_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchNo: varchar('batch_no', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    settlementPeriod: varchar('settlement_period', { length: 7 }).notNull(),
    settlementType: fobSettlementTypeEnum('settlement_type').notNull(),
    serviceProviderId: uuid('service_provider_id')
      .notNull()
      .references(() => fobServiceProviders.id),
    usdToCnyRate: numeric('usd_to_cny_rate', { precision: 10, scale: 4 }).notNull().default('7.25'),
    status: fobSettlementStatusEnum('status').notNull().default('draft'),
    remark: text('remark'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    periodIdx: index('fob_settlement_batches_period_idx').on(table.settlementPeriod, table.status),
  }),
);

export const fobFeeAllocationRules = pgTable(
  'fob_fee_allocation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feeType: varchar('fee_type', { length: 100 }),
    sourceBillType: varchar('source_bill_type', { length: 20 }).notNull(),
    matchPattern: varchar('match_pattern', { length: 100 }),
    allocationMethod: fobAllocationMethodEnum('allocation_method').notNull(),
    defaultStage: fobCostStageEnum('default_stage').notNull().default('other'),
    priority: integer('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    billTypeIdx: index('fob_fee_allocation_rules_bill_type_idx').on(
      table.sourceBillType,
      table.isActive,
    ),
  }),
);

export const fobMerchantShipments = pgTable(
  'fob_merchant_shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    merchantCode: varchar('merchant_code', { length: 100 }).notNull(),
    merchantName: varchar('merchant_name', { length: 200 }),
    containerNo: varchar('container_no', { length: 50 }).notNull(),
    skuCode: varchar('sku_code', { length: 100 }),
    qty: integer('qty'),
    volumeCbm: numeric('volume_cbm', { precision: 12, scale: 4 }).notNull(),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }),
    remark: text('remark'),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchContainerIdx: index('fob_merchant_shipments_batch_container_idx').on(
      table.batchId,
      table.containerNo,
    ),
  }),
);

export const fobContainerMerchantStats = pgTable(
  'fob_container_merchant_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    containerNo: varchar('container_no', { length: 50 }).notNull(),
    merchantCode: varchar('merchant_code', { length: 100 }).notNull(),
    merchantName: varchar('merchant_name', { length: 200 }),
    volumeCbm: numeric('volume_cbm', { precision: 12, scale: 4 }).notNull(),
    ticketCount: integer('ticket_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchContainerMerchantUq: uniqueIndex('fob_container_merchant_stats_uq').on(
      table.batchId,
      table.containerNo,
      table.merchantCode,
    ),
  }),
);

const billItemReviewColumns = {
  allocationMethod: fobAllocationMethodEnum('allocation_method'),
  isException: boolean('is_exception').notNull().default(false),
  exceptionStatus: fobExceptionStatusEnum('exception_status'),
  assignedMerchantCode: varchar('assigned_merchant_code', { length: 100 }),
  adjustedAmountCny: numeric('adjusted_amount_cny', { precision: 14, scale: 2 }),
  reviewNote: text('review_note'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
};

export const fobTruckingBillItems = pgTable(
  'fob_trucking_bill_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    containerNo: varchar('container_no', { length: 50 }).notNull(),
    internalNo: varchar('internal_no', { length: 100 }),
    blNo: varchar('bl_no', { length: 100 }),
    shipDate: varchar('ship_date', { length: 50 }),
    loadAddress: text('load_address'),
    feeType: varchar('fee_type', { length: 100 }).notNull(),
    amountCny: numeric('amount_cny', { precision: 14, scale: 2 }).notNull(),
    sourceRow: integer('source_row'),
    remark: text('remark'),
    ...billItemReviewColumns,
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchContainerIdx: index('fob_trucking_bill_items_batch_container_idx').on(
      table.batchId,
      table.containerNo,
    ),
  }),
);

export const fobFreightBillItems = pgTable(
  'fob_freight_bill_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    containerNo: varchar('container_no', { length: 50 }).notNull(),
    orderNo: varchar('order_no', { length: 100 }),
    blNo: varchar('bl_no', { length: 100 }),
    bizDate: varchar('biz_date', { length: 50 }),
    destPort: varchar('dest_port', { length: 50 }),
    volumeCbm: numeric('volume_cbm', { precision: 12, scale: 4 }),
    feeType: varchar('fee_type', { length: 100 }).notNull(),
    stage: fobCostStageEnum('stage').notNull().default('freight'),
    amountCny: numeric('amount_cny', { precision: 14, scale: 2 }).notNull(),
    originalCurrency: varchar('original_currency', { length: 3 }).notNull().default('CNY'),
    originalAmount: numeric('original_amount', { precision: 14, scale: 2 }),
    exchangeRate: numeric('exchange_rate', { precision: 10, scale: 4 }),
    sourceRow: integer('source_row'),
    panelSide: varchar('panel_side', { length: 10 }),
    remark: text('remark'),
    ...billItemReviewColumns,
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchContainerIdx: index('fob_freight_bill_items_batch_container_idx').on(
      table.batchId,
      table.containerNo,
    ),
  }),
);

export const fobSettlementAllocations = pgTable(
  'fob_settlement_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    containerNo: varchar('container_no', { length: 50 }).notNull(),
    merchantCode: varchar('merchant_code', { length: 100 }).notNull(),
    merchantName: varchar('merchant_name', { length: 200 }),
    stage: fobCostStageEnum('stage').notNull(),
    feeType: varchar('fee_type', { length: 100 }).notNull(),
    sourceBillType: varchar('source_bill_type', { length: 20 }).notNull(),
    sourceBillItemId: uuid('source_bill_item_id'),
    sourceRef: varchar('source_ref', { length: 200 }),
    allocationMethod: fobAllocationMethodEnum('allocation_method').notNull().default('by_volume'),
    sourceAmountCny: numeric('source_amount_cny', { precision: 14, scale: 2 }).notNull(),
    merchantVolumeCbm: numeric('merchant_volume_cbm', { precision: 12, scale: 4 }).notNull().default('0'),
    volumeRatio: numeric('volume_ratio', { precision: 10, scale: 6 }).notNull().default('0'),
    ticketCount: integer('ticket_count'),
    ticketRatio: numeric('ticket_ratio', { precision: 10, scale: 6 }),
    allocatedAmountCny: numeric('allocated_amount_cny', { precision: 14, scale: 2 }).notNull(),
    isTailAdjustment: boolean('is_tail_adjustment').notNull().default(false),
    isManualOverride: boolean('is_manual_override').notNull().default(false),
    overrideReason: text('override_reason'),
    calcAt: timestamp('calc_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchMerchantIdx: index('fob_settlement_allocations_batch_merchant_idx').on(
      table.batchId,
      table.merchantCode,
    ),
  }),
);

export const fobSettlementAdjustments = pgTable(
  'fob_settlement_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    allocationId: uuid('allocation_id').references(() => fobSettlementAllocations.id, {
      onDelete: 'set null',
    }),
    billItemId: uuid('bill_item_id'),
    billItemType: varchar('bill_item_type', { length: 20 }),
    adjustType: fobAdjustTypeEnum('adjust_type').notNull(),
    originalValue: text('original_value'),
    adjustedValue: text('adjusted_value').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchIdx: index('fob_settlement_adjustments_batch_idx').on(table.batchId),
  }),
);

export const fobMerchantPaymentStatus = pgTable(
  'fob_merchant_payment_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => fobSettlementBatches.id, { onDelete: 'cascade' }),
    merchantCode: varchar('merchant_code', { length: 100 }).notNull(),
    paymentStatus: fobPaymentStatusEnum('payment_status').notNull().default('unpaid'),
    remark: text('remark'),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchMerchantUq: uniqueIndex('fob_merchant_payment_status_batch_merchant_uq').on(
      table.batchId,
      table.merchantCode,
    ),
  }),
);

export const fobServiceProvidersRelations = relations(fobServiceProviders, ({ many }) => ({
  settlementBatches: many(fobSettlementBatches),
}));

export const fobSettlementBatchesRelations = relations(fobSettlementBatches, ({ one, many }) => ({
  creator: one(users, { fields: [fobSettlementBatches.createdBy], references: [users.id] }),
  serviceProvider: one(fobServiceProviders, {
    fields: [fobSettlementBatches.serviceProviderId],
    references: [fobServiceProviders.id],
  }),
  merchantShipments: many(fobMerchantShipments),
  containerMerchantStats: many(fobContainerMerchantStats),
  truckingItems: many(fobTruckingBillItems),
  freightItems: many(fobFreightBillItems),
  allocations: many(fobSettlementAllocations),
  adjustments: many(fobSettlementAdjustments),
  merchantPaymentStatuses: many(fobMerchantPaymentStatus),
}));

export const fobMerchantPaymentStatusRelations = relations(fobMerchantPaymentStatus, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobMerchantPaymentStatus.batchId],
    references: [fobSettlementBatches.id],
  }),
  updatedByUser: one(users, {
    fields: [fobMerchantPaymentStatus.updatedBy],
    references: [users.id],
  }),
}));

export const fobFeeAllocationRulesRelations = relations(fobFeeAllocationRules, () => ({}));

export const fobMerchantShipmentsRelations = relations(fobMerchantShipments, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobMerchantShipments.batchId],
    references: [fobSettlementBatches.id],
  }),
}));

export const fobContainerMerchantStatsRelations = relations(fobContainerMerchantStats, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobContainerMerchantStats.batchId],
    references: [fobSettlementBatches.id],
  }),
}));

export const fobTruckingBillItemsRelations = relations(fobTruckingBillItems, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobTruckingBillItems.batchId],
    references: [fobSettlementBatches.id],
  }),
}));

export const fobFreightBillItemsRelations = relations(fobFreightBillItems, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobFreightBillItems.batchId],
    references: [fobSettlementBatches.id],
  }),
}));

export const fobSettlementAllocationsRelations = relations(fobSettlementAllocations, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobSettlementAllocations.batchId],
    references: [fobSettlementBatches.id],
  }),
}));

export const fobSettlementAdjustmentsRelations = relations(fobSettlementAdjustments, ({ one }) => ({
  batch: one(fobSettlementBatches, {
    fields: [fobSettlementAdjustments.batchId],
    references: [fobSettlementBatches.id],
  }),
  allocation: one(fobSettlementAllocations, {
    fields: [fobSettlementAdjustments.allocationId],
    references: [fobSettlementAllocations.id],
  }),
}));
