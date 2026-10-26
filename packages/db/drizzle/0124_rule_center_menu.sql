INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '规则中心', 'system.rules', 'Settings', '/system/rules',
       (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 5, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.rules');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.code IN ('system', 'system.rules')
WHERE r.code IN ('super_admin', 'pmc_planner', 'viewer')
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
