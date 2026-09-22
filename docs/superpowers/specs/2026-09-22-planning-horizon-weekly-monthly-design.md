# 规划地平线：6 个月 + 26 周 + 补货采用位

**版本**：v1.0（2026-09-22）  
**定位**：把销量预测与周需求计划锁成同一长度的两条固定周期；补货只认显式采用位。周方案用近窗 `U`（截止昨天）× 已发布月形状，不再每周重算并发布 12 个月预测。  
**修订**：`2026-09-21-demand-plan-pilot-design.md` 的地平线（12 月 / `YYYY-MM`）、近窗截止（上月末）、环境开关即消费。预测生成公式（V4.1）不改；时间轴日余额公式不改。

**关联**：

- [2026-09-21-demand-plan-pilot-design.md](./2026-09-21-demand-plan-pilot-design.md) — 需求计划通路
- [2026-09-21-sales-based-demand-reconstruction-design.md](./2026-09-21-sales-based-demand-reconstruction-design.md) — 近窗还原 `U`
- [2026-09-17-inventory-timeline-daily-engine-design.md](./2026-09-17-inventory-timeline-daily-engine-design.md) — 日消费
- [2026-08-10-forecast-start-month-backtest-design.md](./2026-08-10-forecast-start-month-backtest-design.md) — 训练截断上月末
- 现网：`FORECAST_GENERATION_MONTH_OPTIONS = [3, 6, 12]`、`demand_plan_monthly.period`、`resolvePlanningDemandFromInputs`、`effectiveRecentWindowEnd`

用户确认：C 方案；月/周并行；发布 ≠ 采用；周期仅 6 个月与 26 周。

---

## 1. 背景与目标

跨境补货看 90–180 天。现网预测可生成 3 / 6 / 12 个月（API 默认 12，页默认 6）；需求计划 `horizon_months` 默认 12、按月存日均。周导入实销后，已发布月预测不更新，生成预测的近窗又截在上月末，半月销量变化进不了补货。

目标：

> 月方案固定 6 个自然月，周方案固定 26 个 ISO 周。两条都覆盖约 180 天。人发布对照，人采用进补货；时间轴只读采用位。

成功标准：

- 新生成的月预测版本地平线恒为 6 个月；请求 3 或 12 被拒绝。
- 新生成的需求计划版本恒为 26 周；按 ISO 周取日均。
- 同一 `(project_group, warehouse_code)` 同时最多一个采用位：`forecast` 或 `demand_plan`。
- 发布月预测不改采用位。发布周计划可以只发布、也可以发布并采用。
- `DEMAND_PLAN_PILOT_ENABLED=false` 时一律回月预测（紧急回滚）。
- 规划用 `U` 的近窗截止为 **Asia/Shanghai 业务日昨天**；V4.1 生成仍用 `effectiveRecentWindowEnd`（未满月截上月末）。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 月预测周期 | **仅 6 个自然月**。去掉 3 / 12。开始月仍可选（回测）。 |
| 周需求周期 | **仅 26 个 ISO 周**（周一为周起点）。不是 52 周，也不是月日均冒充周。 |
| 对齐 | 月从开始月 1 日；周从含 asOf 的 ISO 周周一。长度约 180 vs 182 天，可接受。 |
| 周水平 | C：`U`（昨天截止的近 30/90 还原）× 已发布 6 月形状插值到周 × 仓占比 |
| 月水平 | 生成时冻结；训练近窗仍上月末 |
| 发布 vs 采用 | 两套都可 `published` / `pilot_published`。补货只读 `planning_demand_adoptions` |
| 采用粒度 | `project_group` × `warehouse_code`（沿用试点） |
| 无周计划行 | 回退月预测，flag `demand_missing_fallback_forecast`，需求不得为 0 |
| 当月剩余日再缩放 | **本期不做**（先落地 `U` × 形状） |
| 分层预测 | 不动（仍不接补货） |
| 健康灯 | 仍用现网预测/历史口径；决策看时间轴 |

---

## 3. 架构

```text
                    ┌─ 生成（上月末近窗）→ 发布 6 月 ─┐
日销历史 ──────────┤                                  ├─ Champion 形状 / 准确率
                    └─ 周导入后算 U（昨天）──────────┘
                                      ↓
                         生成 26 周需求计划草稿
                                      ↓
                         发布（可用） 和/或 采用（补货）
                                      ↓
                         resolvePlanningDemand
                           ├─ 采用 demand_plan 且有 26 周行 → week Map
                           └─ 否则 → 6 月 forecast Map
                                      ↓
                         getForecastDailyForDate（按月或按 ISO 周）
                                      ↓
                         projectDailyInventory（不改公式）
```

