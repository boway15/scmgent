import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';

export const csReplyBatchStatusEnum = pgEnum('cs_reply_batch_status', [
  'importing',
  'imported',
  'scoring',
  'completed',
  'failed',
]);

export const csReplyScoreStatusEnum = pgEnum('cs_reply_score_status', [
  'pending',
  'scoring',
  'scored',
  'failed',
  'skipped',
]);

export type CsReplyScoreDetail = {
  accuracy: number;
  professionalism: number;
  empathy: number;
  resolution: number;
};

export const csReplyBatches = pgTable(
  'cs_reply_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchNo: varchar('batch_no', { length: 32 }).notNull(),
    name: varchar('name', { length: 200 }),
    status: csReplyBatchStatusEnum('status').notNull().default('importing'),
    totalRows: integer('total_rows').notNull().default(0),
    importedRows: integer('imported_rows').notNull().default(0),
    scoredRows: integer('scored_rows').notNull().default(0),
    failedRows: integer('failed_rows').notNull().default(0),
    passThreshold: integer('pass_threshold').notNull().default(70),
    errorSummary: text('error_summary'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCreatedIdx: index('cs_reply_batches_status_created_idx').on(table.status, table.createdAt),
    batchNoIdx: index('cs_reply_batches_batch_no_idx').on(table.batchNo),
  }),
);

export const csReplyRecords = pgTable(
  'cs_reply_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => csReplyBatches.id, { onDelete: 'cascade' }),
    rowNo: integer('row_no').notNull(),
    buyerEmail: varchar('buyer_email', { length: 256 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    agentName: varchar('agent_name', { length: 64 }),
    messageType: varchar('message_type', { length: 32 }),
    orderNo: varchar('order_no', { length: 64 }),
    buyerMessage: text('buyer_message').notNull(),
    agentReply: text('agent_reply').notNull(),
    scoreStatus: csReplyScoreStatusEnum('score_status').notNull().default('pending'),
    overallScore: integer('overall_score'),
    scoreDetail: jsonb('score_detail').$type<CsReplyScoreDetail>(),
    feedback: text('feedback'),
    highlights: jsonb('highlights').$type<string[]>(),
    issues: jsonb('issues').$type<string[]>(),
    pass: boolean('pass'),
    errorMessage: text('error_message'),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchRowIdx: index('cs_reply_records_batch_row_idx').on(table.batchId, table.rowNo),
    batchScoreIdx: index('cs_reply_records_batch_score_idx').on(table.batchId, table.scoreStatus),
    agentIdx: index('cs_reply_records_agent_idx').on(table.agentName),
    sentAtIdx: index('cs_reply_records_sent_at_idx').on(table.sentAt),
  }),
);

export const csReplyBatchesRelations = relations(csReplyBatches, ({ one, many }) => ({
  creator: one(users, { fields: [csReplyBatches.createdBy], references: [users.id] }),
  records: many(csReplyRecords),
}));

export const csReplyRecordsRelations = relations(csReplyRecords, ({ one }) => ({
  batch: one(csReplyBatches, { fields: [csReplyRecords.batchId], references: [csReplyBatches.id] }),
}));
