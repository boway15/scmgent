CREATE TABLE IF NOT EXISTS "inventory_sales_cube_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_date" date NOT NULL,
  "status" varchar(20) NOT NULL,
  "source_turnover_date" date,
  "source_sales_as_of" date,
  "row_count" integer,
  "meta" jsonb,
  "error_message" text,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_sales_cube_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "sku_id" uuid NOT NULL,
  "sku_code" varchar(64) NOT NULL,
  "warehouse_code" varchar(32) NOT NULL,
  "product_scope" varchar(32) NOT NULL,
  "category" text,
  "lifecycle" varchar(64),
  "sales_country" varchar(64),
  "qty_available" integer DEFAULT 0 NOT NULL,
  "qty_in_transit" integer DEFAULT 0 NOT NULL,
  "effective_qty" integer DEFAULT 0 NOT NULL,
  "share_method" varchar(32) NOT NULL,
  "share_weight" double precision,
  "sales_7d" integer,
  "sales_14d" integer,
  "sales_30d" integer,
  "avg_daily_30d" double precision,
  "cover_days" double precision,
  "sell_through_30d" double precision,
  "primary_risk" varchar(32),
  "risk_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_sales_cube_runs" ADD CONSTRAINT "inventory_sales_cube_runs_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_sales_cube_rows" ADD CONSTRAINT "inventory_sales_cube_rows_run_id_inventory_sales_cube_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."inventory_sales_cube_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_sales_cube_rows" ADD CONSTRAINT "inventory_sales_cube_rows_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_sales_cube_runs_status_created_idx"
  ON "inventory_sales_cube_runs" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_sales_cube_runs_snapshot_date_idx"
  ON "inventory_sales_cube_runs" ("snapshot_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_sales_cube_rows_run_sku_wh_uidx"
  ON "inventory_sales_cube_rows" ("run_id", "sku_id", "warehouse_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_sales_cube_rows_run_risk_idx"
  ON "inventory_sales_cube_rows" ("run_id", "primary_risk");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_sales_cube_rows_run_wh_idx"
  ON "inventory_sales_cube_rows" ("run_id", "warehouse_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_sales_cube_rows_run_sku_idx"
  ON "inventory_sales_cube_rows" ("run_id", "sku_code");
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.inventory_sales_analytics', '存销分析', '/data/inventory-sales-analytics', p."id", 15, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m."code" = 'data.inventory_sales_analytics'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
