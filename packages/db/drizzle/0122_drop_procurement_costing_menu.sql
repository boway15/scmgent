-- 产品成本核算暂不交付；保留 costing_* 表与历史数据，恢复时重新 seed 菜单并挂载路由即可
DELETE FROM role_menus
WHERE menu_id IN (SELECT id FROM menus WHERE code = 'procurement.costing');

DELETE FROM menus WHERE code = 'procurement.costing';
