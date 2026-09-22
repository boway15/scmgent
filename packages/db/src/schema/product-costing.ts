import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const costingProjectStatusEnum = pgEnum('costing_project_status', [
  'draft',
  'extracting',
  'ready',
  'extract_failed',
]);

export const costingAttachmentKindEnum = pgEnum('costing_attachment_kind', [
  'source',
  'page_image',
  'page_text',
]);

export const costingExtractRunStatusEnum = pgEnum('costing_extract_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
]);

export const costingBomConfidenceEnum = pgEnum('costing_bom_confidence', [
  'high',
  'medium',
  'low',
]);

export const costingProjects = pgTable(
  'costing_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectNo: varchar('project_no', { length: 32 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 100 }),
    constructionType: varchar('construction_type', { length: 20 }),
    drawerCount: integer('drawer_count'),
    defaultSubstrate: varchar('default_substrate', { length: 100 }),
    carcassThicknessMm: integer('carcass_thickness_mm'),
    drawerBottomThicknessMm: integer('drawer_bottom_thickness_mm'),
    sideThicknessMm: integer('side_thickness_mm'),
    backThicknessMm: integer('back_thickness_mm'),
    bottomThicknessMm: integer('bottom_thickness_mm'),
    structureSummary: text('structure_summary'),
    designPrinciples: text('design_principles'),
    hardwareFacts: jsonb('hardware_facts').$type<Array<{ name: string; spec: string; qty: number }>>(),
    otherHardwarePct: numeric('other_hardware_pct', { precision: 6, scale: 2 }),
    costComputedAt: timestamp('cost_computed_at', { withTimezone: true }),
    costSummary: jsonb('cost_summary'),
    priceAsOf: date('price_as_of').notNull().defaultNow(),
    regionId: uuid('region_id').references(() => costingRegions.id, { onDelete: 'set null' }),
    factoryId: uuid('factory_id').references(() => costingFactories.id, { onDelete: 'set null' }),
    skuId: uuid('sku_id').references(() => skus.id),
    status: costingProjectStatusEnum('status').notNull().default('draft'),
    extractError: text('extract_error'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectNoUnique: uniqueIndex('costing_projects_project_no_uidx').on(table.projectNo),
    statusCreatedIdx: index('costing_projects_status_created_idx').on(table.status, table.createdAt),
  }),
);

export const costingAttachments = pgTable(
  'costing_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => costingProjects.id, { onDelete: 'cascade' }),
    kind: costingAttachmentKindEnum('kind').notNull(),
    pageNo: integer('page_no'),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    storagePath: varchar('storage_path', { length: 500 }).notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectKindPageIdx: index('costing_attachments_project_kind_page_idx').on(
      table.projectId,
      table.kind,
      table.pageNo,
    ),
  }),
);

export const costingExtractRuns = pgTable(
  'costing_extract_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => costingProjects.id, { onDelete: 'cascade' }),
    status: costingExtractRunStatusEnum('status').notNull().default('pending'),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    difyWorkflowRunId: varchar('dify_workflow_run_id', { length: 100 }),
    rawResponse: jsonb('raw_response'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectCreatedIdx: index('costing_extract_runs_project_created_idx').on(
      table.projectId,
      table.createdAt,
    ),
  }),
);

export const costingRegions = pgTable(
  'costing_regions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex('costing_regions_code_uidx').on(table.code),
  }),
);

export const costingFactories = pgTable(
  'costing_factories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    regionId: uuid('region_id').references(() => costingRegions.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    packProfile: jsonb('pack_profile').$type<Record<string, number>>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex('costing_factories_code_uidx').on(table.code),
  }),
);

export const costingFactoryFeeRates = pgTable(
  'costing_factory_fee_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => costingRegions.id, { onDelete: 'cascade' }),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => costingFactories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    rate: numeric('rate', { precision: 8, scale: 4 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sliceNameUnique: uniqueIndex('costing_factory_fee_rates_slice_name_uidx').on(
      table.regionId,
      table.factoryId,
      table.name,
    ),
    rateNonnegative: check('costing_factory_fee_rates_rate_nonnegative_check', sql`${table.rate} >= 0`),
  }),
);

export const materialPriceBook = pgTable(
  'material_price_book',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionId: uuid('region_id').references(() => costingRegions.id, { onDelete: 'restrict' }),
    factoryId: uuid('factory_id').references(() => costingFactories.id, { onDelete: 'restrict' }),
    category: varchar('category', { length: 50 }).notNull(),
    materialName: varchar('material_name', { length: 200 }).notNull(),
    spec: varchar('spec', { length: 500 }).notNull().default(''),
    standard: varchar('standard', { length: 40 }).notNull().default(''),
    unit: varchar('unit', { length: 20 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 4 }).notNull(),
    effectiveFrom: date('effective_from').notNull().default('2000-01-01'),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeCategoryIdx: index('material_price_book_active_category_idx').on(
      table.isActive,
      table.category,
    ),
    unitPriceNonnegative: check(
      'material_price_book_unit_price_nonnegative_check',
      sql`${table.unitPrice} >= 0`,
    ),
  }),
);