| 单元 | 职责 |
|------|------|
| 月预测生成 | `monthCount` 强制 6；公式不改 |
| `planningRecentWindowEnd` | 规划 `U` 用昨天；禁止复用 `effectiveRecentWindowEnd` |
| 周需求生成 | 26 周行写入 `demand_plan_weekly` |
| 采用位 | `planning_demand_adoptions`；resolver 第一关键字 |
| 日取值 | 月 Map 键 `YYYY-MM`；周 Map 键 `YYYY-Www` |

---

## 4. 周期与日历

### 4.1 常量

```text
FORECAST_HORIZON_MONTHS = 6
DEMAND_PLAN_HORIZON_WEEKS = 26
```

前后端、任务、走步回测新跑次共用。禁止再出现生成用 3/12、消费当 6 的分叉。

### 4.2 月地平线

与现网 `buildMonthlyForecastHorizon(asOf, 6)` 相同：从 `startMonth`（缺省当月 UTC）起连续 6 个 `YYYY-MM`。

历史已发布的 3 月 / 12 月版本：**只读**。列表标注「历史周期」。不得再生成同长度新版本。采用位为 `forecast` 时，仍取该 SKU **最新 published** 版本（可能仍是旧 12 月）；新发布必须是 6 月。

### 4.3 周地平线

- 周历：ISO 8601，周一为第一天。
- 键：`YYYY-Www`，周号两位，如 `2026-W39`。
- `asOf`：Asia/Shanghai 当日。`startWeek` = 包含 `asOf` 的 ISO 周。
- 26 周：`startWeek` 起连续 26 个周（含当周）。第 26 周结束日约为 asOf 所在周周一 + 181 天。

跨年周（如 `2026-W01` 含 12 月尾巴）按 ISO 年号，不按自然年切开。

### 4.4 日取值

```text
若 demandMap 为周：
  daily(d) = map[isoWeekKey(d)]，缺周则 fallbackDaily
若 demandMap 为月：
  daily(d) = 现网 getForecastDailyForDate（YYYY-MM + 同月跨年兜底）
```

一周内 7 天同一日均。禁止把 26 周再摊成另一套月预测写入 `sales_forecast_monthly`。

---

## 5. 数据模型

### 5.1 月预测约束（改代码，不改表）

| 位置 | 现网 | 本期 |
|------|------|------|
| `FORECAST_GENERATION_MONTH_OPTIONS` | `[3, 6, 12]` | 删除下拉；常量 6 |
| `MAX_FORECAST_MONTH_COUNT` | 12 | **6** |
| `POST /api/sales-forecasts/generate-baseline` `monthCount` | 1–12，默认 12 | **必须为 6**（缺省 6；其他值 400） |
| `generateBaselineForecastVersion` | `monthCount ?? 12` | `6` |
| 走步回测 | `clamp(1, 24)` | 新跑次固定 6 |

`FORECAST_HORIZON_FUTURE_MONTH_OPTIONS`、抽屉「战略 6–12 月」文案改为只覆盖 1–3 / 3–6。历史销量月数 `DRAWER_HISTORY_MONTH_COUNT = 24` 不动。

### 5.2 `demand_plan_versions` 增列

| 字段 | 类型 | 说明 |
|------|------|------|
| start_week | varchar(8) 可空→新行必填 | 地平线首周 `YYYY-Www` |
| horizon_weeks | int 可空→新行 = 26 | 固定 26 |

旧行仅有 `start_month` / `horizon_months`：归档，**不可采用**。新生成不再写 12 个月 `demand_plan_monthly` 作为补货输入。

同一 `(project_group, warehouse_code)` 仍最多一个 `pilot_published`。

### 5.3 `demand_plan_weekly`（新表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| version_id | uuid FK | → `demand_plan_versions` |
| sku_id | uuid FK | |
| warehouse_code | varchar(50) | 与版本仓一致 |
| period | varchar(8) | `YYYY-Www` |
| system_daily_avg | numeric(12,4) | |
| manual_daily_avg | numeric(12,4) 可空 | 有则必填 `adjust_reason` |
| adjust_reason | text 可空 | |
| unconstrained_recent_daily | numeric(12,4) | 生成时 `U` |
| champion_forecast_daily | numeric(12,4) | 该周由月形状插值再 × share |
| source | varchar(30) | `reconstructed_shape` / `calendar_recent` / `fallback_forecast` / `manual` |
| created_at / updated_at | timestamptz | |

唯一：`(version_id, sku_id, warehouse_code, period)`。  
生效日均：`coalesce(manual_daily_avg, system_daily_avg)`。

`demand_plan_monthly` 保留只读历史，生成路径不再插入。

