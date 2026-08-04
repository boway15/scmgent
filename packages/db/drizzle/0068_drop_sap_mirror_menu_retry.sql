-- 幂等清理 SAP 镜像菜单（0064 可能已执行但 0066 未执行，或名称编码异常）
DELETE FROM role_menus
WHERE menu_id IN (SELECT id FROM menus WHERE code = 'data.sap_mirror');

DELETE FROM menus WHERE code = 'data.sap_mirror';
