-- 需求计划菜单改名：试点 → 周计划
UPDATE menus SET name = '需求计划-周' WHERE code = 'data.demand_plan';