### 5.4 `planning_demand_adoptions`（新表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| project_group | varchar(20) | |
| warehouse_code | varchar(50) | |
| source | varchar(20) | `forecast` \| `demand_plan` |
| demand_plan_version_id | uuid 可空 | `source=demand_plan` 时必填，且该版本 `pilot_published`、组仓匹配、含 26 周行 |
| adopted_at | timestamptz | |
| adopted_by | uuid 可空 | |
| updated_at | timestamptz | |

唯一：`(project_group, warehouse_code)`。  
缺行视为 `source=forecast`（与试点关开关同义，便于未点过采用的仓）。

采用 `demand_plan` 时，该圈每个将进补货的 SKU 必须能读到已发布月预测，且地平线能覆盖周起点所在月起连续 6 个 `YYYY-MM`（旧 12 月版取前 6 个月即可；仅 3 个月的历史版视为形状不足）。形状不足的 SKU 不写周行；若一版有效周行过少，**禁止采用**（避免半圈周、半圈月）。

---

## 6. 周需求生成（C）

试点圈选取、SPU 全进全出、仓占比、生命周期跳过：仍按 09-21 §4 / §6.1 / §6.4。

### 6.1 规划近窗 `U`

**新函数** `planningRecentWindowEnd(asOf)`：Asia/Shanghai 日历的 `asOf` 前一天。  
禁止在规划路径调用 `effectiveRecentWindowEnd`。

`U` 计算沿用 [销量还原 §4](./2026-09-21-sales-based-demand-reconstruction-design.md)，但窗口终点改为 `planningRecentWindowEnd`：

- 主力（日历近 90 日均 ≥ 1，非新品/间歇）：连续 ≥7 天零销则 `U = min(sum/有效天数, 1.5×日历日均)`；有效天数 &lt; 30% 不还原。
- 否则 `U` = 日历近 90 / 90，`source=calendar_recent`。
- 当月已过天数 &lt; **7**：不算 MTD 爆发，仍用上述近 90（本月权重自然偏小）。不另做当月剩余日缩放。

V4.1 / 走步 / 校准继续 `effectiveRecentWindowEnd`。

### 6.2 月形状 → 周

读该 SKU 最新已发布月预测 6 个月 `effectiveDailyAvg`（`manual ?? forecast`），得 `F_m`。  
`F_ref` = 前 3 个 &gt;0 月的均值（现网 `championRefLevel`）。无预测行：不生成周行，回退月预测。

对每个 ISO 周 `w`：

```text
shape_w = 该周 7 个自然日对应 F_m / F_ref 的日加权平均
          （跨月周按落在各月的天数加权；缺月当 0，不把 F_ref 摊进空月）
shape_w = clip(shape_w, 0.5, 2.0)     // F_ref≤0 则 shape_w=1
share   = 目的仓销售占比
system_daily_avg_w = U × share × shape_w
champion_forecast_daily_w = （该周日加权 F_m）× share
```

沿用 `systemDailyAvgForMonth` 的乘子，把 `monthForecastDaily` 换成周加权 `F_w`。

### 6.3 人工

仅草稿可改 `manual_daily_avg`。已 `pilot_published` 需新版本。

---

## 7. 发布、采用、消费

### 7.1 动词

| 动作 | 结果 |
|------|------|
| 发布月预测 | `sales_forecast_versions` → `published`。Champion / 准确率更新。**不改采用位** |
| 发布周计划 | 该组×仓旧 `pilot_published` → `archived`；本版 `pilot_published`。采用位不变 |
| 发布并采用周计划 | 先发布，再 upsert 采用位 `demand_plan` + 本版 id |
| 采用月预测 | 采用位 `forecast`，`demand_plan_version_id` 清空。周计划仍可保持 `pilot_published` 供对照 |
| 归档周计划 | 若采用的是该版：采用位改 `forecast` |

页面两个按钮：「发布」「发布并采用」。不允许「未发布就采用」。

### 7.2 `resolvePlanningDemand`

输入：`skuId`, `warehouseCode`。  
`inPilot` 改为：

```text
enabled = DEMAND_PLAN_PILOT_ENABLED
adoption = 该 sku.project_group × warehouse 的采用行（无行 → forecast）
useWeekly = enabled
  and adoption.source = demand_plan
  and 版本 pilot_published
  and 该 sku 有 26 周行
  and 非跨组 SPU
  and 有仓占比
```

| 条件 | source | demandMap |
|------|--------|-----------|
| `useWeekly` | `demand_plan` | 26 周生效日均 |
| enabled 且想用周但无行/无占比/跨组 SPU | `forecast` + 原 flags | 月 Champion（仓未拆的站预测 Map，与现网一致） |
| 未启用或采用 `forecast` | `forecast` | 月 Champion |

