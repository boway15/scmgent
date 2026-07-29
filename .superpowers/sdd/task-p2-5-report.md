# P2 Task 5 实施报告

- 新增 `/pmc/shipments` 发运管理页，提供「全部发运 / 延误」Tab。
- 列表展示单号、SKU、数量、状态、柜号、预计可售日与关联跟单。
- 新增侧边里程碑编辑器，支持 7 个节点的计划/实际日期与备注维护。
- `api.ts` 接入发运列表及里程碑 upsert API。
- 路由、seed 与 `0058_shipments_menu.sql` 已加入 `pmc.shipments` 权限。
- 已更新 Drizzle journal；授权角色为 `super_admin`、`pmc_planner`、`purchaser`。
- 验证：发运相关 8 项单测通过，`pnpm --filter @scm/web build` 通过。
- 未修改 InventoryOverviewPage、InventoryQueryPage、ProcurementPages 及其列表列配置。
