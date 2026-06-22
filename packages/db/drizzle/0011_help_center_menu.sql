-- 帮助中心菜单（全角色可见）

INSERT INTO "menus" ("code", "name", "icon", "path", "sort_order", "is_leaf")
VALUES ('help', '帮助中心', 'HelpCircle', '/help', 98, true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "icon" = EXCLUDED."icon",
  "path" = EXCLUDED."path",
  "sort_order" = EXCLUDED."sort_order",
  "is_leaf" = EXCLUDED."is_leaf";
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" = 'help'
  AND r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
