-- 库存查询菜单 + 角色授权（与 inventory.overview 同角色范围）
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '库存查询', 'inventory.query', NULL, '/inventory/query',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 2, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.query');

UPDATE menus SET sort_order = 3 WHERE code = 'inventory.safety' AND sort_order < 3;
UPDATE menus SET sort_order = 4 WHERE code = 'inventory.alert' AND sort_order < 4;

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id FROM roles r, menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m.code = 'inventory.query'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
