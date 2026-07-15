ALTER TYPE "forecast_review_issue_type" ADD VALUE IF NOT EXISTS 'precision_review';

ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "forecast_profile_class" varchar(1),
  ADD COLUMN IF NOT EXISTS "profile_segment" varchar(20),
  ADD COLUMN IF NOT EXISTS "horizon_band" varchar(20),
  ADD COLUMN IF NOT EXISTS "continuity_12m" numeric(8, 4),
  ADD COLUMN IF NOT EXISTS "cv_12m" numeric(8, 4),
  ADD COLUMN IF NOT EXISTS "forecast_daily_p10" numeric(12, 4),
  ADD COLUMN IF NOT EXISTS "forecast_daily_p90" numeric(12, 4),
  ADD COLUMN IF NOT EXISTS "forecast_model" varchar(50);

CREATE TABLE IF NOT EXISTS "forecast_promo_calendar" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "promo_year" integer NOT NULL,
  "promo_month" integer NOT NULL,
  "intensity" numeric(6, 4) NOT NULL DEFAULT 1,
  "label" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "forecast_promo_calendar_unique_idx"
  ON "forecast_promo_calendar" ("station", "platform", "promo_year", "promo_month");
