# ADR-002：出货前不定目的仓

**状态**：已接受（2026-09-22）  
**背景**：需求端（PMC / 补货）与供应端（跟单 / 在产）在业务上均不指定目的仓；目的仓仅在**创建发运单（出货）**时确定。

## 决策

### 供应

| 阶段 | 批次落点 | 是否进某仓确定线 |
|------|----------|------------------|
| 在产 / 待发（无发运） | `IN-PRODUCTION`（local 池） | 否 |
| 未定仓在途残差 | `OVERSEAS`（in_transit 池） | 否 |
| 已上架海外实物（飞书仅合计） | 仍可按销售占比**推断**拆仓（历史投影，非本批货去向） | 是（标注推断） |
| 已创建发运单 | `shipments.destination_warehouse_code` | 是 |

- **禁止**对无目的仓跟单 / 在产快照使用 `#share` 占比拆仓。
- **禁止**用默认 `US-WEST` 或占比首仓代理海运交期；出货前 `remainingLogisticsDays = 0`。
- 发运单创建时**必填** `destination_warehouse_code`。

### 需求 / PMC

- PMC 草稿计划按**商家**合并，不再按「商家 + 目标仓」。
- `target_warehouse_code` / 计划行 `warehouse_code` 可为空；不向跟单写入假目的仓。
- 补货预测仍按仓算健康灯与时间轴；**写入建议时**按 SKU 网络汇总（取 max 建议量，避免多仓重复下单）；采纳进 PMC 为 SKU 级网络需求行。

### 交期

- 出货前：纯生产段（`remainingLogisticsDays = 0`，网络时间轴用 `resolvePreShipmentLeadTimeForSku`）。
- 出货后：按发运单目的仓解析 booking + transit + customs + inbound。

## 需求计划试点（网络级）

- 版本与周行 `warehouse_code = ALL`，生成时 `share = 1`（全站网络需求）。
- 采用记录 `(project_group, ALL)`；各目的仓规划/补货 **按销售占比投影** 网络周需求。
- 无占比 SKU 在该仓规划页回退 Champion 预测（`no_share`），不阻断已发布的网络计划。
- `DEMAND_PLAN_PILOT_WAREHOUSES` 为空 = 试点组内所有仓可消费；非空则限制投影仓列表。

## 网络时间轴（P2，已实现）

- `buildSkuNetworkTimeline`：聚合全 SKU open lots + `warehouse=ALL` 网络需求，一条日余额线。
- `resolvePreShipmentLeadTimeForSku`：出货前纯生产交期（仅 `productionDays`），不含国内段/订舱/目的仓海运。
- 需求计划发布（`warehouse_code=ALL`）与补货网络建议均走网络时间轴。

## 关联实现

- `inventory-supply-lots.ts`、`inventory-supply-lot-sync.ts`
- `packages/db`：`shipments.destination_warehouse_code`
- `pmc-plan.ts`、发运创建 UI
- `network-replenishment.ts`、`replenishmentForecast.ts`（网络汇总建议）
- `inventory-position.ts`（跟单不再继承 PMC 假目的仓）
- `inventory-dest-allocation-store.ts`（未定仓统计含 IN-PRODUCTION）
