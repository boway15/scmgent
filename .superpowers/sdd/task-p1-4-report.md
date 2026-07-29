# P1 Task 4 Report

- 新增 `GET/POST/DELETE /api/lead-time-profiles`，统一使用 `requireMenu('inventory.lead_time')`。
- POST 以可选 `id` 执行新增/更新，并校验仓库、运输方式及非负整数天数。
- API 已挂载到 Hono；前端 `api.ts` 增加 Profile 类型及 list/upsert/delete client。
- 新增 `/inventory/lead-time` 管理页，支持筛选、新建、编辑、删除及六段交期维护。
- 新增 `0054_lead_time_menu.sql`，并同步 seed；授权 `super_admin/pmc_planner/purchaser`。
- 未修改飞书同步页面列、列表结构或 mapper。
- 验证：lead-time 相关 9 项测试通过；Vite production build 通过。
- `tsc -p tsconfig.node.json` 仍因仓库既有错误退出；本任务新增文件无 TypeScript 诊断。
