ALTER TABLE "demand_plan_versions"
  ADD COLUMN IF NOT EXISTS "champion_forecast_version_id" uuid
    REFERENCES "sales_forecast_versions"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "generation_meta" jsonb;

ALTER TABLE "demand_plan_weekly"
  ADD COLUMN IF NOT EXISTS "blend_meta" jsonb;
