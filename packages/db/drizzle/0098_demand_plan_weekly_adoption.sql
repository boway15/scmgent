ALTER TABLE "demand_plan_versions"
  ADD COLUMN IF NOT EXISTS "start_week" varchar(8),
  ADD COLUMN IF NOT EXISTS "horizon_weeks" integer;

CREATE TABLE IF NOT EXISTS "demand_plan_weekly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "demand_plan_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "warehouse_code" varchar(50) NOT NULL,
  "period" varchar(8) NOT NULL,
  "system_daily_avg" numeric(12, 4) NOT NULL,
  "manual_daily_avg" numeric(12, 4),
  "adjust_reason" text,
  "unconstrained_recent_daily" numeric(12, 4),
  "champion_forecast_daily" numeric(12, 4),
  "source" varchar(30) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "demand_plan_weekly_unique_idx"
  ON "demand_plan_weekly" ("version_id", "sku_id", "warehouse_code", "period");

CREATE TABLE IF NOT EXISTS "planning_demand_adoptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_group" varchar(20) NOT NULL,
  "warehouse_code" varchar(50) NOT NULL,
  "source" varchar(20) NOT NULL,
  "demand_plan_version_id" uuid REFERENCES "demand_plan_versions"("id") ON DELETE SET NULL,
  "adopted_at" timestamptz NOT NULL DEFAULT now(),
  "adopted_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "planning_demand_adoptions_group_wh_unique_idx"
  ON "planning_demand_adoptions" ("project_group", "warehouse_code");
