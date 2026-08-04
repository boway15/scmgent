-- 移除达人运营菜单（模块已下线）
DELETE FROM role_menus
WHERE menu_id IN (SELECT id FROM menus WHERE code LIKE 'creator_ops%');

DELETE FROM menus
WHERE code LIKE 'creator_ops%';
