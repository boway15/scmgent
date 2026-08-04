# 跨境电商库存规划与供应商 PMC 演进设计

**版本**：v1.0（2026-07-29）  
**定位**：在现有「预测 → 补货 → PMC → 跟单 → 到货」闭环之上，演进为可回答「该不该补、补多少、何时下单、会否断货/积压」的规划平台；不另起系统。

**关联文档**：

- `docs/prd/mvp-business-loop.md` — 现有有限业务闭环
- `docs/prd/mvp-pmc.md` — PMC 计划（非正式 PO）
- `docs/prd/mvp-inventory-replenishment.md` — 安全库存与补货
- `docs/prd/mvp-overview.md` — 明确不做范围
- `docs/superpowers/specs/2026-06-29-sales-forecast-collaboration-design.md` — 预测协作

---

## 1. 背景与目标

### 1.1 要回答的 4 个问题

1. 什么时候需要补货？
2. 应该补多少？
3. 什么时候必须下单，才能覆盖生产和海运周期？
4. 当前库存、在途、生产和需求变化，是否会造成断货或库存积压？

### 1.2 产品边界

系统名称可表述为：**跨境电商库存规划与供应商 PMC 平台**。

由两个相互连接的核心引擎组成：

```text
库存规划引擎：
需求预测 + 库存位置 + 分段提前期 + 安全库存/覆盖天数 + 补货建议

供应商 PMC 引擎：
采购计划 + 交期承诺 + 状态跟单 + 发运里程碑 + 到货回写
```

| 引擎 | 负责 | 不负责 |
|------|------|--------|
| 库存规划 | 该不该补、补多少、何时下单、可解释依据 | 工厂排产 MES、正式财务 PO |
| 供应商 PMC | 供应商能否按计划生产与交付、预计可售日 | 船司 API、FOB 费用结算（已有独立模块） |

### 1.3 与现状的关系

| 能力 | 现状 | 本设计 |
|------|------|--------|
| 预测协作（版本/审核/季节/准确率） | 已实现 | **复用**，仅补断货修正 |
| 覆盖天数补货 + 健康灯 | 已实现 | **统一库存位置口径**后继续为主策略 |
| 总提前期 = 生产 + 海运 + 入仓缓冲 | 已实现（3 段） | **演进为路线级 profile**，计算仍汇总为 `totalLeadDays` |
| PMC 计划 + `purchase_drafts` 跟单 | 已实现 | **强化里程碑与预计可售日** |
| 正式 PO / BOM / 供应商门户 / 船司 API | PRD 明确不做 | **继续不做** |
| FOB 结算 | 已实现 | **与发运跟踪解耦** |
| SAP | 无 | **仅预留外部标识字段**，不开发真实接口 |

**原则**：扩展现有表与服务，禁止平行再建一套 `inventory_balance` / `demand_forecast` / `purchase_order` 主路径。

### 1.4 成功标准

- **库存总览（展示）**：分仓可售/在途/在产等以飞书同步写入的 `inventory_records` 为准；宽表周转列与近端销量仅作参考展示，不参与总览逻辑计算。
- **补货 / 健康 / 告警 / SKU 规划 / 建议依据（计算）**：与总览分仓同源，仅读 `inventory_records` 快照（`snapshot_only`），**不叠加** `purchase_drafts`；仍扣除 `qtyReserved`。
- 补货建议可解释：能展示触发原因、库存位置构成、提前期拆解、建议下单日与建议量。
- 跟单维护「预计可售日」与发运里程碑，供运营与驾驶舱延期 KPI；**不驱动**补货有效供给（待飞书同步或到货回写后库存才变化）。
- 补货/健康任务结束后，按各仓最差 `health_status` 回写 SKU 级 `replenish_light`（人工锁定除外），使总览灯与系统计算逐步对齐。
- 提前期可按「供应商 × 目的仓 × 运输方式」配置，缺省回退到现有分段解析。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 演进方式 | 在现闭环上加深，不重造规划系统 |
| 默认补货策略 | 覆盖天数 + 健康灯（现网）；Z 值服务水平为可选高级策略，字段先预留 |
| 库存位置 | 单一服务 `resolveInventoryPosition`；**补货主路径** `snapshot_only`（与飞书快照同源）；`drafts_fill_gap` 代码保留、默认不用于规划 |
| 提前期 | 新建 `lead_time_profiles`；算法对外仍用 `totalLeadDays` + `breakdown` |
| 正式 PO | 继续用 `purchase_drafts`；不引入审批流 PO |
| 发运跟踪 | 轻量 `shipments` / `shipment_milestones`，与 FOB 解耦；MVP 人工维护 |
| 预测 | 不重建预测工作台；补「有库存天数」有效日需求 |
| SAP | `source_system` / `external_id` 等预留；规划逻辑留在本系统 |
| 计算追溯 | 先强化建议/健康 `metrics` 快照；争议多后再抽 `planning_runs` 表 |

