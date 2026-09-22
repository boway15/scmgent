-- 三池供给批次 + 预警 horizon 字段
DO $$ BEGIN
  CREATE TYPE "supply_lot_pool" AS ENUM ('overseas', 'in_transit', 'local');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "supply_lot_production_status" AS ENUM ('in_production', 'qc_pending', 'completed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "supply_lot_source" AS ENUM ('snapshot', 'purchase_draft', 'shipment', 'manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "supply_lot_status" AS ENUM ('open', 'consumed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_supply_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "warehouse_code" varchar(100) NOT NULL,
  "pool" "supply_lot_pool" NOT NULL,
  "qty" integer NOT NULL,
  "factory_code" varchar(100),
  "production_status" "supply_lot_production_status",
  "ship_ready_at" date,
  "latest_ship_date" date,
  "available_at" date,
  "source" "supply_lot_source" NOT NULL,
  "source_id" varchar(100),
  "status" "supply_lot_status" DEFAULT 'open' NOT NULL,
  "eta_estimated" boolean DEFAULT false NOT NULL,
  "date_unknown" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_supply_lots" ADD CONSTRAINT "inventory_supply_lots_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_supply_lots_sku_wh_pool_idx"
  ON "inventory_supply_lots" ("sku_id", "warehouse_code", "pool", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_supply_lots_available_at_idx"
  ON "inventory_supply_lots" ("available_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_supply_lots_source_unique_idx"
  ON "inventory_supply_lots" ("source", "source_id", "pool", "warehouse_code");
--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "horizon_days" integer;
--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "projected_qty" integer;
--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "projected_stockout_date" date;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'stockout_horizon';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'coverage_short';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'overstock';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- 三池总览菜单
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '库存三池', 'inventory.pools', NULL, '/inventory/pools',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 3, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.pools');
--> statement-breakpoint
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser', 'viewer')
  AND m.code = 'inventory.pools'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
