import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const transportModeEnum = pgEnum('transport_mode', [
  'fcl',
  'lcl',
  'air',
  'express',
  'rail',
  'truck_air',
  'direct',
]);

export const leadTimeProfiles = pgTable(
  'lead_time_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantCode: varchar('merchant_code', { length: 100 }),
    originLocation: varchar('origin_location', { length: 100 }),
    destinationWarehouseCode: varchar('destination_warehouse_code', { length: 100 }).notNull(),
    transportMode: transportModeEnum('transport_mode'),
    productionDays: integer('production_days').notNull().default(0),
    domesticDays: integer('domestic_days').notNull().default(0),
    bookingDays: integer('booking_days').notNull().default(0),
    transitDays: integer('transit_days').notNull().default(0),
    customsDays: integer('customs_days').notNull().default(0),
    inboundDays: integer('inbound_days').notNull().default(0),
    leadTimeStdDev: integer('lead_time_std_dev'),
    isDefault: boolean('is_default').notNull().default(false),
    sourceSystem: varchar('source_system', { length: 50 }),
    externalId: varchar('external_id', { length: 100 }),
    externalVersion: varchar('external_version', { length: 50 }),
    syncStatus: varchar('sync_status', { length: 20 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    merchantWhIdx: index('lead_time_profiles_merchant_wh_idx').on(
      table.merchantCode,
      table.destinationWarehouseCode,
    ),
  }),
);