---

## 3. 目标闭环

```text
销售订单/预测（已有）
    ↓
库存位置核算（本设计 P0）
    ↓
安全库存 / 覆盖天数（已有，口径对齐）
    ↓
自动重订货 / 补货建议（已有，可解释增强）
    ↓
PMC 计划 + 采购跟单（已有）
    ↓
生产/发运里程碑 + 预计可售日（本设计 P0–P2）
    ↓
到货入库回写（已有）
    ↓
可售库存与健康灯更新
```

触发判断（保持并强化）：

```text
供应覆盖天数 = 库存位置 / 预计日需求

若 供应覆盖天数 < 总提前期 + 安全库存覆盖期
或 库存位置 <= 重订货点
→ 生成补货建议
```

**禁止**仅用「现货库存 <= 重订货点」作为唯一触发条件。

---

## 4. 库存位置（P0）

### 4.1 定义

```text
库存位置 =
  可售库存（qtyAvailable）
+ 生产中（qtyInProduction + 跟单 mapped production）
+ 在途（qtyInTransit + 跟单 mapped transit）
+ 已确认未生产（跟单 confirmed/draft 未收货量，按策略计入）
- 已分配（qtyReserved）
- 未交付欠单（可选，首版可为 0）
```

预下单等业务量：延续现有导入约定（如写入 `qtyReserved` / 总览 `qtyPreOrder` 展示），在 position 构成中**显式标注来源**，避免重复加减。

### 4.2 跟单状态 → 位置桶映射

| `purchase_drafts.status` | 计入桶 | 数量口径 |
|--------------------------|--------|----------|
| `draft` / `confirmed` | `confirmedOpen`（已确认未生产） | `qty - receivedQty` |
| `in_production` / `ready_to_ship` | `inProduction` | 同上 |
| `in_transit` / `partial_received` | `inTransit` | 未收货部分 |
| `received` / `cancelled` | 不计入开放量 | — |
| `exception` | `confirmedOpen` | `qty - receivedQty`；`sources` 打标 `atRisk: true` |

与飞书/导入快照的 `qtyInProduction` / `qtyInTransit` **去重规则**（必须写死）：

1. **优先快照**：若当日快照已含「供应商订单 / 调拨在途」等合计，跟单开放量仅在「快照未覆盖该 SKU+仓」或「显式启用跟单叠加开关」时叠加。
2. 首版默认：**快照权威 + 跟单仅补齐快照为 0 的缺口**（P0 锁定 `drafts_fill_gap`；可配置为 `snapshot_only` | `drafts_fill_gap` | `sum_both`）。
3. 构成明细写入 metrics，便于审计「为什么位置是 5800」。

### 4.3 服务契约

新建（建议路径）`apps/web/server/lib/inventory-position.ts`：

```ts
type InventoryPositionBreakdown = {
  qtyAvailable: number;
  qtyInProduction: number;
  qtyInTransit: number;
  qtyConfirmedOpen: number;
  qtyReserved: number;
  qtyBackorder: number; // 首版 0
  effectiveQty: number; // = 位置合计
  sources: Array<{ source: string; bucket: string; qty: number }>;
  dedupeMode: 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';
};

function resolveInventoryPosition(params: {
  skuId: string;
  warehouseCode: string;
  asOf?: Date;
}): Promise<InventoryPositionBreakdown>;
```

**强制调用方**：`inventory-health-service`、补货任务、`reorder` 建议生成、未来 SKU 规划 API。禁止各模块自行 `available + transit`。

### 4.4 数据模型

首版**不新建** `inventory_balance` / `inventory_transaction`。继续：

- `inventory_records` + 飞书日快照
- `purchase_drafts` 开放量
- 计算结果进 `reorder_suggestions.metrics` / `inventory_health_snapshots`

