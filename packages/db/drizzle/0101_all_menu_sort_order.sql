-- 全站菜单统一排序（步长 10）：顶层按业务链路，子菜单按 监控 → 执行 → 分析 → 配置

-- 顶层
UPDATE menus SET sort_order = 0 WHERE code = 'dashboard';
UPDATE menus SET sort_order = 10 WHERE code = 'inventory';
UPDATE menus SET sort_order = 20 WHERE code = 'supply';
UPDATE menus SET sort_order = 30 WHERE code = 'data';
UPDATE menus SET sort_order = 40 WHERE code = 'assistant';
UPDATE menus SET sort_order = 90 WHERE code = 'help';
UPDATE menus SET sort_order = 100 WHERE code = 'system';

-- 采购发运：待办 → 计划 → 履约 → 采购 → 核算
UPDATE menus SET sort_order = 10 WHERE code = 'pmc.suggestion';
UPDATE menus SET sort_order = 20 WHERE code = 'pmc.list';
UPDATE menus SET sort_order = 30 WHERE code = 'pmc.tracking';
UPDATE menus SET sort_order = 40 WHERE code = 'pmc.shipments';
UPDATE menus SET sort_order = 50 WHERE code = 'procurement.bulk_stock';
UPDATE menus SET sort_order = 60 WHERE code = 'procurement.follow_up';
UPDATE menus SET sort_order = 70 WHERE code = 'procurement.costing';
UPDATE menus SET sort_order = 80 WHERE code = 'logistics.fob_settlement';

-- 数据分析：看板 → 主数据 → 历史 → 预测
UPDATE menus SET sort_order = 10 WHERE code = 'data.sales_analytics';
UPDATE menus SET sort_order = 20 WHERE code = 'data.products';
UPDATE menus SET sort_order = 30 WHERE code = 'data.sales';
UPDATE menus SET sort_order = 40 WHERE code = 'data.forecast';
UPDATE menus SET sort_order = 50 WHERE code = 'data.layered_forecast';
UPDATE menus SET sort_order = 60 WHERE code = 'data.demand_plan';

-- 智能助手：通用问答 → 资讯 → 专项工具
UPDATE menus SET sort_order = 10 WHERE code = 'ai.chat';
UPDATE menus SET sort_order = 20 WHERE code = 'intel.news';
UPDATE menus SET sort_order = 30 WHERE code = 'cs.quality';

-- 系统设置：人员 → 权限 → 运维 → 审计
UPDATE menus SET sort_order = 10 WHERE code = 'system.users';
UPDATE menus SET sort_order = 20 WHERE code = 'system.roles';
UPDATE menus SET sort_order = 30 WHERE code = 'system.tasks';
UPDATE menus SET sort_order = 40 WHERE code = 'system.logs';
