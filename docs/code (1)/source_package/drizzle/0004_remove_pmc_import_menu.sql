-- PMC 计划导入已合并至「数据中心 → 数据导入」，移除重复的 pmc.import 菜单
DELETE FROM "role_menus"
WHERE "menu_id" IN (SELECT "id" FROM "menus" WHERE "code" = 'pmc.import');
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" = 'pmc.import';
