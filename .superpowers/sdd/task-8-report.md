# Task 8：P0 验收回归报告

## 状态

PASS。5 组指定回归测试全部通过，验收清单 6/6 通过；本任务未发现代码缺口，因此未修改代码、未创建提交。

## 测试结果

| 测试文件 | 结果 | 摘要 |
| --- | --- | --- |
| `inventory-position.test.ts` | PASS | 8 tests / 8 pass / 0 fail，exit code 0 |
| `purchase-draft-eta.test.ts` | PASS | 1 test / 1 pass / 0 fail，exit code 0 |
| `inventory-health-service.test.ts` | PASS | 1 test / 1 pass / 0 fail，exit code 0 |
| `replenishment-coverage.test.ts` | PASS | 9 tests / 9 pass / 0 fail，exit code 0 |
| `inventory-light.test.ts` | PASS | 5 tests / 5 pass / 0 fail，exit code 0 |

合计：24 tests / 24 pass / 0 fail。

## Spec 清单

- PASS — 健康计算在 `inventory-health-service.ts` 调用 `resolveInventoryPosition`；补货任务通过 `computeSkuWarehouseHealth` 使用同一解析结果，并在建议阶段再次调用 `resolveInventoryPosition`，未直接以 `snapshot.effectiveQty` 作为仓级主口径。
- PASS — `buildInventoryPositionMetrics` 输出 `metrics.inventoryPosition`，并由健康服务合并进 `metrics`。
- PASS — `mergeInventoryPosition` 未传 `dedupeMode` 时默认使用 `drafts_fill_gap`。
- PASS — `resolveInventoryPosition` 的物理仓路径通过 `normalizeSnapshotForWarehouse` 将 `qtyInProduction` 归零，且函数内未调用 `getLatestInProductionQty`；全局在产仅由区域汇总 fallback 处理。
- PASS — `eta_available` 已加入 schema 和迁移；采购跟单 API 可读写，`buildEtaPatch` 同步写入旧字段 `confirmedDeliveryDate`；UI 可展示、确认和更新预计可售日。
- PASS — `main...HEAD` 的数据库变更仅包含 `purchase_drafts.eta_available` 迁移、journal 与采购 schema；P0 提交未新增 `lead_time_profiles` 或 `shipments` 表。

## 关注项

- 工作区原本存在大量与本任务无关的未提交改动；本次未触碰这些文件。
- 当前兼容策略会同时维护 `eta_available` 与旧字段 `confirmed_delivery_date`，后续移除旧字段应另立迁移任务，不属于 P0。

## 最终全分支评审修复（2026-07-29）

- 修复 `drafts_fill_gap` 来源口径：当快照数量大于零并赢得 `inTransit` 或
  `inProduction` bucket 时，从 `sources` 中排除该 bucket 的采购草稿来源，避免审计方误读为
  快照与草稿均计入 `effectiveQty`。`buildInventoryPositionMetrics` 继续序列化修正后的来源列表。
- 新增回归场景：快照在途 100、草稿在途 2000 时，`effectiveQty` 与 `qtyInTransit` 均为
  100，`sources` 仅保留快照在途 100。
- 采购跟单草稿的确认日期输入现在会从 `expectedDate` 预填，并使用该日期启用及提交“确认交期”。
- 按评审要求暂缓 `resolveInventoryPosition` 的 N+1 批处理优化，未在本次修复中实现。

验证结果：

- `inventory-position.test.ts`：PASS，9 tests / 9 pass / 0 fail。
- `purchase-draft-eta.test.ts`：PASS，1 test / 1 pass / 0 fail。
- 修改文件 IDE lint：无错误。
