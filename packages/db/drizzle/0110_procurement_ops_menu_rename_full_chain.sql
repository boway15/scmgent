-- 采购运营菜单显示名改为「全链库存」（code / 路由不变）
UPDATE menus
SET name = '全链库存'
WHERE code = 'inventory.procurement_ops';