export const costingBomLines = pgTable(
  'costing_bom_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => costingProjects.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    materialName: varchar('material_name', { length: 200 }).notNull(),
    spec: varchar('spec', { length: 500 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    qtyNet: numeric('qty_net', { precision: 14, scale: 4 }).notNull(),
    lossRate: numeric('loss_rate', { precision: 8, scale: 4 }).notNull().default('0'),
    qtyGross: numeric('qty_gross', { precision: 14, scale: 4 }).notNull(),
    sourceRef: varchar('source_ref', { length: 100 }),
    confidence: costingBomConfidenceEnum('confidence').notNull().default('medium'),
    notes: text('notes'),
    processOverrides: jsonb('process_overrides').$type<Record<string, number | null>>().notNull().default({}),
    isManual: boolean('is_manual').notNull().default(false),
    extractRunId: uuid('extract_run_id').references(() => costingExtractRuns.id, {
      onDelete: 'set null',
    }),
    origin: varchar('origin', { length: 20 }).notNull().default('explicit'),
    substrate: varchar('substrate', { length: 100 }),
    priceBookId: uuid('price_book_id').references(() => materialPriceBook.id, {
      onDelete: 'set null',
    }),
    unitPriceOverride: numeric('unit_price_override', { precision: 14, scale: 4 }),
    matchStatus: varchar('match_status', { length: 20 }).notNull().default('unmatched'),
    matchScope: varchar('match_scope', { length: 20 }),
    extractSnapshot: jsonb('extract_snapshot').$type<{
      materialName: string;
      spec: string | null;
      qtyNet: number;
      origin: string;
      sourceRef: string | null;
    }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectLineIdx: index('costing_bom_lines_project_line_idx').on(table.projectId, table.lineNo),
  }),
);

export const costingProjectsRelations = relations(costingProjects, ({ one, many }) => ({
  sku: one(skus, { fields: [costingProjects.skuId], references: [skus.id] }),
  creator: one(users, { fields: [costingProjects.createdBy], references: [users.id] }),
  region: one(costingRegions, { fields: [costingProjects.regionId], references: [costingRegions.id] }),
  factory: one(costingFactories, {
    fields: [costingProjects.factoryId],
    references: [costingFactories.id],
  }),
  attachments: many(costingAttachments),
  extractRuns: many(costingExtractRuns),
  bomLines: many(costingBomLines),
}));

export const costingRegionsRelations = relations(costingRegions, ({ many }) => ({
  factories: many(costingFactories),
  priceBook: many(materialPriceBook),
  projects: many(costingProjects),
}));

export const costingFactoriesRelations = relations(costingFactories, ({ one, many }) => ({
  region: one(costingRegions, { fields: [costingFactories.regionId], references: [costingRegions.id] }),
  priceBook: many(materialPriceBook),
  feeRates: many(costingFactoryFeeRates),
  projects: many(costingProjects),
}));

export const costingAttachmentsRelations = relations(costingAttachments, ({ one }) => ({
  project: one(costingProjects, {
    fields: [costingAttachments.projectId],
    references: [costingProjects.id],
  }),
}));

export const costingExtractRunsRelations = relations(costingExtractRuns, ({ one, many }) => ({
  project: one(costingProjects, {
    fields: [costingExtractRuns.projectId],
    references: [costingProjects.id],
  }),
  creator: one(users, { fields: [costingExtractRuns.createdBy], references: [users.id] }),
  bomLines: many(costingBomLines),
}));

export const costingBomLinesRelations = relations(costingBomLines, ({ one }) => ({
  project: one(costingProjects, {
    fields: [costingBomLines.projectId],
    references: [costingProjects.id],
  }),
  extractRun: one(costingExtractRuns, {
    fields: [costingBomLines.extractRunId],
    references: [costingExtractRuns.id],
  }),
  priceBook: one(materialPriceBook, {
    fields: [costingBomLines.priceBookId],
    references: [materialPriceBook.id],
  }),
}));

export const materialPriceBookRelations = relations(materialPriceBook, ({ one, many }) => ({
  region: one(costingRegions, { fields: [materialPriceBook.regionId], references: [costingRegions.id] }),
  factory: one(costingFactories, {
    fields: [materialPriceBook.factoryId],
    references: [costingFactories.id],
  }),
  bomLines: many(costingBomLines),
}));

export const costingFactoryFeeRatesRelations = relations(costingFactoryFeeRates, ({ one }) => ({
  region: one(costingRegions, {
    fields: [costingFactoryFeeRates.regionId],
    references: [costingRegions.id],
  }),
  factory: one(costingFactories, {
    fields: [costingFactoryFeeRates.factoryId],
    references: [costingFactories.id],
  }),
}));
