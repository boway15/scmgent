CREATE TABLE IF NOT EXISTS "inventory_dest_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "source" varchar(40) NOT NULL,
  "source_id" varchar(100) NOT NULL,
  "pool" varchar(20) NOT NULL,
  "warehouse_code" varchar(100) NOT NULL,
  "qty" integer NOT NULL,
  "confirmed_by" uuid,
  "confirmed_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_dest_allocations" ADD CONSTRAINT "inventory_dest_allocations_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_dest_allocations" ADD CONSTRAINT "inventory_dest_allocations_confirmed_by_users_id_fk"
    FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_dest_allocations_source_wh_idx"
  ON "inventory_dest_allocations" ("source", "source_id", "pool", "warehouse_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_dest_allocations_sku_idx"
  ON "inventory_dest_allocations" ("sku_id");
--> statement-breakpoint
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '未定仓供应', 'inventory.unallocated', NULL, '/inventory/unallocated',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 5, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.unallocated');
--> statement-breakpoint
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser', 'warehouse', 'viewer')
  AND m.code = 'inventory.unallocated'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
