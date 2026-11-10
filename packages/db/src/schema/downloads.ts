import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';

export const downloadJobStatusEnum = pgEnum('download_job_status', [
  'pending',
  'running',
  'ready',
  'failed',
  'cancelled',
  'expired',
]);

export const downloadJobs = pgTable(
  'download_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    jobType: varchar('job_type', { length: 100 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    paramsJson: text('params_json').notNull().default('{}'),
    status: downloadJobStatusEnum('status').notNull().default('pending'),
    storagePath: varchar('storage_path', { length: 500 }),
    fileSize: bigint('file_size', { mode: 'number' }),
    contentType: varchar('content_type', { length: 120 }),
    rowCount: integer('row_count'),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    createdByCreatedIdx: index('download_jobs_created_by_created_idx').on(
      table.createdBy,
      table.createdAt,
    ),
    statusExpiresIdx: index('download_jobs_status_expires_idx').on(table.status, table.expiresAt),
  }),
);

export const downloadJobsRelations = relations(downloadJobs, ({ one }) => ({
  creator: one(users, { fields: [downloadJobs.createdBy], references: [users.id] }),
}));
