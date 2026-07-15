CREATE TABLE IF NOT EXISTS "sales_history_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "channel" varchar(100) NOT NULL DEFAULT 'UNKNOWN',
  "sale_year" integer NOT NULL,
  "month" integer NOT NULL,
  "qty_sold" integer NOT NULL,
  "source" "data_source" NOT NULL DEFAULT 'import',
  "import_batch_id" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_history_monthly_sku_channel_month_unique_idx"
  ON "sales_history_monthly" ("sku_id", "channel", "sale_year", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_history_monthly_sku_year_month_idx"
  ON "sales_history_monthly" ("sku_id", "sale_year", "month");
