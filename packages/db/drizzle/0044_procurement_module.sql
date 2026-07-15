DO $$ BEGIN
  CREATE TYPE "public"."procurement_list_type" AS ENUM('bulk_stock_request', 'purchase_follow_up');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "procurement_list_meta" (
  "list_type" "procurement_list_type" PRIMARY KEY NOT NULL,
  "column_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "last_sync_at" timestamp with time zone,
  "last_sync_source" varchar(20),
  "last_sync_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "procurement_list_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "list_type" "procurement_list_type" NOT NULL,
  "row_index" integer NOT NULL,
  "bitable_record_id" varchar(100),
  "row_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "procurement_list_meta"
    ADD CONSTRAINT "procurement_list_meta_last_sync_by_users_id_fk"
    FOREIGN KEY ("last_sync_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "procurement_list_rows_list_type_idx" ON "procurement_list_rows" ("list_type");
CREATE INDEX IF NOT EXISTS "procurement_list_rows_list_type_row_index_idx" ON "procurement_list_rows" ("list_type", "row_index");

INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '采购管理', 'procurement', 'ShoppingCart', NULL, NULL, 3, false
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement');

INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '大件备货申请', 'procurement.bulk_stock', NULL, '/procurement/bulk-stock',
  (SELECT id FROM "menus" WHERE code = 'procurement' LIMIT 1), 1, true
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement.bulk_stock');

INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '采购跟单', 'procurement.follow_up', NULL, '/procurement/follow-up',
  (SELECT id FROM "menus" WHERE code = 'procurement' LIMIT 1), 2, true
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement.follow_up');

UPDATE "menus" SET "sort_order" = 4 WHERE "code" = 'cs';
UPDATE "menus" SET "sort_order" = 5 WHERE "code" = 'logistics';
UPDATE "menus" SET "sort_order" = 6 WHERE "code" = 'ai';
UPDATE "menus" SET "sort_order" = 7 WHERE "code" = 'data';

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'super_admin' AND m.code IN ('procurement', 'procurement.bulk_stock', 'procurement.follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'purchaser' AND m.code IN ('procurement', 'procurement.bulk_stock', 'procurement.follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'pmc_planner' AND m.code IN ('procurement', 'procurement.bulk_stock')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'viewer' AND m.code IN ('procurement', 'procurement.bulk_stock', 'procurement.follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
