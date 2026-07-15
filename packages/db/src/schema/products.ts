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
    /** 事业部号段 1/3/5/7 */
    divisionCode: varchar('division_code', { length: 1 }),
    /** 分销序号 0=原始 1-9=分销 */
    distributionNo: integer('distribution_no').default(0),
    /** SPU 五位产品序号（事业部内唯一） */
    spuNumericCode: varchar('spu_numeric_code', { length: 10 }),
    brandCode: varchar('brand_code', { length: 2 }),
    categoryCode: varchar('category_code', { length: 3 }),
    divisionName: varchar('division_name', { length: 50 }),
    /** manual | sku_derived */
    encodingSource: varchar('encoding_source', { length: 20 }).default('manual'),
    /** 款式级最小起订量，补货时 SKU 未单独设置时继承 */
    moq: integer('moq'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    categoryIdx: index('spus_category_idx').on(table.category),
    divisionSpuIdx: index('spus_division_spu_numeric_idx').on(
      table.divisionCode,
      table.spuNumericCode,
    ),
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
  /** 工厂平均生产周期（天） */
  productionLeadDays: integer('production_lead_days').notNull().default(50),
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
