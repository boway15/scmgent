# P3 Task 5 Report

- 新增 `planning-dashboard.ts`，聚合活跃 SKU、最新健康灯、ROP 预警和待处理建议。
- 复用 `calcMilestoneDelayDays` 统计在途发运延误，并按 `eta_available < today` 统计未完成采购草稿。
- 最新健康快照按 SKU + 仓库去重，且仅计入启用 SKU。
- 输出 `stockoutRateApprox` 与确定性的 `calculatedAt`。
- 未改动飞书列表或其他 UI。
- 测试：规划驾驶舱与 shipment-delay 共 8 项通过。
- 类型检查：新增文件无 TypeScript 错误；仓库现存其他类型错误仍导致全量检查失败。