待真实 WMS 流水接入后再评估流水表。

---

## 5. 提前期（P1）

### 5.1 完整链路（业务语义）

```text
采购下单 → 接单 → 备料 → 生产 → 质检/包装 → 国内集货
→ 订舱 → 海运 → 清关 → 到仓 → 上架 → 可售
```

### 5.2 配置维度

提前期**不**只挂在供应商主数据上。维度：

```text
supplier/merchant + origin_location + destination_warehouse + transport_mode
```

### 5.3 存储：`lead_time_profiles`

| 字段 | 说明 |
|------|------|
| id | uuid |
| merchant_code | 商家/供应商编码，可空表示仓默认 |
| origin_location | 起运地（自由文本或码表），可空 |
| destination_warehouse_code | 目的仓，必填或与 region 二选一 |
| transport_mode | `fcl` / `lcl` / `air` / `express` / `rail` / `truck_air` / `direct` |
| production_days | 备料+生产+质检（可再拆子字段，首版合并） |
| booking_days | 订舱等待 |
| transit_days | 干线运输 |
| customs_days | 清关 |
| inbound_days | 到仓+上架（对应现 `inboundBufferDays`） |
| domestic_days | 国内集货/运输，默认 0 |
| lead_time_std_dev | 可选，高级安全库存用 |
| is_default | 同维度默认档 |
| version / effective_from | 可选版本 |
| source_system / external_id | SAP 预留 |
| created_at / updated_at | |

**解析优先级**（替换/扩展现 `lead-time-resolver`）：

1. 精确匹配 profile（商家 + 仓 + 运输方式）
2. 仓级默认 profile / `warehouses.shipping_lead_days` + `inbound_buffer_days`
3. 商家 `production_lead_days` / `sku_suppliers.lead_time_days` / SKU `lead_time_days`
4. 代码常量（如现 `DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE`）

### 5.4 计算输出

保持并扩展 `LeadTimeBreakdown`：

```text
totalLeadDays =
  production_days + domestic_days + booking_days
  + transit_days + customs_days + inbound_days
```

展示层可显示 6 段；内部补货只依赖 `totalLeadDays`。  
**补货与 ETA 一律使用「预计可售日」语义**，不等于到港日。

---

## 6. 安全库存与补货量（对齐现网）

### 6.1 默认：覆盖天数

沿用 `replenishment-coverage`：

```text
覆盖天数 = 库存位置 / 预计日需求
最晚下单剩余天数 = 覆盖天数 - 总提前期 - 安全库存天数
建议量 = max(0, 目标覆盖天数 × 日需求 - 库存位置)，再按 MOQ 抬升
```

目标覆盖天数默认：`总提前期 + 2 × 安全库存天数`（与现实现一致，可配置）。

### 6.2 经典 ROP（并存）

```text
重订货点 = 提前期需求 + 安全库存
提前期需求 = 预计日需求 × 总提前期
```

`safety_stock_config` 继续承载 ROP/EOQ/覆盖参数；补货任务以覆盖健康灯为主，ROP 作并列展示与预警类型。

### 6.3 高级：服务水平（P3，字段预留）

```text
safety_stock = Z × σ_demand × √L
# 或含提前期波动：
Z × √(L·σ_d² + μ_d² · σ_L²)
```

在 `safety_stock_config`（或 planning 参数）预留：

- `demand_std_dev`
- `lead_time_std_dev`
- `service_level`
- `safety_stock_method`：`coverage_days` | `z_demand` | `z_demand_leadtime`

**首版不默认启用 Z 值公式。**

### 6.4 采购约束

建议量修正顺序：

1. 目标库存 − 库存位置  
2. `max(结果, MOQ, 最小生产批量)`  
3. 向上取整到包装倍数（有数据时）  
4. 整柜/托盘（有数据时，可后置）  
5. 供应商产能 / 预算 / 仓容 — **首版仅备注或人工改量，不做自动硬约束引擎**

---

## 7. 需求预测（增量）

### 7.1 复用

继续使用 `sales_forecast_*` 协作体系；补货优先已发布版本（现有 `forecast-published-resolve`）。

### 7.2 断货修正（P2）

历史回退日需求改为有效销售速度：

```text
有效日需求 = 有库存期间销量 / 有库存销售天数
```

实现要点：

