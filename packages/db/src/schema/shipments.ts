import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { skus } from './inventory';
import { purchaseDrafts } from './procurement';
import { pmcPlanItems } from './pmc';

/** booked|loaded|departed|arrived_port|customs|received_wh|available|cancelled */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentNo: varchar('shipment_no', { length: 100 }).notNull().unique(),
    draftId: uuid('draft_id').references(() => purchaseDrafts.id, { onDelete: 'set null' }),
    planItemId: uuid('plan_item_id').references(() => pmcPlanItems.id, { onDelete: 'set null' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    qty: integer('qty').notNull(),
    containerNo: varchar('container_no', { length: 100 }),
    bookingRef: varchar('booking_ref', { length: 100 }),
    trackingNo: varchar('tracking_no', { length: 100 }),
    transportMode: varchar('transport_mode', { length: 50 }),
    status: varchar('status', { length: 30 }).notNull().default('booked'),
    etaAvailable: date('eta_available'),
    sourceSystem: varchar('source_system', { length: 50 }),
    externalId: varchar('external_id', { length: 100 }),
    externalVersion: varchar('external_version', { length: 50 }),
    syncStatus: varchar('sync_status', { length: 20 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    draftIdx: index('shipments_draft_id_idx').on(table.draftId),
    skuIdx: index('shipments_sku_id_idx').on(table.skuId),
    statusIdx: index('shipments_status_idx').on(table.status),
  }),
);

export const shipmentMilestones = pgTable(
  'shipment_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    milestone: varchar('milestone', { length: 30 }).notNull(),
    plannedAt: date('planned_at'),
    actualAt: date('actual_at'),
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shipmentMilestoneUnique: uniqueIndex('shipment_milestones_shipment_milestone_idx').on(
      table.shipmentId,
      table.milestone,
    ),
  }),
);

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  draft: one(purchaseDrafts, {
    fields: [shipments.draftId],
    references: [purchaseDrafts.id],
  }),
  planItem: one(pmcPlanItems, {
    fields: [shipments.planItemId],
    references: [pmcPlanItems.id],
  }),
  sku: one(skus, { fields: [shipments.skuId], references: [skus.id] }),
  milestones: many(shipmentMilestones),
}));

export const shipmentMilestonesRelations = relations(shipmentMilestones, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentMilestones.shipmentId],
    references: [shipments.id],
  }),
}));
