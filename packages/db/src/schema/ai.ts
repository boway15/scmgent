import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';

export const kbMessageRoleEnum = pgEnum('kb_message_role', ['user', 'assistant']);

export const aiRunStatusEnum = pgEnum('ai_run_status', [
  'running',
  'success',
  'failed',
  'cancelled',
]);

export const kbConversations = pgTable('kb_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  difyConversationId: varchar('dify_conversation_id', { length: 200 }),
  title: varchar('title', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbMessages = pgTable('kb_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => kbConversations.id, { onDelete: 'cascade' }),
  role: kbMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  sources: jsonb('sources'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbConversationsRelations = relations(kbConversations, ({ one, many }) => ({
  user: one(users, { fields: [kbConversations.userId], references: [users.id] }),
  messages: many(kbMessages),
}));

export const kbMessagesRelations = relations(kbMessages, ({ one }) => ({
  conversation: one(kbConversations, {
    fields: [kbMessages.conversationId],
    references: [kbConversations.id],
  }),
}));

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    graphName: varchar('graph_name', { length: 100 }).notNull(),
    userId: uuid('user_id').references(() => users.id),
    conversationId: uuid('conversation_id').references(() => kbConversations.id, {
      onDelete: 'set null',
    }),
    triggeredBy: varchar('triggered_by', { length: 200 }),
    status: aiRunStatusEnum('status').notNull().default('running'),
    input: jsonb('input'),
    output: jsonb('output'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    graphStartedIdx: index('ai_runs_graph_started_idx').on(table.graphName, table.startedAt),
    userIdx: index('ai_runs_user_idx').on(table.userId),
  }),
);

export const aiRunSteps = pgTable(
  'ai_run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    nodeName: varchar('node_name', { length: 100 }).notNull(),
    status: aiRunStatusEnum('status').notNull().default('running'),
    input: jsonb('input'),
    output: jsonb('output'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    runIdx: index('ai_run_steps_run_idx').on(table.runId),
  }),
);

export const aiToolCalls = pgTable(
  'ai_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => aiRunSteps.id, { onDelete: 'set null' }),
    toolName: varchar('tool_name', { length: 100 }).notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index('ai_tool_calls_run_idx').on(table.runId),
    toolIdx: index('ai_tool_calls_tool_idx').on(table.toolName),
  }),
);

export const aiRunsRelations = relations(aiRuns, ({ one, many }) => ({
  user: one(users, { fields: [aiRuns.userId], references: [users.id] }),
  conversation: one(kbConversations, {
    fields: [aiRuns.conversationId],
    references: [kbConversations.id],
  }),
  steps: many(aiRunSteps),
  toolCalls: many(aiToolCalls),
}));

export const aiRunStepsRelations = relations(aiRunSteps, ({ one }) => ({
  run: one(aiRuns, { fields: [aiRunSteps.runId], references: [aiRuns.id] }),
}));

export const aiToolCallsRelations = relations(aiToolCalls, ({ one }) => ({
  run: one(aiRuns, { fields: [aiToolCalls.runId], references: [aiRuns.id] }),
  step: one(aiRunSteps, { fields: [aiToolCalls.stepId], references: [aiRunSteps.id] }),
}));
