CREATE TABLE IF NOT EXISTS "sales_analytics_cube_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(20) NOT NULL,
  "generated_at" timestamptz,
  "meta" jsonb,
  "payload" jsonb,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_analytics_cube_snapshots_status_created_idx"
  ON "sales_analytics_cube_snapshots" ("status", "created_at");
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.sales_analytics', '销售分析看板', '/data/sales-analytics', p."id", 4, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m."code" = 'data.sales_analytics'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
