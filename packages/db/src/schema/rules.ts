import { pgTable, uuid, varchar, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

/** 规则参数集。params 只存该作用范围覆盖的键，未出现的键向上继承。 */
export const ruleParamSets = pgTable(
  'rule_param_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleCode: varchar('module_code', { length: 50 }).notNull(),
    scopeType: varchar('scope_type', { length: 20 }).notNull(),
    scopeValue: varchar('scope_value', { length: 100 }).notNull(),
    params: jsonb('params').notNull(),
    version: integer('version').notNull(),
    /** draft / pending_approval / active / archived */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    note: text('note'),
    reviewNote: text('review_note'),
    simulatedAt: timestamp('simulated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    moduleScopeIdx: index('rule_param_sets_module_scope_idx').on(
      table.moduleCode,
      table.scopeType,
      table.scopeValue,
    ),
  }),
);

/** 每次规则评估一行；建议 / 预警只存 run id。 */
export const ruleEvalRuns = pgTable('rule_eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleCode: varchar('module_code', { length: 50 }).notNull(),
  /** task / simulation / page */
  trigger: varchar('trigger', { length: 20 }).notNull(),
  moduleVersion: integer('module_version').notNull(),
  paramSetIds: jsonb('param_set_ids').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
