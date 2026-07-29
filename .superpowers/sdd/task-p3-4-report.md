# P3 Task 4 Report

- 审计 6 表：`shipments`、`lead_time_profiles` 已有 `source_system`/`external_id`，跳过。
- 新增 `0060_external_ids.sql`：`skus`、`merchants`、`purchase_drafts`、`pmc_plans` 各补 `source_system varchar(50)`、`external_id varchar(100)`。
- `pmc_plan_items` 补 `external_line_id varchar(100)`（行级外部标识）。
- Drizzle schema 同步：`inventory.ts`、`products.ts`、`procurement.ts`、`pmc.ts`。
- 未改 Feishu UI 或业务逻辑。
- Commit: `feat(db): add source_system and external_id placeholders`
