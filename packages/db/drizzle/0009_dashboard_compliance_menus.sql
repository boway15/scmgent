-- 经营看板、合规管理、销量历史、采购跟单菜单（已有环境增量）

INSERT INTO "menus" ("code", "name", "icon", "path", "sort_order", "is_leaf")
VALUES ('dashboard', '经营看板', 'LayoutDashboard', '/dashboard', 0, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "icon", "sort_order", "is_leaf")
VALUES ('compliance', '合规管理', 'Shield', 3, false)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'compliance.overview', '合规总览', '/compliance/overview', p."id", 1, true
FROM "menus" p WHERE p."code" = 'compliance'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'compliance.skus', 'SKU 合规', '/compliance/skus', p."id", 2, true
FROM "menus" p WHERE p."code" = 'compliance'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.sales', '销量历史', '/data/sales', p."id", 3, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'pmc.tracking', '采购跟单', '/pmc/tracking', p."id", 3, true
FROM "menus" p WHERE p."code" = 'pmc'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- 为各角色授权新菜单（幂等）
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'super_admin'
  AND m."code" IN ('dashboard', 'compliance', 'compliance.overview', 'compliance.skus', 'data.sales', 'pmc.tracking')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'pmc_planner'
  AND m."code" IN ('dashboard', 'compliance', 'compliance.overview', 'compliance.skus', 'data.sales')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('warehouse', 'purchaser', 'viewer')
  AND m."code" IN ('dashboard', 'compliance', 'compliance.overview', 'compliance.skus', 'data.sales')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'purchaser'
  AND m."code" = 'pmc.tracking'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'viewer'
  AND m."code" IN ('pmc.tracking', 'pmc.suggestion')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
-- 合并「菜单配置」到「角色与菜单」，移除重复入口
DELETE FROM "role_menus" WHERE "menu_id" IN (SELECT "id" FROM "menus" WHERE "code" = 'system.menus');
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" = 'system.menus';
--> statement-breakpoint
UPDATE "menus" SET "name" = '角色与菜单' WHERE "code" = 'system.roles';
