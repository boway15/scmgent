CREATE TABLE IF NOT EXISTS "sales_forecast_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "forecast_year" integer NOT NULL,
  "month" integer NOT NULL,
  "forecast_daily_avg" numeric(12, 4) NOT NULL,
  "lifecycle" varchar(50),
  "owner_name" varchar(100),
  "source" "data_source" DEFAULT 'import' NOT NULL,
  "import_batch_id" uuid,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_sku_station_month_idx"
  ON "sales_forecast_monthly" ("sku_id", "station", "forecast_year", "month");

CREATE INDEX IF NOT EXISTS "sales_forecast_monthly_sku_station_idx"
  ON "sales_forecast_monthly" ("sku_id", "station");
