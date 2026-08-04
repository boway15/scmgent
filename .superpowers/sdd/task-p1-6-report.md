# P1 Task 6 实施报告

- `purchase_drafts` 新增 7 个可空里程碑日期字段与可选 `transport_mode`。
- 新增迁移 `0055_purchase_draft_milestones.sql`，journal 补齐 0054、0055。
- PMC 跟单 GET/PATCH 已返回并更新全部里程碑字段，支持清空可空字段。
- `/pmc/tracking` 新增折叠里程碑编辑区，覆盖 ETD、到港、到仓、预计可售日。
- 预计可售日仍为列表主展示与交期确认主字段。
- 未修改飞书采购跟进及库存列表的列定义。
- 测试：里程碑/ETA 定向测试 4/4 通过；Web production build 通过。
- 静态检查：任务文件 IDE lint、`git diff --check` 通过。
- 已知基线：全量 TypeScript 检查存在大量既有错误；既有 lifecycle 测试缺少 `vitest`。
