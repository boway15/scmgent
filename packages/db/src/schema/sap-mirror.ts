import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

/** running|succeeded|failed|partial */
export type SapSyncRunStatus = 'running' | 'succeeded' | 'failed' | 'partial';

/** merchant|sku|purchase_order */
export type SapMirrorEntityType = 'merchant' | 'sku' | 'purchase_order';

export type SapSyncRunSummary = {
  inserted?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ externalId?: string; message: string }>;
};

export const sapSyncRuns = pgTable(
  'sap_sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSystem: varchar('source_system', { length: 50 }).notNull().default('sap'),
    /** merchant|sku|purchase_order */
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    /** running|succeeded|failed|partial */
    status: varchar('status', { length: 20 }).notNull().default('running'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    summary: jsonb('summary').$type<SapSyncRunSummary>(),
    errorMessage: text('error_message'),
  },
  (table) => ({
    entityStartedIdx: index('sap_sync_runs_entity_started_idx').on(
      table.entityType,
      table.startedAt,
    ),
    statusIdx: index('sap_sync_runs_status_idx').on(table.status),
  }),
);

export const sapPoMirrors = pgTable(
  'sap_po_mirrors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSystem: varchar('source_system', { length: 50 }).notNull().default('sap'),
    externalId: varchar('external_id', { length: 100 }).notNull(),
    externalVersion: varchar('external_version', { length: 50 }),
    /** pending|synced|error|ignored */
    syncStatus: varchar('sync_status', { length: 20 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    poNumber: varchar('po_number', { length: 100 }),
    vendorExternalId: varchar('vendor_external_id', { length: 100 }),
    merchantCode: varchar('merchant_code', { length: 100 }),
    orderDate: date('order_date'),
    statusRaw: varchar('status_raw', { length: 100 }),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceExternalUnique: uniqueIndex('sap_po_mirrors_source_external_idx').on(
      table.sourceSystem,
      table.externalId,
    ),
    poNumberIdx: index('sap_po_mirrors_po_number_idx').on(table.poNumber),
    syncStatusIdx: index('sap_po_mirrors_sync_status_idx').on(table.syncStatus),
  }),
);

export const sapPoMirrorLines = pgTable(
  'sap_po_mirror_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mirrorId: uuid('mirror_id')
      .notNull()
      .references(() => sapPoMirrors.id, { onDelete: 'cascade' }),
    externalLineId: varchar('external_line_id', { length: 100 }).notNull(),
    skuExternalId: varchar('sku_external_id', { length: 100 }),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'set null' }),
    qty: integer('qty'),
    uom: varchar('uom', { length: 20 }),
    deliveryDate: date('delivery_date'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mirrorLineUnique: uniqueIndex('sap_po_mirror_lines_mirror_line_idx').on(
      table.mirrorId,
      table.externalLineId,
    ),
    mirrorIdx: index('sap_po_mirror_lines_mirror_id_idx').on(table.mirrorId),
    skuIdx: index('sap_po_mirror_lines_sku_id_idx').on(table.skuId),
  }),
);

export const sapSyncRunsRelations = relations(sapSyncRuns, ({ one }) => ({
  requester: one(users, { fields: [sapSyncRuns.requestedBy], references: [users.id] }),
}));

export const sapPoMirrorsRelations = relations(sapPoMirrors, ({ many }) => ({
  lines: many(sapPoMirrorLines),
}));

export const sapPoMirrorLinesRelations = relations(sapPoMirrorLines, ({ one }) => ({
  mirror: one(sapPoMirrors, {
    fields: [sapPoMirrorLines.mirrorId],
    references: [sapPoMirrors.id],
  }),
  sku: one(skus, { fields: [sapPoMirrorLines.skuId], references: [skus.id] }),
}));
