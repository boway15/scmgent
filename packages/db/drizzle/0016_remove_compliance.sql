-- 移除合规管理模块（菜单 + sku_compliance 表）

DELETE FROM "role_menus" WHERE "menu_id" IN (
  SELECT "id" FROM "menus" WHERE "code" IN ('compliance', 'compliance.overview', 'compliance.skus')
);
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" IN ('compliance.overview', 'compliance.skus');
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" = 'compliance';
--> statement-breakpoint
DROP TABLE IF EXISTS "sku_compliance";
