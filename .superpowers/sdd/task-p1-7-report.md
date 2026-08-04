# P1 Task 7 实施报告

- 新增 `formatSuggestionExplain` / `deriveTriggerReason`，从 `metrics.inventoryPosition` 与六段提前期格式化可解释文案。
- metrics 不完整时降级为 `item.reason`；缺 `avgDaily` 时由覆盖天数反推。
- `ReorderSuggestionsPage` 展开区接入格式化文案；页头更新有效供给口径说明。
- SKU 链接至 `/inventory/planning/${skuId}`（Task 8 路由就绪后可用）。
- 未修改飞书列表页（overview/query/bulk-stock/follow-up）。
- 测试：`reorder-suggestion-explain.test.ts` 4/4 通过。
- Commit：`46bf611` feat: explain reorder suggestions with position and lead-time breakdown
