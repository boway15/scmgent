import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

export type SalesAnalyticsCubePayload = {
  meta: {
    generatedAt: string;
    dateStart: string | null;
    dateEnd: string | null;
    weekStart: string | null;
    weekEnd: string | null;
    recordCount: number;
    totalSales: number;
    sites: string[];
    depts: string[];
    categories: string[];
    platforms: string[];
  };
  months: string[];
  weeks: string[];
  data: Array<{
    s: string;
    b: string;
    c: string;
    p: string;
    v: number[];
    vw: number[];
  }>;
};

export const salesAnalyticsCubeSnapshots = pgTable(
  'sales_analytics_cube_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: varchar('status', { length: 20 }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    meta: jsonb('meta').$type<SalesAnalyticsCubePayload['meta']>(),
    payload: jsonb('payload').$type<SalesAnalyticsCubePayload>(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (table) => ({
    statusCreatedIdx: index('sales_analytics_cube_snapshots_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);
