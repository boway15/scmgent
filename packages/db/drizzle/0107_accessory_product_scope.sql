ALTER TABLE "sales_forecast_versions"
  ADD COLUMN IF NOT EXISTS "exclude_accessories" boolean NOT NULL DEFAULT true;

ALTER TABLE "sales_analytics_cube_snapshots"
  ADD COLUMN IF NOT EXISTS "payload_accessory" jsonb;
