# 库存时间轴日余额引擎设计

**版本**：v1.0（2026-09-17）  
**定位**：在现有三池批次（`inventory_supply_lots`）上，把锚点投影升级为「按海外可用日生效的每日余额」，作为预警、补货量、SKU 规划页的统一库存口径。  
**不另起系统、不新建事件表、不落库日序列。**

**关联文档**：

- 附件：`库存智能管理与补货决策系统——库存时间轴计算模型重构方案.md`（日余额 / 可用日 / 三条线）
- 附件：`跨境电商库存智能管理与补货决策系统产品方案 V1.0.md`（三池、7/15/30 预警、V1 范围）
- `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` — 覆盖天数健康灯、分段交期、PMC 跟单
- 现网：`apps/web/server/lib/inventory-timeline.ts`、`inventory-supply-lots.ts`、`inventory-timeline-service.ts`

---

## 1. 背景与目标

跨境履约是长周期：现网默认生产 50 天，海运美西 45 / 美东 60 / 德国 80，再加 7 天入仓，合计经常到 100 天上下。现网时间轴只投 0/7/15/30/45 五个锚点，比一条船还短，会把「本地已存在 / 计划中」误当成「海外可售」，或看不见管道后半段。

本设计回答：

> 在某一个自然日，某一个 SKU、某一个海外仓，确定/预计/计划各有多少货能实际满足销售。

成功标准：

- 缺货日、跌破安全库存日、最晚下单日、建议补货量均由同一日序列导出。
- 7/15/30 驾驶舱计数从确定线日序列取值，不再单独投影一套锚点库存。
- 生产中、估期在途、未达出货交期的本地货不填近窗缺口。
- 覆盖天数健康灯保留并行，补货量与缺货日以时间轴为准。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 粒度 | SKU × 目的海外仓 × 自然日 |
| 供给载体 | 现有 `inventory_supply_lots`（当事件用），不新建 `inventory_events` |
| 日序列 | 内存计算，不落库 |
| 供给分档 | 确定 / 预计 / 计划；无可用日则排除（三池仍可见） |
| 计算窗口 | `clamp(totalLeadDays + safetyStockDays, 90, 180)` |
| 当天需求 | 计入（重构方案：当天期末 = 期初 + 当日生效 − 当日预测） |
| 占用 | `qty_reserved` 只从期初扣一次 |
| 近窗预警 7/15/30 | 只看确定线 `Ending(k) ≤ 0` |
| 建议补货量 | 目标日前累计需求 + 安全库存 − 确定 − 预计；**不扣计划线** |
| PMC 未转跟单 | 本期不算供给 |
| 调拨 / 本地出货建议 | 本期不做（只打 `uncoverableByNewPo` 告警） |
| 健康灯 | 保留覆盖天数口径，与时间轴并行 |

---

## 3. 架构

时间轴是唯一「未来可售」计算引擎。覆盖天数服务继续算健康灯，不再独立冒充未来库存。

```text
飞书快照 + 跟单 + 发运
        → syncInventorySupplyLots
        → classifySupplyLot + projectDailyInventory
                ↓
     SKU规划 API / 补货任务 / 预警任务 / 驾驶舱计数
```

| 单元 | 职责 | 依赖 |
|------|------|------|
| `classifySupplyLot` | 批次 → `confirmed` \| `expected` \| `planned` \| `excluded` | pool、生产状态、`ship_ready_at`、`available_at`、`eta_estimated`、`date_unknown` |
| `projectDailyInventory` | 日序列、三个决策日期、建议量、锚点 | 分档批次、按日需求、`totalLeadDays`、`safetyStockQty` |
| `buildSkuWarehouseTimeline` | 读快照占用、lots、预测 Map、lead profile，组装入参 | 上两纯函数；`getForecastDailyForDate` |

不改路由前缀。`GET /api/inventory/planning/:skuId` 扩展返回体。流水线仍为：三池同步 → 补货预测 → 缺货预警。

---

## 4. 供给入档

去重（沿用现网 `buildLotsFromInputs`）：发运数量优先于跟单；跟单优先于快照残差在途。快照海外可售与批次海外池是同一来源，只计一次。

### 4.1 确定 Confirmed

- 海外池：飞书 `qty_available`，`available_at` 为快照业务日；计算时视为「今天及以前已可售」。
- 在途池：发运或跟单 `in_transit` / `partial_received`，且 `date_unknown = false` 且 `eta_estimated = false`。
- 可用日 = 现网 `eta_available`（已是海外可售语义则**不再**加一层入仓缓冲）。

