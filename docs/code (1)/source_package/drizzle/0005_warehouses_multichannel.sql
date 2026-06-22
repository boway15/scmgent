CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL UNIQUE,
  "name" varchar(200) NOT NULL,
  "region_group" varchar(50) NOT NULL,
  "country_code" varchar(10),
  "allow_cross_fulfill" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "channel_warehouse_prefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel" varchar(100) NOT NULL UNIQUE,
  "primary_warehouse_code" varchar(100) NOT NULL,
  "overflow_warehouse_codes" varchar(500),
  "last_mile_cost_index" numeric(6,2) DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "sales_history" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);
CREATE INDEX IF NOT EXISTS "sales_history_sku_warehouse_idx" ON "sales_history" ("sku_id", "warehouse_code");

ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100) DEFAULT 'ALL' NOT NULL;
UPDATE "safety_stock_config" SET "warehouse_code" = 'ALL' WHERE "warehouse_code" IS NULL;
DROP INDEX IF EXISTS "safety_stock_config_sku_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "safety_stock_config_sku_warehouse_idx" ON "safety_stock_config" ("sku_id", "warehouse_code");

ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "target_warehouse_code" varchar(100);
ALTER TABLE "pmc_plan_items" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);

INSERT INTO "warehouses" ("code", "name", "region_group", "country_code", "allow_cross_fulfill", "sort_order")
VALUES
  ('US-WEST', '美西仓', 'US', 'US', true, 1),
  ('US-SOUTH', '美南仓', 'US', 'US', true, 2),
  ('US-SOUTHEAST', '美东南仓', 'US', 'US', true, 3),
  ('US-EAST', '美东仓', 'US', 'US', true, 4),
  ('DE', '德国仓', 'EU', 'DE', false, 5),
  ('UK', '英国仓', 'UK', 'GB', false, 6)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "channel_warehouse_prefs" ("channel", "primary_warehouse_code", "overflow_warehouse_codes", "last_mile_cost_index")
VALUES
  ('amazon', 'US-WEST', 'US-SOUTH,US-SOUTHEAST,US-EAST', 1.15),
  ('wayfair', 'US-EAST', 'US-SOUTHEAST,US-SOUTH,US-WEST', 1.20),
  ('walmart', 'US-SOUTH', 'US-SOUTHEAST,US-EAST,US-WEST', 1.18),
  ('faire', 'US-EAST', 'US-SOUTHEAST,US-WEST,US-SOUTH', 1.25)
ON CONFLICT ("channel") DO NOTHING;
