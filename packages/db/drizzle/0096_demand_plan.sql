CREATE TYPE "demand_plan_version_status" AS ENUM ('draft', 'pilot_published', 'archived');

CREATE TABLE IF NOT EXISTS "demand_plan_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_no" varchar(50) NOT NULL UNIQUE,
  "version_name" varchar(200) NOT NULL,
  "status" "demand_plan_version_status" NOT NULL DEFAULT 'draft',
  "start_month" varchar(7) NOT NULL,
  "horizon_months" integer NOT NULL DEFAULT 12,
  "project_group" varchar(20) NOT NULL,
  "warehouse_code" varchar(50) NOT NULL,
  "published_at" timestamptz,
  "created_by" uuid,
  "published_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "demand_plan_versions_status_idx"
  ON "demand_plan_versions" ("status", "project_group", "warehouse_code");

CREATE TABLE IF NOT EXISTS "demand_plan_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "demand_plan_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "warehouse_code" varchar(50) NOT NULL,
  "period" varchar(7) NOT NULL,
  "system_daily_avg" numeric(12, 4) NOT NULL,
  "manual_daily_avg" numeric(12, 4),
  "adjust_reason" text,
  "unconstrained_recent_daily" numeric(12, 4),
  "champion_forecast_daily" numeric(12, 4),
  "in_stock_day_ratio" numeric(8, 4),
  "source" varchar(30) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "demand_plan_monthly_unique_idx"
  ON "demand_plan_monthly" ("version_id", "sku_id", "warehouse_code", "period");

CREATE TABLE IF NOT EXISTS "demand_plan_pilot_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "version_id" uuid REFERENCES "demand_plan_versions"("id") ON DELETE SET NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "warehouse_code" varchar(50) NOT NULL,
  "stockout_date_demand" varchar(10),
  "stockout_date_forecast" varchar(10),
  "suggested_qty_demand" numeric(12, 4),
  "suggested_qty_forecast" numeric(12, 4),
  "unconstrained_recent_daily" numeric(12, 4),
  "champion_forecast_daily" numeric(12, 4),
  "in_stock_day_ratio" numeric(8, 4)
);

CREATE INDEX IF NOT EXISTS "demand_plan_pilot_snapshots_captured_idx"
  ON "demand_plan_pilot_snapshots" ("captured_at");

INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '需求计划试点', 'data.demand_plan', NULL, '/data/demand-plan',
       (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 25, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.demand_plan');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner')
  AND m.code = 'data.demand_plan'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
