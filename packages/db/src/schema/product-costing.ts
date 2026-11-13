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
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { skus } from './inventory';

export const costingProjectStatusEnum = pgEnum('costing_project_status', [
  'draft',
  'extracting',
  'bom_draft',
  'bom_ready',
  'costed',
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
    skuId: uuid('sku_id').references(() => skus.id),
    status: costingProjectStatusEnum('status').notNull().default('draft'),
    extractError: text('extract_error'),
    confirmedBomAt: timestamp('confirmed_bom_at', { withTimezone: true }),
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
    isManual: boolean('is_manual').notNull().default(false),
    extractRunId: uuid('extract_run_id').references(() => costingExtractRuns.id, {
      onDelete: 'set null',
    }),
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
  attachments: many(costingAttachments),
  extractRuns: many(costingExtractRuns),
  bomLines: many(costingBomLines),
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
}));