- 输入：`sales_history` + 同期可售库存（快照或「可售 > 0」近似）
- 输出：供 `historicalAvgDaily` 回退；metrics 记录 `stockoutAdjusted: true` 与天数
- 无可靠库存历史时回退为「实际销量 / 日历天数」，并标记未修正

### 7.3 不做

- 不新建平行 `demand_forecast` 表  
- 不把「仅支持移动平均三种方法」当作新项目；现有基线/协同已覆盖并更强

---

## 8. 供应商 PMC 与预计可售日（P0–P1）

### 8.1 延续

- `pmc_plans` / `pmc_plan_items`：需求计划下发  
- `purchase_drafts`：内部跟单真相  
- 到货 → `pmc_receipts` → 库存回写  

### 8.2 跟单字段扩展

在 `purchase_drafts`（或 1:1 扩展表）增加：

| 字段 | 说明 |
|------|------|
| planned_production_done_date | 计划生产完成 |
| actual_production_done_date | 实际生产完成 |
| planned_pickup_date | 预计提货 |
| etd | 预计开船 |
| eta_port | 预计到港 |
| customs_done_date | 预计/实际清关完成 |
| eta_warehouse | 预计入仓 |
| eta_available | **预计可售日**（补货与延误计算主字段） |
| delay_days | 相对原承诺的延误（可计算） |
| transport_mode | 运输方式，解析 lead time 用 |

现有 `confirmed_delivery_date`：**语义迁移为承诺可售日**；若历史数据混用到港日，迁移说明写入 metrics/备注，UI 标明「承诺可售」。

### 8.3 里程碑提醒

扩展 `purchase_follow_up_reminders.milestone` 枚举/约定值，例如：`confirm` / `production` / `etd` / `eta_port` / `eta_available`。

### 8.4 明确不做（近期）

- 每日工厂产量录入、缺料、BOM/`material_requirements` UI  
- 供应商门户  
- 正式 PO 审批  

---

## 9. 发运与海运节点（P2）

### 9.1 与 FOB 解耦

`/logistics/fob-*` 保持费用分摊结算。供应链节点跟踪使用新轻模型。

### 9.2 表：`shipments` / `shipment_milestones`

**shipments**

| 字段 | 说明 |
|------|------|
| id / shipment_no | |
| draft_id / plan_item_id | 关联跟单或计划行（可空） |
| sku_id / qty | 可多行时后续再拆明细表；首版一票一 SKU 或 JSON lines |
| container_no / booking_ref / tracking_no | |
| transport_mode | |
| status | 与里程碑最后完成节点一致 |
| eta_available | 冗余便于列表 |
| source_system / external_id | 预留 |
| created_at / updated_at | |

**shipment_milestones**

| 字段 | 说明 |
|------|------|
| shipment_id | |
| milestone | `booked` / `loaded` / `departed` / `arrived_port` / `customs` / `received_wh` / `available` |
| planned_at / actual_at | |
| remark | |

MVP：人工维护节点；延误天数 = `actual/ today - planned`。

### 9.3 列表页

「在途和海运管理」首版可以是跟单筛选增强 + shipments 列表，不必先做大驾驶舱。

---

## 10. 页面演进

### 10.1 优先

| 页面 | 说明 |
|------|------|
| SKU 库存规划页 | 单 SKU：位置拆分、日需求、安全库存、ROP、总提前期、覆盖天数、预计断货日、建议下单日/量、简易库存曲线 |
| 补货建议可解释 | 在现 `/pmc/suggestions` 展示构成与触发原因（你文档中的字段清单） |
| 跟单里程碑 | `/pmc/tracking` 增加可售日与关键日期 |

### 10.2 其后

| 页面 | 说明 |
|------|------|
| 发运节点看板 | 基于 shipments |
| 规划驾驶舱 | 聚合健康快照、建议待审、延误批次、断货率等；依赖 P0 口径稳定 |
| 预测管理 | **已有**，仅加断货修正说明/指标 |

### 10.3 SKU 规划页最小指标

```text
当前可售 / 已分配 / 生产中 / 在途 / 已确认未生产
预计日需求 / 安全库存 / 重订货点 / 总提前期
供应覆盖天数 / 预计断货日 / 建议下单日 / 建议采购量 / 预计可售到货
```

库存曲线：简化为「按日需求消耗 + 已知 `eta_available` 补给阶跃」；不做复杂仿真引擎。

