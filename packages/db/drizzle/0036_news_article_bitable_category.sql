ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "bitable_category" varchar(50);
CREATE INDEX IF NOT EXISTS "news_articles_bitable_category_idx" ON "news_articles" ("bitable_category");