### 4.2 预计 Expected

- 本地池：`production_status = completed`（或跟单 `ready_to_ship`），且 `ship_ready_at ≤ today`，且有 `available_at`。
- 可用日 = 出货交期 + 剩余物流（订舱 + 海运 + 清关 + 入仓），即现网 `resolveLocalAvailableAt`。
- 今天能出货 ≠ 今天海外可售。

### 4.3 计划 Planned

- 本地：生产中 / 待质检 / `ship_ready_at > today`，但能算出 `available_at`。
- 在途：仅有估期的残差在途（`eta_estimated` 或 `date_unknown`，但仍写了估算 `available_at`）。
- 只展示管道，不填 7/15/30，不扣减建议补货量。

### 4.4 排除 Excluded

- `available_at` 为空。
- PMC `pmc_plan_items` 尚未生成跟单的计划行。

排除批次仍出现在库存三池页。

---

## 5. 每日公式

窗口 `W = clamp(totalLeadDays + safetyStockDays, 90, 180)`。对 `k = 0 … W`（`asOf = today + k`）：

```text
supplyConfirmed(k) = max(0, Σ confirmed.qty where available_at ≤ asOf − qty_reserved)
supplyExpected(k)  = supplyConfirmed(k) + Σ expected.qty where available_at ≤ asOf
supplyPlanned(k)   = supplyExpected(k) + Σ planned.qty where available_at ≤ asOf

demandCum(k)       = Σ demand(today + i)  for i in [0, k]   // 含当天

confirmedEnding(k) = supplyConfirmed(k) − demandCum(k)
expectedEnding(k)  = supplyExpected(k) − demandCum(k)
plannedEnding(k)   = supplyPlanned(k) − demandCum(k)
```

需求：已发布预测 `getForecastDailyForDate`；无预测则 `avgDaily`。`avgDaily = 0` 时不算缺货日、不生成补货建议。

占用：只减一次，不按天重复扣。实现上 `getLatestInventorySnapshot` 需补读 `qty_reserved`（现网该函数未返回占用，本设计要求补上）。

与现网 `sumForecastDemand(map, today, horizonDays)` 的差异：旧函数是 `[0, horizonDays)` 共 N 天、不含 asOf 当天。日引擎用 **含当天** 的 `k+1` 天。展示「7 天」节点取 `k = 7`（累计 8 个自然日的预测，含今天与第 7 天）。

交期地平线节点：`k = min(totalLeadDays, W)`。

---

## 6. 三个决策日期与补货量

均按 SKU × 仓。日期为 `YYYY-MM-DD`（业务日，与现网 `addDaysIso` 一致）。

| 字段 | 定义 |
|------|------|
| `stockoutDateConfirmed` | 确定线第一次 `confirmedEnding(k) ≤ 0` 的 `asOf`；窗口内未跌破则为 `null` |
| `stockoutDateExpected` | 预计线第一次 `expectedEnding(k) ≤ 0` 的 `asOf` |
| `safetyBreachDateConfirmed` | 确定线第一次 `confirmedEnding(k) < safetyStockQty`；今天已低于则记今天 |
| `reorderDate` | `stockoutDateExpected − totalLeadDays`；无预计缺货日则为 `null`；结果早于今天则钳为今天 |
| `tooLateForNewPo` | `reorderDate` 被钳到今天（按未钳日期已过） |
| `uncoverableByNewPo` | `stockoutDateConfirmed` 存在且距今天天数 `< totalLeadDays`（新计划的到仓日救不了这次确定缺货） |

7/15/30 预警：`confirmedEnding(7|15|30) ≤ 0` 时发 `stockout_horizon`（沿用 `deriveHorizonAlerts`，改为读日序列锚点而非旧五锚点投影）。

覆盖不足 / 积压预警仍用覆盖天数 vs `totalLeadDays` / 超备阈值，不改判定式。

**建议补货量**，目标日对应 `kT = min(totalLeadDays, W)`：

```text
suggestedQty = max(0, ceil(demandCum(kT) + safetyStockQty − supplyExpected(kT)))
```

`supplyExpected` 已含确定供给，且确定供给已扣除占用。计划线不减。MOQ 抬升规则与现网 `calcSuggestedQtyFromTimeline` 相同。灰灯生命周期：时间轴照算供查看，补货任务不写建议。

