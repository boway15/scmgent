ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_alerts_sku_warehouse_idx" ON "stock_alerts" ("sku_id", "warehouse_code");
