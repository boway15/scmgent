# Task P3-2 Report: safety_stock_config 扩展

## Done
- 迁移 `0059_safety_stock_method.sql`：enum `safety_stock_method` + 三列 σ 参数
- `safety_stock_config` 新增：`safety_stock_method`（默认 `coverage_days`）、`demand_std_dev`、`lead_time_std_dev`
- `service_level` 精度 `(4,2)` → `(4,3)`；schema 同步 `safetyStockMethodEnum`
- journal idx 54 已登记

## Commit
`61f2dc4` — `feat(db): add safety stock method fields for Z-value option`

## Scope
仅 schema/migration，未改 Feishu / API / UI。

## Next
Task 3：安全库存 API/页接入可选 Z 值方法。
