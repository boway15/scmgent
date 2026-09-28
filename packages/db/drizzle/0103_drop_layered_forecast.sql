-- 移除未接入主链路的「分层销量预测」模块
DELETE FROM role_menus
WHERE menu_id IN (SELECT id FROM menus WHERE code = 'data.layered_forecast');

DELETE FROM menus WHERE code = 'data.layered_forecast';

DROP TABLE IF EXISTS "layered_forecast_nodes";
DROP TABLE IF EXISTS "layered_forecast_versions";

DROP TYPE IF EXISTS "layered_forecast_level";
DROP TYPE IF EXISTS "layered_forecast_version_status";
