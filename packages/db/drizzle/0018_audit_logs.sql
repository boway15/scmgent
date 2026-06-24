CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "user_name" varchar(100),
  "user_email" varchar(200),
  "action" varchar(100) NOT NULL,
  "resource_type" varchar(50),
  "resource_id" varchar(100),
  "detail" text,
  "ip_address" varchar(64),
  "user_agent" varchar(500),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");

INSERT INTO "menus" ("code", "name", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'system.logs', '操作日志', 'ScrollText', '/system/logs', p."id", 3, true
FROM "menus" p
WHERE p."code" = 'system'
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" = 'system.logs'
  AND r."code" = 'super_admin'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
