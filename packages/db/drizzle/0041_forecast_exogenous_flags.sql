-- 外生冲击标记：广告/调价等，准确率统计时剔除
DO $$ BEGIN
  ALTER TYPE "forecast_review_issue_type" ADD VALUE IF NOT EXISTS 'exogenous_shock';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_exogenous_reason" AS ENUM (
    'ad',
    'price_change',
    'promo',
    'listing_change',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecast_exogenous_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL DEFAULT 'US',
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "flag_year" integer,
  "flag_month" integer,
  "reason" "forecast_exogenous_reason" NOT NULL DEFAULT 'other',
  "note" text,
  "exclude_from_kpi" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_exogenous_flags_sku_station_idx"
  ON "forecast_exogenous_flags" ("sku_id", "station", "platform");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_exogenous_flags_unique_idx"
  ON "forecast_exogenous_flags" ("sku_id", "station", "platform", "flag_year", "flag_month", "reason");
