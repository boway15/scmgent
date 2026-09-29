-- 采购运营菜单 + 角色授权（与 inventory.query 同角色范围）
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '采购运营', 'inventory.procurement_ops', NULL, '/inventory/procurement-ops',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 65, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.procurement_ops');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id FROM roles r, menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND m.code = 'inventory.procurement_ops'
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
