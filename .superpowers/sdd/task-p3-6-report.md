# P3 Task 6 Report

- 新增 `GET /api/planning/dashboard`，使用 `inventory.planning_dashboard` 菜单权限并复用现有聚合服务。
- 新增 `/inventory/planning-dashboard` 规划驾驶舱，展示 8 个 KPI 卡片与补货、跟单、发运、SKU 规划入口。
- `api.ts` 增加 `PlanningDashboard` 类型及查询方法，路由已挂载到 Hono 与 React Router。
- seed 与 `0061_planning_dashboard_menu.sql` 增加菜单，并授权 super_admin、pmc_planner、purchaser。
- 未修改 overview/query/bulk-stock/follow-up 飞书列表列结构，也未改经营看板。
- 测试：驾驶舱页面与聚合测试共 4 项通过。
- 构建：`pnpm --filter @scm/web build` 通过。
