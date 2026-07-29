-- PMC 发运管理入口及可维护里程碑的角色权限。
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '发运管理', 'pmc.shipments', NULL, '/pmc/shipments',
       (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 4, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.shipments');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser')
  AND m.code = 'pmc.shipments'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
