-- SAP 镜像同步管理页；admin / pmc_planner 可访问。
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT 'SAP 镜像同步', 'data.sap_mirror', NULL, '/data/sap-mirror',
       (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 4, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.sap_mirror');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'pmc_planner')
  AND m.code = 'data.sap_mirror'
  AND NOT EXISTS (
    SELECT 1
    FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