### 10.4 补货建议可解释示例（产品文案）

```text
触发原因：库存位置低于重订货点（或覆盖天数不足）
库存位置：5,800 = 可售 2,400 + 生产中 … + 在途 … − 已分配 …
日均需求：120（来源：已发布预测 version=… / 或断货修正历史）
总提前期：65 = 生产 25 + … 
安全库存：1,800（方法：coverage_days / 14 天）
重订货点：9,600
建议补货量：12,000（已按 MOQ 调整）
预计缺货日期 / 建议下单日期 / 预计可售到货
```

用户动作保持：接受、改量、改供应商、合并进 PMC、忽略+原因。

---

## 11. 计算追溯

每次补货/健康计算写入（建议 metrics JSON）：

```text
planning_calculated_at
forecast_version_id / demand_source
lead_time_breakdown + profile_id
inventory_position breakdown + dedupe_mode
safety_stock_method + parameters
suggested_qty / suggested_date / health_status
```

独立 `planning_runs` 表：**延期到**出现大量「当时为何建议 12000」审计需求时再抽。

---

## 12. SAP / 外部系统兼容

在 SKU、商家、跟单、发运、提前期 profile 上按需预留：

```text
source_system
external_id
external_line_id
external_version
sync_status
last_sync_time
```

接入顺序（仅规划，本设计不实施）：

1. 供应商与物料主数据  
2. 采购订单镜像  
3. 库存与入库  
4. PO 变更  
5. 发货通知与物流  

**本系统继续维护**：预测、安全库存/覆盖策略、补货建议、供应商承诺与生产/发运跟进、海运/清关提前期、异常与绩效相关运营数据。

---

## 13. 分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0** | `resolveInventoryPosition` 同源；跟单 `eta_available` 语义；建议 metrics 构成 | 同 SKU 健康与建议 effectiveQty 一致；UI 可见位置拆分 |
| **P1** | `lead_time_profiles` + resolver；SKU 规划页；建议可解释 UI；跟单里程碑日期 | 换 profile 后建议量/日期变化可测；单 SKU 页可用；实现计划见 `docs/superpowers/plans/2026-07-29-inventory-planning-p1.md` |
| **P2** | 断货修正有效日需求；`shipments` 轻模型 + 人工节点；延误列表 | 有断货史 SKU 回退需求升高；节点可维护；实现计划见 `docs/superpowers/plans/2026-07-29-inventory-planning-p2.md` |
| **P3** | Z 值可选策略；规划驾驶舱 KPI；external_id 铺齐 | 方法切换有配置与单测；驾驶舱只读聚合；实现计划见 `docs/superpowers/plans/2026-07-29-inventory-planning-p3.md` |
| ~~**P4**~~ | ~~SAP 镜像适配~~ | **不做**（2026-07-30 决策：不引入 SAP 镜像模块；`0066_drop_sap_mirror` 清理表与菜单） |
| **P4+** | 外部 ERP/SAP 真实对接 | 另开需求时再设计；当前仅保留 `source_system` / `external_id` 预留字段 |

工程旁路（不阻塞本主线，可并行）：库存查询页/系统任务页路由接通。

---

## 14. 非范围（本设计明确不做）

- 正式采购单审批流、供应商门户  
- BOM / MRP / `material_requirements` 业务化  
- 船司/承运商实时轨迹 API  
- 与 FOB 结算模块合并  
- 重建预测工作台或平行规划主数据  
- 完整库存流水账 / WMS  
- 现金流、仓容、保质期自动硬约束引擎  
- 真实 SAP 接口开发  

---

## 15. 主要代码落点（实施时参考）

| 区域 | 路径 |
|------|------|
| 提前期 | `apps/web/server/lib/lead-time-resolver.ts`、`replenishment-coverage.ts` |
| 健康/补货 | `apps/web/server/lib/inventory-health-service.ts`、`tasks/replenishmentForecast.ts` |
| 库存位置（新） | `apps/web/server/lib/inventory-position.ts`（+ 单测） |
| Schema | `packages/db/src/schema/procurement.ts`、`warehouses.ts`；新 `lead-time-profiles` / `shipments` |
| 跟单 UI | `PurchaseTrackingPage`、PMC 详情 |
| 建议 UI | `ReorderSuggestionsPage` |
| 规划页（新） | 建议路由 `/inventory/planning/:skuId` 或 `/pmc/sku/:skuId` |
| 预测回退 | historical avg 计算处 + 断货修正工具函数 |

