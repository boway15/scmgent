-- 库存数据异常队列（与健康异常单分表）
DO $$ BEGIN
  CREATE TYPE "inventory_data_issue_type" AS ENUM (
    'missing_available_at',
    'unallocated_warehouse',
    'share_sum_mismatch'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "inventory_data_issue_status" AS ENUM (
    'open',
    'in_progress',
    'resolved',
    'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_data_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fingerprint" varchar(320) NOT NULL,
  "sku_id" uuid NOT NULL,
  "warehouse_code" varchar(100) NOT NULL,
  "issue_type" "inventory_data_issue_type" NOT NULL,
  "impact_module" varchar(40) NOT NULL,
  "example" text NOT NULL,
  "qty" integer DEFAULT 0 NOT NULL,
  "details" jsonb,
  "status" "inventory_data_issue_status" DEFAULT 'open' NOT NULL,
  "owner_id" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamptz,
  "resolution_note" text,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_data_issues" ADD CONSTRAINT "inventory_data_issues_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_data_issues" ADD CONSTRAINT "inventory_data_issues_owner_id_users_id_fk"
    FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_data_issues" ADD CONSTRAINT "inventory_data_issues_resolved_by_users_id_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_data_issues_status_idx"
  ON "inventory_data_issues" ("status", "issue_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_data_issues_sku_type_idx"
  ON "inventory_data_issues" ("sku_id", "issue_type", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_data_issues_fp_idx"
  ON "inventory_data_issues" ("fingerprint");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_data_issues_open_fp_idx"
  ON "inventory_data_issues" ("fingerprint")
  WHERE "status" IN ('open', 'in_progress');
--> statement-breakpoint
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '数据问题', 'inventory.data_issues', NULL, '/inventory/data-issues',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 4, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.data_issues');
--> statement-breakpoint
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser', 'warehouse', 'viewer')
  AND m.code = 'inventory.data_issues'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
