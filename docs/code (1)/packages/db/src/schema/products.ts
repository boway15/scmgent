import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { skus } from './inventory';

export const spus = pgTable(
  'spus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 100 }),
    brand: varchar('brand', { length: 100 }),
    description: text('description'),
    /** 款式级最小起订量，补货时 SKU 未单独设置时继承 */
    moq: integer('moq'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    categoryIdx: index('spus_category_idx').on(table.category),
  }),
);

export const merchants = pgTable('merchants', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 50 }),
  contactEmail: varchar('contact_email', { length: 200 }),
  countryCode: varchar('country_code', { length: 2 }),
  paymentTerms: varchar('payment_terms', { length: 100 }),
  remark: text('remark'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skuSuppliers = pgTable(
  'sku_suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4 }),
    leadTimeDays: integer('lead_time_days'),
    moq: integer('moq'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuMerchantUnique: uniqueIndex('sku_suppliers_sku_merchant_idx').on(table.skuId, table.merchantId),
    skuIdx: index('sku_suppliers_sku_id_idx').on(table.skuId),
    merchantIdx: index('sku_suppliers_merchant_id_idx').on(table.merchantId),
  }),
);

export const skuCompliance = pgTable('sku_compliance', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id')
    .notNull()
    .unique()
    .references(() => skus.id, { onDelete: 'cascade' }),
  hsCode: varchar('hs_code', { length: 20 }),
  originCountry: varchar('origin_country', { length: 2 }),
  declaredValue: numeric('declared_value', { precision: 12, scale: 4 }),
  weightKg: numeric('weight_kg', { precision: 10, scale: 4 }),
  lengthCm: numeric('length_cm', { precision: 8, scale: 2 }),
  widthCm: numeric('width_cm', { precision: 8, scale: 2 }),
  heightCm: numeric('height_cm', { precision: 8, scale: 2 }),
  batteryType: varchar('battery_type', { length: 50 }),
  isLiquid: boolean('is_liquid').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spusRelations = relations(spus, ({ many }) => ({
  skus: many(skus),
}));

export const merchantsRelations = relations(merchants, ({ many }) => ({
  skuSuppliers: many(skuSuppliers),
}));

export const skuSuppliersRelations = relations(skuSuppliers, ({ one }) => ({
  sku: one(skus, { fields: [skuSuppliers.skuId], references: [skus.id] }),
  merchant: one(merchants, { fields: [skuSuppliers.merchantId], references: [merchants.id] }),
}));

export const skuComplianceRelations = relations(skuCompliance, ({ one }) => ({
  sku: one(skus, { fields: [skuCompliance.skuId], references: [skus.id] }),
}));
