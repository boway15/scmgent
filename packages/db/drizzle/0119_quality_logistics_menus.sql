-- 质检（一级）/ 二次验货（二级）；物流（一级）下挂 FOB 分账
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '质检', 'quality', 'ClipboardCheck', NULL, NULL, 24, false
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'quality');

INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '二次验货', 'quality.reinspection', NULL, '/quality/reinspection',
       (SELECT id FROM menus WHERE code = 'quality' LIMIT 1), 10, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'quality.reinspection');

INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '物流', 'logistics', 'Ship', NULL, NULL, 26, false
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'logistics');

UPDATE menus
SET name = '物流',
    icon = 'Ship',
    path = NULL,
    parent_id = NULL,
    sort_order = 26,
    is_leaf = false
WHERE code = 'logistics';

UPDATE menus
SET name = 'FOB 分账',
    icon = 'Receipt',
    path = '/logistics/fob-settlement',
    parent_id = (SELECT id FROM menus WHERE code = 'logistics' LIMIT 1),
    sort_order = 10,
    is_leaf = true
WHERE code = 'logistics.fob_settlement';

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.code IN ('quality', 'quality.reinspection')
WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser', 'viewer')
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.code = 'logistics'
WHERE r.code IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