`championMap`：始终给仓口径月预测影子（6 月键），规划页对照。  
`fallbackDaily`：周命中用 26 周正值近 3 周均值；否则月 Map 近 3 月均值。

`pickDemandMapForTimeline` 按 `source` 选 Map。`getForecastDailyForDate` 增加周键重载或按 Map 键形选择。

调用点不变：时间轴、补货任务、预警、SKU 规划详情。禁止任务直接 `loadMergedPublishedForecastBySkuIds` 当需求。

### 7.3 紧急回滚

`DEMAND_PLAN_PILOT_ENABLED=false`：resolver 忽略采用位，全部 `forecast`。不删采用行、不改周版本。

---

## 8. 页面

1. **销量预测生成**：去掉「预测月数」；文案「固定 6 个月」。开始月保留。  
2. **需求计划页**：矩阵改为 26 周列；按钮「发布」「发布并采用」「采用月预测」。展示当前采用位。  
3. **SKU 规划页**：`source`、采用位、决策缺货日/建议量、月 Champion 影子。  
4. **预测页提示**：该组×仓若采用周计划，「改月预测不改该仓建议，除非改回采用月预测」。

不做周准确率门禁、不做 15–180 新驾驶舱。

---

## 9. 触发（本期最小）

- 周计划：**手工**在需求计划页生成（导入销量后由人点）。导入成功自动排队生成作为后续，不阻塞本期。  
- 月预测：仍手工生成/发布。  
- 补货任务继续读 resolver；每日流水线是否去掉补货生成不在本期（另开周作业 spec）。

---

## 10. 风险与回滚

| 风险 | 处理 |
|------|------|
| 半截月噪声抬高 26 周 | 1.5× 日历封顶；形状 0.5–2.0；当月 &lt;7 天不另放大 |
| 月发布误切补货 | 发布月不改采用位 |
| 旧 12 月预测仍被采用位 `forecast` 读到 | 接受直到该 SKU 新发 6 月版；列表标历史周期 |
| 旧月粒度需求计划被采用 | 无 26 周行则不可采用，resolver 回月 |
| 开关误开全量 | 默认 `false`；采用仅组×仓 |

回滚：关 `DEMAND_PLAN_PILOT_ENABLED` 或「采用月预测」。

---

## 11. 明确不做

- 恢复 3 / 12 月生成；52 周；周工作台改月预测表  
- 把周计划写入 `sales_forecast_monthly`  
- 改 V4.1 / `effectiveRecentWindowEnd`  
- 当月剩余日缩放、大促日历、自动导销量后生成  
- 分层预测地平线、全库一个采用开关  
- 健康灯改吃周计划、自动转 PMC  
- 周 WMAPE 发布门禁  

---

## 12. 验收清单

- [ ] 生成月预测：只能得到 6 个月；`monthCount=3|12` → 400  
- [ ] 生成周计划：每 SKU×仓恰好 26 个 `YYYY-Www`，首周含 asOf  
- [ ] 发布月预测后，已采用周计划的圈 `source` 仍为 `demand_plan`  
- [ ] 「发布」周计划后采用位仍为 `forecast`；「发布并采用」后时间轴/补货为周 Map  
- [ ] 「采用月预测」后 `source=forecast`，周版本可仍为 `pilot_published`  
- [ ] 开关 off：抽样建议量/缺货日与 Champion 路径一致  
- [ ] 无周行 / 无占比：回退月预测且有 flag，无 0 需求假缺货  
- [ ] 1 月 15 日生成周计划：`U` 含 1 月 1–14 日实销；同日生成月预测：近窗仍截 12 月 31 日  
- [ ] 跨月 ISO 周形状为日加权，单测固定日历  

---

## 13. 实现落点（供 plan）

- 常量：`forecast-limits.ts`、`forecast-horizon-meta.ts`、`sales-forecast.ts` 校验、`forecast-collaboration.ts` 默认地平线  
- Schema：`demand_plan_weekly`、`planning_demand_adoptions`、versions 增 `start_week` / `horizon_weeks`  
- 纯函数：`planningRecentWindowEnd`、ISO 周键、月形状→周加权、`getForecastDailyForDate` 周重载、resolver 改读采用位  
- 生成：`demand-plan-service` 写 weekly 26 行，停写新 monthly 补货行  
- API：采用 / 发布并采用；生成 baseline 拒绝非 6  
- UI：预测页去月数；需求计划 26 周 + 采用  
- 测试：周期拒绝、26 周长度、采用不随月发布变化、`U` 昨天 vs 上月末对照、开关 off 回归  

实施可切两刀：先锁 6 个月（无行为风险）；再上周表 + 采用位 + 规划近窗。
