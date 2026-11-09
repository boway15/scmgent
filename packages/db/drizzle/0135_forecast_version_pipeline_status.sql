ALTER TABLE "sales_forecast_versions"
  ADD COLUMN IF NOT EXISTS "pipeline_status" varchar(20) NOT NULL DEFAULT 'ready';
