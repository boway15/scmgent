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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const newsSourceTypeEnum = pgEnum('news_source_type', ['rss', 'rsshub', 'manual']);

export const newsCategoryEnum = pgEnum('news_category', [
  'supply_chain',
  'logistics',
  'customs',
  'platform_policy',
  'operations',
  'other',
]);

export const newsPriorityEnum = pgEnum('news_priority', ['high', 'medium', 'low']);

export const newsArticleStatusEnum = pgEnum('news_article_status', [
  'pending_review',
  'published',
  'ignored',
  'archived',
]);

export const newsSources = pgTable(
  'news_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    feedUrl: text('feed_url').notNull(),
    sourceType: newsSourceTypeEnum('source_type').notNull().default('rss'),
    categoryDefault: newsCategoryEnum('category_default').notNull().default('other'),
    enabled: boolean('enabled').notNull().default(true),
    fetchIntervalHours: integer('fetch_interval_hours').notNull().default(12),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    configJson: jsonb('config_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex('news_sources_code_idx').on(table.code),
    enabledFetchedIdx: index('news_sources_enabled_fetched_idx').on(
      table.enabled,
      table.lastFetchedAt,
    ),
  }),
);

export const newsArticles = pgTable(
  'news_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => newsSources.id, { onDelete: 'cascade' }),
    canonicalUrl: text('canonical_url').notNull(),
    urlHash: varchar('url_hash', { length: 64 }).notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    bodyText: text('body_text'),
    keyPoints: jsonb('key_points').$type<string[]>(),
    category: newsCategoryEnum('category').notNull().default('other'),
    bitableCategory: varchar('bitable_category', { length: 50 }),
    tags: text('tags').array(),
    relevanceScore: integer('relevance_score').notNull().default(0),
    priority: newsPriorityEnum('priority').notNull().default('low'),
    status: newsArticleStatusEnum('status').notNull().default('pending_review'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    affectedPlatforms: text('affected_platforms').array(),
    affectedRegions: text('affected_regions').array(),
    language: varchar('language', { length: 10 }),
    bitableRecordId: varchar('bitable_record_id', { length: 100 }),
    bitableSyncedAt: timestamp('bitable_synced_at', { withTimezone: true }),
    ingestRunId: uuid('ingest_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    urlHashUnique: uniqueIndex('news_articles_url_hash_idx').on(table.urlHash),
    contentHashIdx: index('news_articles_content_hash_idx').on(table.contentHash),
    statusPriorityIdx: index('news_articles_status_priority_idx').on(
      table.status,
      table.priority,
      table.publishedAt,
    ),
    sourceFetchedIdx: index('news_articles_source_fetched_idx').on(table.sourceId, table.fetchedAt),
  }),
);

export const newsIngestLogs = pgTable(
  'news_ingest_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => newsSources.id, { onDelete: 'cascade' }),
    taskRunId: uuid('task_run_id'),
    fetchedCount: integer('fetched_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    skippedDup: integer('skipped_dup').notNull().default(0),
    skippedLowRelevance: integer('skipped_low_relevance').notNull().default(0),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceCreatedIdx: index('news_ingest_logs_source_created_idx').on(
      table.sourceId,
      table.createdAt,
    ),
  }),
);

export const newsSourcesRelations = relations(newsSources, ({ many }) => ({
  articles: many(newsArticles),
  ingestLogs: many(newsIngestLogs),
}));

export const newsArticlesRelations = relations(newsArticles, ({ one }) => ({
  source: one(newsSources, { fields: [newsArticles.sourceId], references: [newsSources.id] }),
}));

export const newsIngestLogsRelations = relations(newsIngestLogs, ({ one }) => ({
  source: one(newsSources, { fields: [newsIngestLogs.sourceId], references: [newsSources.id] }),
}));
