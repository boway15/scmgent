CREATE TABLE IF NOT EXISTS "sales_forecast_seasonal_index" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "as_of_month" varchar(7) NOT NULL,
  "dimension_level" varchar(32) NOT NULL,
  "dimension_value" varchar(400) NOT NULL,
  "station" varchar(20) NOT NULL,
  "month" integer NOT NULL,
  "index_value" numeric(10, 4) NOT NULL,
  "sample_qty" numeric(14, 2) DEFAULT 0 NOT NULL,
  "method" varchar(40) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_seasonal_index_unique_idx"
  ON "sales_forecast_seasonal_index" ("as_of_month", "dimension_level", "dimension_value", "station", "month");

CREATE INDEX IF NOT EXISTS "sales_forecast_seasonal_index_as_of_idx"
  ON "sales_forecast_seasonal_index" ("as_of_month", "station");
