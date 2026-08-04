ALTER TYPE "news_source_type" ADD VALUE IF NOT EXISTS 'query_feed';
--> statement-breakpoint
ALTER TYPE "news_source_type" ADD VALUE IF NOT EXISTS 'sitemap';
--> statement-breakpoint
ALTER TYPE "news_source_type" ADD VALUE IF NOT EXISTS 'web_page';
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "discovery_channel" varchar(30);
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "discovery_query" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "source_domain" varchar(255);
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "aggregator_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
