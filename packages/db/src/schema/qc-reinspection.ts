import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

/** 需要二次验货的工厂全称。来自飞书目标表「文本」占位行，同步时并入。 */
export const qcReinspectionFactories = pgTable('qc_reinspection_factories', {
  factoryName: varchar('factory_name', { length: 200 }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const qcReinspectionRows = pgTable(
  'qc_reinspection_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: varchar('source_record_id', { length: 100 }).notNull(),
    bitableRecordId: varchar('bitable_record_id', { length: 100 }),
    supplierShortName: varchar('supplier_short_name', { length: 100 }),
    inspectionStatus: varchar('inspection_status', { length: 50 }),
    purchaseOrderNo: varchar('purchase_order_no', { length: 100 }),
    demandNo: varchar('demand_no', { length: 100 }),
    sku: varchar('sku', { length: 100 }),
    productName: text('product_name'),
    cartonCount: varchar('carton_count', { length: 50 }),
    pieceCount: varchar('piece_count', { length: 50 }),
    destWarehouse: varchar('dest_warehouse', { length: 200 }),
    factoryType: varchar('factory_type', { length: 50 }),
    expectedShipDate: varchar('expected_ship_date', { length: 40 }),
    containerCartonCount: varchar('container_carton_count', { length: 50 }),
    containerPieceCount: varchar('container_piece_count', { length: 50 }),
    transferStatus: varchar('transfer_status', { length: 50 }),
    followUpReadyAt: varchar('follow_up_ready_at', { length: 40 }),
    goodsReadyAt: varchar('goods_ready_at', { length: 40 }),
    loadingNote: text('loading_note'),
    gapDays: integer('gap_days'),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceRecordUnique: uniqueIndex('qc_reinspection_rows_source_record_id_idx').on(
      table.sourceRecordId,
    ),
    insertedAtIdx: index('qc_reinspection_rows_inserted_at_idx').on(table.insertedAt),
  }),
);
