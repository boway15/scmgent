# P1 Task 5 Report

- 新增 `buildLeadTimeMetrics`，将 resolver 六段交期 + `leadTimeProfileId` 写入 health/suggestion metrics。
- `computeSkuWarehouseHealth` 使用 `resolveLeadTimeForSkuWarehouse` 原始 breakdown，不再从 coverage 取片段字段。
- `calcCoverageReplenishmentFromForecast` 仍传入 `productionDays` / `shippingDays` / `inboundBufferDays`（compat 口径不变）。
- `replenishmentForecast` 已 spread `health.metrics`，补货建议自动携带新字段，无需改动。
- 未修改飞书同步列表 UI/mapper（bulk-stock、follow-up、overview、query）。
- 验证：`inventory-health-service.test.ts` 通过。
