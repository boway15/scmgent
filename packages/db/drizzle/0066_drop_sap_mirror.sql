-- 移除 SAP 镜像同步模块（菜单 + 表）
DELETE FROM role_menus
WHERE menu_id IN (SELECT id FROM menus WHERE code = 'data.sap_mirror');

DELETE FROM menus WHERE code = 'data.sap_mirror';

DROP TABLE IF EXISTS "sap_po_mirror_lines";
DROP TABLE IF EXISTS "sap_po_mirrors";
DROP TABLE IF EXISTS "sap_sync_runs";
