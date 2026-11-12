-- 销售区域 / 履约区域映射，以及预测叶子、补货、PMC 的区域列
CREATE TABLE IF NOT EXISTS "station_sales_region_maps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "station" varchar(100) NOT NULL,
  "sales_region" varchar(20) NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "station_sales_region_maps_station_uidx"
  ON "station_sales_region_maps" ("station");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_fulfillment_region_maps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "warehouse_code" varchar(100) NOT NULL,
  "fulfillment_region" varchar(20) NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_fulfillment_region_maps_wh_uidx"
  ON "warehouse_fulfillment_region_maps" ("warehouse_code");
--> statement-breakpoint
ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "sales_region" varchar(20) NOT NULL DEFAULT 'ALL';
--> statement-breakpoint
DROP INDEX IF EXISTS "sales_forecast_monthly_version_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_version_unique_idx"
  ON "sales_forecast_monthly" ("sku_id", "sales_region", "platform", "forecast_year", "month", "version_id");
--> statement-breakpoint
ALTER TABLE "forecast_accuracy_monthly"
  ADD COLUMN IF NOT EXISTS "sales_region" varchar(20) NOT NULL DEFAULT 'ALL';
--> statement-breakpoint
DROP INDEX IF EXISTS "forecast_accuracy_monthly_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_accuracy_monthly_unique_idx"
  ON "forecast_accuracy_monthly" ("sku_id", "sales_region", "platform", "forecast_year", "month", "version_id");
--> statement-breakpoint
ALTER TABLE "sales_forecast_review_items"
  ADD COLUMN IF NOT EXISTS "sales_region" varchar(20) NOT NULL DEFAULT 'ALL';
--> statement-breakpoint
DROP INDEX IF EXISTS "sales_forecast_review_items_identity_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_review_items_identity_unique_idx"
  ON "sales_forecast_review_items" ("version_id", "sku_id", "sales_region", "platform", "issue_type");
--> statement-breakpoint
ALTER TABLE "reorder_suggestions"
  ADD COLUMN IF NOT EXISTS "fulfillment_region" varchar(20),
  ADD COLUMN IF NOT EXISTS "platform" varchar(50);
--> statement-breakpoint
ALTER TABLE "stock_alerts"
  ADD COLUMN IF NOT EXISTS "fulfillment_region" varchar(20),
  ADD COLUMN IF NOT EXISTS "platform" varchar(50);
--> statement-breakpoint
ALTER TABLE "pmc_plan_items"
  ADD COLUMN IF NOT EXISTS "fulfillment_region" varchar(20);
--> statement-breakpoint
ALTER TYPE "inventory_data_issue_type" ADD VALUE IF NOT EXISTS 'unmapped_station';
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.region_mapping', '区域映射', '/data/region-mapping', p."id", 45, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m."code" = 'data.region_mapping'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
