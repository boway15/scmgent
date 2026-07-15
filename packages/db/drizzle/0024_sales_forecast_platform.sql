-- 销售预测增加在售平台维度

ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "platform" varchar(50) NOT NULL DEFAULT 'ALL';

DROP INDEX IF EXISTS "sales_forecast_monthly_sku_station_month_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_sku_station_platform_month_idx"
  ON "sales_forecast_monthly" ("sku_id", "station", "platform", "forecast_year", "month");

CREATE INDEX IF NOT EXISTS "sales_forecast_monthly_platform_idx"
  ON "sales_forecast_monthly" ("platform", "station");
