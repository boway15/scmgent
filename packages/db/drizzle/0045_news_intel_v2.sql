DO $$ BEGIN
  CREATE TYPE "news_source_tier" AS ENUM('tier_1', 'tier_2', 'tier_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "news_bitable_sync_status" AS ENUM('pending', 'synced', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "news_business_validity" AS ENUM('valid', 'invalid', 'misclassified');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "source_tier" "news_source_tier" DEFAULT 'tier_2' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "is_official" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "source_language" varchar(10) DEFAULT 'zh' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "scope_json" jsonb;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "title_zh" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "title_original" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "topic_category" varchar(80);
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "departments" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "platform_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "country_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "business_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "brand_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "source_tier" "news_source_tier";
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "is_official_source" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "filter_hits" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "business_validity" "news_business_validity" DEFAULT 'valid' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "bitable_sync_status" "news_bitable_sync_status" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "bitable_sync_error" text;
--> statement-breakpoint
ALTER TABLE "news_ingest_logs" ADD COLUMN IF NOT EXISTS "skipped_filtered" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_ingest_logs" ADD COLUMN IF NOT EXISTS "translated_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_ingest_logs" ADD COLUMN IF NOT EXISTS "bitable_sync_failed_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "news_articles"
SET "title_zh" = COALESCE("title_zh", "title"),
    "title_original" = COALESCE("title_original", "title")
WHERE "title_zh" IS NULL OR "title_original" IS NULL;
--> statement-breakpoint
UPDATE "news_articles"
SET "bitable_sync_status" = 'synced'
WHERE "bitable_record_id" IS NOT NULL AND "bitable_sync_status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_sources_tier_enabled_idx" ON "news_sources" ("source_tier", "enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_articles_sync_status_idx" ON "news_articles" ("bitable_sync_status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_articles_topic_category_idx" ON "news_articles" ("topic_category");
