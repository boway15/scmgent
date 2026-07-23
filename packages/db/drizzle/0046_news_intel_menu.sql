-- 跨境资讯管理菜单（仅 super_admin）

INSERT INTO "menus" ("code", "name", "icon", "sort_order", "is_leaf")
VALUES ('intel', '跨境资讯', 'Newspaper', 8, false)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'intel.news', '资讯采集', '/intel/news', p."id", 1, true
FROM "menus" p WHERE p."code" = 'intel'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'super_admin'
  AND m."code" IN ('intel', 'intel.news')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
