-- 库存规划驾驶舱菜单；沿用 PMC 规划与采购角色范围。
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '规划驾驶舱', 'inventory.planning_dashboard', NULL, '/inventory/planning-dashboard',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 6, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.planning_dashboard');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser')
  AND m.code = 'inventory.planning_dashboard'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
