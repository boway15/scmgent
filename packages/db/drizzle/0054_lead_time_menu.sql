-- 交期 Profile 管理菜单；沿用安全库存配置的角色范围。
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '交期配置', 'inventory.lead_time', NULL, '/inventory/lead-time',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 5, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.lead_time');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser')
  AND m.code = 'inventory.lead_time'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
