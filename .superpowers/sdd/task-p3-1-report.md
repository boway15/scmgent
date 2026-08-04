# Task P3-1 Report: Z 值纯函数 + 单测

## Done
- `safety-stock-z.ts`: `zFromServiceLevel`, `calcSafetyStockQty`（三种 method）
- Z 表：0.90→1.28，0.95→1.65，0.975→1.96，0.99→2.33；未知值取最近档
- 公式：`coverage_days` / `z_demand` / `z_demand_leadtime` 均 `Math.ceil`
- 8 项单测全绿（`tsx --test server/lib/safety-stock-z.test.ts`）

## Commit
`feat: add optional Z-value safety stock calculator`

## Scope
纯 lib，未改 Feishu / schema / API。

## Next
Task 2：`safety_stock_config` 扩展 method 字段。
