-- 区域映射菜单统一到系统设置（兼容 data.region_mapping / system.region_mapping 双码）
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '区域映射', 'system.region_mapping', 'Settings', '/system/region-mapping',
       (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 45, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.region_mapping');
--> statement-breakpoint
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.code = 'system.region_mapping'
WHERE r.code IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
--> statement-breakpoint
INSERT INTO role_menus (role_id, menu_id)
SELECT rm.role_id, sys_m.id
FROM role_menus rm
JOIN menus data_m ON data_m.id = rm.menu_id AND data_m.code = 'data.region_mapping'
JOIN menus sys_m ON sys_m.code = 'system.region_mapping'
WHERE NOT EXISTS (
  SELECT 1 FROM role_menus x WHERE x.role_id = rm.role_id AND x.menu_id = sys_m.id
);
--> statement-breakpoint
DELETE FROM role_menus
WHERE menu_id IN (SELECT id FROM menus WHERE code = 'data.region_mapping');
--> statement-breakpoint
DELETE FROM menus WHERE code = 'data.region_mapping';
--> statement-breakpoint
DELETE FROM role_menus
WHERE menu_id IN (
  SELECT id FROM menus
  WHERE code IN (
    'data.layered_forecast',
    'data.sap_mirror',
    'compliance',
    'compliance.overview',
    'compliance.skus',
    'data.import',
    'dashboard'
  )
);
--> statement-breakpoint
DELETE FROM menus
WHERE code IN (
  'data.layered_forecast',
  'data.sap_mirror',
  'compliance.overview',
  'compliance.skus',
  'compliance',
  'data.import',
  'dashboard'
);
