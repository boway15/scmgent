# P2 Task 8 验收回归报告

- 分支/基线：`feat/inventory-planning-p2` 对比 P1 tip `555c42e`。
- Brief 指定的 5 组测试全部通过：23 tests，0 fail。
- 补充运行 `src/pages/ShipmentsPage.test.ts`：5 tests，0 fail。
- 有断货历史样本：`avgDaily=50`，高于日历均摊 `1000/30`，`stockoutAdjusted=true`。
- 无库存历史样本：回退日历均摊 `avgDaily=3`，`stockoutAdjusted=false`。
- 发运页与 API 支持创建发运、维护 7 个计划/实际节点及备注。
- 「延误」Tab 使用 delayed 查询并展示逾期天数。
- 冻结检查通过：`InventoryOverviewPage`、`inventory-overview-columns`、`InventoryQueryPage`、`inventory-query-columns`、`ProcurementPages`、`ProcurementBitableListPage` 相对基线无改动。
- 飞书采购/库存列表相关 mapper 与 list service 相对基线无改动，四列表列结构保持不变。
- FOB 路径相对基线无改动；P2 发运模型与 FOB 保持解耦。
- 未发现需修复缺陷；未修改设计 §13，未创建提交。