---

## 16. 风险与开放问题

| 风险 | 缓解 |
|------|------|
| 飞书快照与跟单数量双计 | 补货主路径 `snapshot_only`；跟单仅履约台账，不进 effectiveQty |
| 历史 `confirmed_delivery_date` 语义不清 | UI 标注；新字段 `eta_available` 为主 |
| 提前期分段过多导致无人维护 | 配置用 6 段，录入可用 3 段汇总模板 |
| 驾驶舱过早建设导致口径再改 | 驾驶舱放 P3，P0 先锁 position |
| 在产快照为 SKU 级逻辑仓 | 物理仓 position **不**把 `IN-PRODUCTION` 全量摊进每个目的仓；区域池单独加一次 fill_gap |

### 16.1 P0 已锁定决策

| 项 | 决定 |
|----|------|
| 去重模式（补货主路径） | **`snapshot_only`**（2026-07-30 锁定） |
| 去重模式（代码保留） | `drafts_fill_gap` / `sum_both` 仍可用于审计或非规划场景 |
| 物理仓 `effectiveQty` | `available + transit + production(快照) − reserved`（不含跟单 open；物理仓在产仍按 P0 规则归零后由在产仓/区域池 fallback） |
| `exception` 开放量 | 计入 `confirmedOpen`，`sources` 打标 `atRisk: true` |
| 跟单仓归属 | `pmc_plan_items.warehouse_code` → 否则 `pmc_plans.target_warehouse_code`；皆空则不进物理仓 position（记入 `unassignedOpen` 仅 metrics） |
| `eta_available` | 新列；写入时同步 `confirmed_delivery_date`；列表展示以 `eta_available` 优先 |
| SKU 规划页菜单 | **P1 已锁定**：`/inventory/planning/:skuId`，菜单 `inventory.planning` |
| 提前期运输方式维 | **P1 已锁定**：商家+目的仓优先，运输方式可空 |

### 16.2 本阶段非目标（边界）

P0 **不包含**：`lead_time_profiles`、SKU 规划页 UI、发运 `shipments` 表、断货修正、Z 值安全库存、规划驾驶舱、SAP 接口、正式 PO、BOM、FOB 改造。

### 16.3 P1 补充约束（飞书同步列表）

以下飞书同步驱动的列表**不得调整列结构 / 表头 / 行信息布局**：

- 大件备货、采购跟进（飞书采购列表）
- 库存总览、库存查询

P1/P2 变更仅落在：提前期配置、内部 PMC 跟单（`/pmc/tracking`）、补货建议可解释、SKU 规划页、发运页（`/pmc/shipments`）；不改上述飞书对照表。

### 16.4 业务口径锁定（2026-07-30）

| 模块 | 库存 / 供给口径 | 说明 |
|------|-----------------|------|
| 库存总览 | `inventory_records` + 飞书宽表展示 | 飞书库存权威；销量/预测列仅参考 |
| 补货 / 健康 / 告警 / 规划 / 建议 | `snapshot_only` | 与总览分仓同源；扣 `qtyReserved` |
| 采购跟单 / 发运 | 不进入 effectiveQty | 可售日、里程碑供运营与延期 KPI |
| AI 助手 | 可售+在途简单快照 | 注明与补货建议可能不同 |
| `replenish_light` | 补货任务回写 | `encoding_meta.replenishLightManual=true` 时跳过 |
| SAP 镜像 | 不做 | 见 §13 |

---

## 17. Self-review

- 无「TBD 算法另议」空洞：P0–P2 行为与表字段已写清  
- 与 `mvp-overview`「不做正式 PO/BOM」无冲突  
- 不要求一次性实现用户原稿全部页面与 Z 值模型  
- 预测、FOB、飞书同步职责边界已划清  

---

**实现计划**：

- P0：`docs/superpowers/plans/2026-07-29-inventory-planning-boundary-p0.md`（已合入 main）
- P1：`docs/superpowers/plans/2026-07-29-inventory-planning-p1.md`
- P2：`docs/superpowers/plans/2026-07-29-inventory-planning-p2.md`
- P3：`docs/superpowers/plans/2026-07-29-inventory-planning-p3.md`
- ~~P4 SAP 镜像~~：**不做**（见 §13）
