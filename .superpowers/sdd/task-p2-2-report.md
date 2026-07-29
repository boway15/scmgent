# P2 Task 2 实施报告

- historical 回退按 SKU + 仓加载 `inventory_records`，同日取最新记录，窗口覆盖率门槛为 `MIN_AVAILABILITY_COVERAGE = 0.3`。
- 达标时接入 `calcEffectiveDailyDemand`，以有货日销量计算日均需求；不足时保持日历日均回退。
- 健康/补货 metrics 新增 `stockoutAdjusted`、`inStockDays`、`demandWindowDays`，历史 ROP 同步使用修正日均。
- 已发布预测路径不加载库存历史，计算逻辑保持不变。
- `formatSuggestionExplain` 对修正后的历史需求显示「断货修正历史」及有货天数。
- 未修改飞书 overview/query/bulk-stock/follow-up 列表页或 mapper。
- 测试：库存健康 1/1、建议说明 5/5 通过；目标文件 lint 无错误。
- 全量 TypeScript 检查受仓库既有错误阻塞，输出未引用本任务修改文件。
