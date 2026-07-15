ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "horizon_factors" jsonb;
