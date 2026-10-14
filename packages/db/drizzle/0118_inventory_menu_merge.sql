-- 库存运营菜单合并：被并入的菜单先把角色授权迁到保留菜单，再删除
--   库存查询（inventory.overview）← 库存查询旧页 inventory.query、全链库存 inventory.procurement_ops
--   供给池（inventory.pools）← 未定仓供应 inventory.unallocated
--   规划参数（inventory.safety）← 交期配置 inventory.lead_time
--   规划驾驶舱（inventory.planning_dashboard）← SKU 库存规划入口 inventory.planning

INSERT INTO role_menus (role_id, menu_id)
SELECT DISTINCT rm.role_id, keep.id
FROM role_menus rm
JOIN menus old ON old.id = rm.menu_id
JOIN menus keep ON keep.code = CASE old.code
  WHEN 'inventory.query' THEN 'inventory.overview'
  WHEN 'inventory.procurement_ops' THEN 'inventory.overview'
  WHEN 'inventory.unallocated' THEN 'inventory.pools'
  WHEN 'inventory.lead_time' THEN 'inventory.safety'
  WHEN 'inventory.planning' THEN 'inventory.planning_dashboard'
END
WHERE old.code IN (
  'inventory.query',
  'inventory.procurement_ops',
  'inventory.unallocated',
  'inventory.lead_time',
  'inventory.planning'
)
ON CONFLICT (role_id, menu_id) DO NOTHING;

DELETE FROM role_menus
WHERE menu_id IN (
  SELECT id FROM menus WHERE code IN (
    'inventory.query',
    'inventory.procurement_ops',
    'inventory.unallocated',
    'inventory.lead_time',
    'inventory.planning'
  )
);

DELETE FROM menus WHERE code IN (
  'inventory.query',
  'inventory.procurement_ops',
  'inventory.unallocated',
  'inventory.lead_time',
  'inventory.planning'
);

UPDATE menus SET name = '库存查询' WHERE code = 'inventory.overview';
UPDATE menus SET name = '供给池' WHERE code = 'inventory.pools';
UPDATE menus SET name = '规划参数' WHERE code = 'inventory.safety';
