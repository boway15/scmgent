import { pgTable, pgEnum, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';

export const kbMessageRoleEnum = pgEnum('kb_message_role', ['user', 'assistant']);

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
