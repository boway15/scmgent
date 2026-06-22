-- 商品主数据菜单（已有环境增量）

INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.products', '商品主数据', '/data/products', p."id", 1, true
FROM "menus" p
WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;

UPDATE "menus" SET "sort_order" = 2 WHERE "code" = 'data.import';

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" = 'data.products'
  AND r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
