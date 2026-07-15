DO $$ BEGIN
  CREATE TYPE "forecast_source_batch_status" AS ENUM ('uploaded', 'parsed', 'generated', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_review_issue_type" AS ENUM (
    'high_value',
    'trend_shift',
    'stockout_suspected',
    'category_deviation',
    'low_accuracy',
    'missing_history',
    'platform_mix'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_review_severity" AS ENUM ('critical', 'warning', 'info');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_review_status" AS ENUM ('pending', 'reviewed', 'ignored');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_seasonality_dimension_type" AS ENUM ('category', 'project_group');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_source_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_no" varchar(50) NOT NULL UNIQUE,
  "daily_file_name" varchar(255),
  "monthly_file_name" varchar(255),
  "daily_start_date" date,
  "daily_end_date" date,
  "monthly_start_month" varchar(7),
  "monthly_end_month" varchar(7),
  "sku_count" integer NOT NULL DEFAULT 0,
  "row_count" integer NOT NULL DEFAULT 0,
  "status" "forecast_source_batch_status" NOT NULL DEFAULT 'uploaded',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_review_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "sales_forecast_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "issue_type" "forecast_review_issue_type" NOT NULL,
  "severity" "forecast_review_severity" NOT NULL,
  "message" text NOT NULL,
  "suggested_daily_avg" numeric(12, 4),
  "reviewed_daily_avg" numeric(12, 4),
  "status" "forecast_review_status" NOT NULL DEFAULT 'pending',
  "reviewer_id" uuid REFERENCES "users"("id"),
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_forecast_review_items_version_status_idx"
  ON "sales_forecast_review_items" ("version_id", "status", "severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_forecast_review_items_sku_idx"
  ON "sales_forecast_review_items" ("sku_id", "station", "platform");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_review_items_identity_unique_idx"
  ON "sales_forecast_review_items" ("version_id", "sku_id", "station", "platform", "issue_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_seasonality" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dimension_type" "forecast_seasonality_dimension_type" NOT NULL,
  "dimension_value" varchar(200) NOT NULL,
  "month" integer NOT NULL,
  "seasonality_factor" numeric(10, 4) NOT NULL,
  "trend_factor" numeric(10, 4),
  "source_batch_id" uuid REFERENCES "sales_forecast_source_batches"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_seasonality_unique_idx"
  ON "sales_forecast_seasonality" ("dimension_type", "dimension_value", "month");
