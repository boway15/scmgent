-- SKU 库存规划：与规划驾驶舱同角色范围，避免详情页被权限拦截
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('pmc_planner', 'purchaser', 'viewer')
  AND m.code = 'inventory.planning'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
