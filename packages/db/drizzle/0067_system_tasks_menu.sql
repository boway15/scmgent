-- 定时任务页菜单（仅 super_admin，与操作日志同级）
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '定时任务', 'system.tasks', NULL, '/system/tasks',
       (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 4, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.tasks');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code = 'super_admin'
  AND m.code = 'system.tasks'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
