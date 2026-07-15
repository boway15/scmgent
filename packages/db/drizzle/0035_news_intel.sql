DO $$ BEGIN
  CREATE TYPE "news_source_type" AS ENUM('rss', 'rsshub', 'manual');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "news_category" AS ENUM(
    'supply_chain',
    'logistics',
    'customs',
    'platform_policy',
    'operations',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "news_priority" AS ENUM('high', 'medium', 'low');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "news_article_status" AS ENUM('pending_review', 'published', 'ignored', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "news_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL,
  "name" varchar(200) NOT NULL,
  "feed_url" text NOT NULL,
  "source_type" "news_source_type" DEFAULT 'rss' NOT NULL,
  "category_default" "news_category" DEFAULT 'other' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "fetch_interval_hours" integer DEFAULT 12 NOT NULL,
  "last_fetched_at" timestamptz,
  "last_error" text,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "config_json" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "news_sources_code_idx" ON "news_sources" ("code");
CREATE INDEX IF NOT EXISTS "news_sources_enabled_fetched_idx" ON "news_sources" ("enabled", "last_fetched_at");

CREATE TABLE IF NOT EXISTS "news_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL REFERENCES "news_sources"("id") ON DELETE CASCADE,
  "canonical_url" text NOT NULL,
  "url_hash" varchar(64) NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "body_text" text,
  "key_points" jsonb,
  "category" "news_category" DEFAULT 'other' NOT NULL,
  "tags" text[],
  "relevance_score" integer DEFAULT 0 NOT NULL,
  "priority" "news_priority" DEFAULT 'low' NOT NULL,
  "status" "news_article_status" DEFAULT 'pending_review' NOT NULL,
  "published_at" timestamptz,
  "fetched_at" timestamptz DEFAULT now() NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "affected_platforms" text[],
  "affected_regions" text[],
  "language" varchar(10),
  "bitable_record_id" varchar(100),
  "bitable_synced_at" timestamptz,
  "ingest_run_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "news_articles_url_hash_idx" ON "news_articles" ("url_hash");
CREATE INDEX IF NOT EXISTS "news_articles_content_hash_idx" ON "news_articles" ("content_hash");
CREATE INDEX IF NOT EXISTS "news_articles_status_priority_idx" ON "news_articles" ("status", "priority", "published_at");
CREATE INDEX IF NOT EXISTS "news_articles_source_fetched_idx" ON "news_articles" ("source_id", "fetched_at");

CREATE TABLE IF NOT EXISTS "news_ingest_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL REFERENCES "news_sources"("id") ON DELETE CASCADE,
  "task_run_id" uuid,
  "fetched_count" integer DEFAULT 0 NOT NULL,
  "new_count" integer DEFAULT 0 NOT NULL,
  "skipped_dup" integer DEFAULT 0 NOT NULL,
  "skipped_low_relevance" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "news_ingest_logs_source_created_idx" ON "news_ingest_logs" ("source_id", "created_at");
