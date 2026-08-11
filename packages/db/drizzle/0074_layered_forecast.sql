DO $$ BEGIN
  CREATE TYPE "layered_forecast_version_status" AS ENUM('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "layered_forecast_level" AS ENUM('project_group', 'category', 'platform', 'sku');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "layered_forecast_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_no" varchar(50) NOT NULL UNIQUE,
  "version_name" varchar(200) NOT NULL,
  "status" "layered_forecast_version_status" NOT NULL DEFAULT 'draft',
  "start_month" varchar(7) NOT NULL,
  "horizon_months" integer NOT NULL DEFAULT 12,
  "station" varchar(20) NOT NULL DEFAULT 'ALL',
  "algo_meta" jsonb,
  "created_by" uuid REFERENCES "users"("id"),
  "published_by" uuid REFERENCES "users"("id"),
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layered_forecast_versions_status_idx"
  ON "layered_forecast_versions" ("status", "station");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "layered_forecast_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "layered_forecast_versions"("id") ON DELETE CASCADE,
  "level" "layered_forecast_level" NOT NULL,
  "project_group" varchar(200) NOT NULL,
  "category" varchar(200) NOT NULL,
  "platform" varchar(50) NOT NULL,
  "sku_id" uuid REFERENCES "skus"("id") ON DELETE CASCADE,
  "period" varchar(7) NOT NULL,
  "qty" numeric(14, 4) NOT NULL,
  "system_qty" numeric(14, 4) NOT NULL,
  "draft_qty" numeric(14, 4),
  "locked" boolean NOT NULL DEFAULT false,
  "seasonality_factor" numeric(10, 4),
  "trend_factor" numeric(10, 4),
  "peak_month" integer,
  "manual_edited" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layered_forecast_nodes_version_idx"
  ON "layered_forecast_nodes" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layered_forecast_nodes_version_level_idx"
  ON "layered_forecast_nodes" ("version_id", "level", "project_group", "category", "platform");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "layered_forecast_nodes_upper_unique_idx"
  ON "layered_forecast_nodes" ("version_id", "level", "project_group", "category", "platform", "period")
  WHERE "sku_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "layered_forecast_nodes_sku_unique_idx"
  ON "layered_forecast_nodes" ("version_id", "level", "project_group", "category", "platform", "sku_id", "period")
  WHERE "sku_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.layered_forecast', '分层销量预测', '/data/layered-forecast', p."id", 5, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m."code" = 'data.layered_forecast'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
