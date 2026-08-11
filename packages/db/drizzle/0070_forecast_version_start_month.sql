ALTER TABLE "sales_forecast_versions"
  ADD COLUMN IF NOT EXISTS "start_month" varchar(7);
