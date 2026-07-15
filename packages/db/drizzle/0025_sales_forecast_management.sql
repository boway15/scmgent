-- 销售预测管理：平台字典、版本、调整元数据、准确率

DO $$ BEGIN
  CREATE TYPE "forecast_version_status" AS ENUM('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "forecast_confidence_level" AS ENUM('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "sales_platforms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "station" varchar(20),
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sales_platform_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alias" varchar(100) NOT NULL UNIQUE,
  "platform_code" varchar(50) NOT NULL REFERENCES "sales_platforms"("code"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sales_forecast_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_no" varchar(50) NOT NULL UNIQUE,
  "version_name" varchar(200) NOT NULL,
  "station" varchar(20),
  "status" "forecast_version_status" NOT NULL DEFAULT 'draft',
  "created_by" uuid REFERENCES "users"("id"),
  "published_by" uuid REFERENCES "users"("id"),
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sales_forecast_versions_status_idx"
  ON "sales_forecast_versions" ("status", "station");

ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "version_id" uuid REFERENCES "sales_forecast_versions"("id");
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "baseline_daily_avg" numeric(12, 4);
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "manual_daily_avg" numeric(12, 4);
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "adjust_reason" varchar(200);
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "confidence_level" "forecast_confidence_level";

DROP INDEX IF EXISTS "sales_forecast_monthly_sku_station_platform_month_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_version_unique_idx"
  ON "sales_forecast_monthly" ("sku_id", "station", "platform", "forecast_year", "month", "version_id");

CREATE TABLE IF NOT EXISTS "forecast_accuracy_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "forecast_year" integer NOT NULL,
  "month" integer NOT NULL,
  "forecast_daily_avg" numeric(12, 4) NOT NULL,
  "actual_daily_avg" numeric(12, 4) NOT NULL,
  "bias_rate" numeric(10, 4),
  "mape" numeric(10, 4),
  "version_id" uuid REFERENCES "sales_forecast_versions"("id"),
  "computed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "forecast_accuracy_monthly_unique_idx"
  ON "forecast_accuracy_monthly" ("sku_id", "station", "platform", "forecast_year", "month", "version_id");

-- 默认平台与初始发布版本
INSERT INTO "sales_platforms" ("code", "name", "station", "sort_order")
VALUES
  ('ALL', '全平台汇总', NULL, 0),
  ('AMAZON', '亚马逊', 'US', 10),
  ('WALMART', '沃尔玛', 'US', 20),
  ('EBAY', 'eBay', 'US', 30),
  ('SHOPIFY', '独立站', NULL, 40),
  ('DTC', '品牌站', NULL, 50),
  ('TIKTOK', 'TikTok Shop', 'US', 60),
  ('TEMU', 'Temu', 'US', 70)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "sales_platform_aliases" ("alias", "platform_code")
VALUES
  ('亚马逊', 'AMAZON'),
  ('AMZ', 'AMAZON'),
  ('沃尔玛', 'WALMART'),
  ('独立站', 'DTC'),
  ('全平台', 'ALL')
ON CONFLICT ("alias") DO NOTHING;

INSERT INTO "sales_forecast_versions" ("id", "version_no", "version_name", "status", "published_at")
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'LEGACY-001',
  '历史导入默认版本',
  'published'::"forecast_version_status",
  now()
WHERE NOT EXISTS (SELECT 1 FROM "sales_forecast_versions" WHERE "version_no" = 'LEGACY-001');

UPDATE "sales_forecast_monthly"
SET "version_id" = '00000000-0000-0000-0000-000000000001'::uuid
WHERE "version_id" IS NULL;
