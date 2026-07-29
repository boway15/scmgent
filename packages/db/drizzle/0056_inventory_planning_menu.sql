-- 单 SKU 库存规划入口；详情页通过 /inventory/planning/:skuId 访问。
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT 'SKU 库存规划', 'inventory.planning', NULL, '/inventory/planning',
       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 4, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.planning');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'super_admin'
  AND m.code = 'inventory.planning'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