主展示缺货日 = `stockoutDateConfirmed`（近窗不可被本地货拯救时以确定线为准）。规划页同时展示预计缺货日。

---

## 7. API 与页面

`SkuPlanningView.timeline` 扩展为：

```text
{
  today,
  windowDays,
  totalLeadDays,
  stockoutDateConfirmed,
  stockoutDateExpected,
  safetyBreachDateConfirmed,
  reorderDate,
  tooLateForNewPo,
  uncoverableByNewPo,
  suggestedQty,
  points: [ { horizonDays, asOf, confirmedEnding, expectedEnding, plannedInbound, supplyEvents } ]
}
```

`points` 只含 **今天、7、15、30、交期地平线** 五行，不返回 90–180 行。`plannedInbound` 为该 asOf 及以前计划档累计件数，供备注「管道 +N」。

页面：

- SKU 库存规划：主信息四格改为确定缺货日、破安全库存日、最晚下单日、交期地平线预计余额；表五行双列（确定/预计）；健康灯与覆盖天数保留。
- 规划驾驶舱：7/15/30 仍读预警表聚合；增加「新计划已来不及」计数（`uncoverableByNewPo` 未解决预警条数）。
- 预警列表：horizon 预警增加来源标签「确定线」；`uncoverableByNewPo` 用独立 `alert_type`（现有 `stock_alerts.alert_type` 能扩则扩，否则写入 `metrics` 并在列表用文案区分）。实现时优先扩展 enum：`uncoverable_by_new_po`。
- 库存三池：说明文案改为「无可用日不进时间轴；估期在途进计划线不进确定线」。

不新开路由。

---

## 8. 失败降级

| 情况 | 行为 |
|------|------|
| 无批次 | 海外可售 − 占用作为 `k=0` 唯一确定供给，其后只扣需求 |
| 无发布预测 | 需求 = `avgDaily` |
| `avgDaily = 0` 且无预测 | 不算缺货日，`suggestedQty = 0` |
| 引擎抛错 | 规划页仍返回覆盖天数/健康灯；补货量回退 `calcCoverageReplenishment`；`console.warn` |
| 灰灯 | 时间轴可看，不写 `reorder_suggestions` |

---

## 9. 测试

纯函数优先（`inventory-timeline.test.ts` 扩展，入档测放 `inventory-supply-lots.test.ts` 或同文件）。

1. **入档**：真实 ETA 在途 → confirmed；已达交期本地 → expected；生产中有可用日 → planned；估期在途 → planned；无日期 → excluded。
2. **长周期样例**（today=`2026-09-17`，日需求 40，占用 0，`totalLeadDays=102`，安全库存 500）：海外 1000；在途 500 @ `2026-09-24`；本地可出货 300 @ `2026-11-08`（+52）；生产中 800 @ `2026-12-28`（+102）。断言：k=7 确定线含在途；k=30 预计线 = 确定线；k=52 预计线才含本地 300；建议量按交期地平线计算且**不扣** 800 在产。
3. **三个日期**：破安全库存日早于确定缺货日；`reorderDate = stockoutDateExpected − 102 天`；确定缺货落在 102 天内则 `uncoverableByNewPo = true`。
4. **旧样例兼容**：供给 1000+500@+7+300@+15+500@+25，累计需求在 k=45 为 2600 时，`expectedEnding(45) = -300`（用测试注入的 demand 函数，不强制 40/天）。
5. **占用**：海外 1000、reserved 200 → k=0 的 `supplyConfirmed = 800`。

任务级测试不强制打库；规划 view 单测断言 timeline 字段在注入引擎结果时原样透出。

---

## 10. 明确不做（本期）

- 海外仓调拨建议、本地出货执行单
- 库存事件表、日余额持久化、置信度百分比
- PMC 计划行直接进计划线
- 用计划线扣减补货量
- 替换覆盖天数健康灯
- 船司 API、正式 PO

---

## 11. 与现网锚点引擎的关系

`projectInventoryTimeline`（五锚点、单一 `projectedBalance`）由 `projectDailyInventory` 取代。`DEFAULT_TIMELINE_HORIZONS` 仅作为展示锚点列表的默认值（今天/7/15/30 + 交期地平线动态加入）。`buildSkuWarehouseTimeline` 保持函数名，返回值改为第 7 节结构；调用方（规划服务、补货任务、预警任务）一并改读新字段。
