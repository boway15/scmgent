# 需求计划试点（通路验证）设计

**版本**：v1.0（2026-09-21）  
**定位**：冻结现网销售预测模块，新建独立需求计划域；在**小项目组 × 单一目的仓**上让时间轴/补货/预警改吃需求计划（真消费切换）。本期验收通路（开关、对照、回滚），不追求一次打赢准确率。  
**不改** v2/V4.1 生成公式、不改预测发布流、不新建第二套库存时间轴。

**关联**：

- 期望文档：跨境电商库存智能管理与供需决策系统 V1.0（S&OP：预测 ≠ 需求计划）
- `docs/superpowers/specs/2026-09-17-inventory-timeline-daily-engine-design.md` — 日余额消费预测 Map
- `docs/superpowers/specs/2026-09-18-inventory-share-allocation-design.md` — 目的仓投影
- `docs/superpowers/specs/2026-06-29-sales-forecast-collaboration-design.md` — 现网预测（Champion，只读）
- 现网：`forecast-demand.ts`、`forecast-published-resolve.ts`、`inventory-timeline-service.ts`、补货/缺货任务
- **§6.2 修订**：[2026-09-21-sales-based-demand-reconstruction-design.md](./2026-09-21-sales-based-demand-reconstruction-design.md) — 无历史库存，近窗 `U` 改销量分档反推，快照只用于仓份额

用户确认：供应 A/B 选 **C（试点圈时间轴改吃需求计划）**；第一期项目组选 **C（先小圈跑通路）**。

---

## 1. 背景与目标

现网闭环是「已发布销售预测 → 时间轴日需求 → 补货/预警」。预测已试用、有借鉴价值，但历史销量 ≠ 真实需求，且预测未经质量门禁即进入供应计算。

S&OP 目标要把 **需求计划** 插在预测与时间轴之间。本期只打通这一插口的最小闭环：

> 指定项目组 + 指定仓：规划引擎从需求计划取日需求；其余 SKU/仓仍从已发布预测取日需求。关掉开关后行为与现网完全一致。

成功标准（通路，非准确率）：

- 配置关闭时：补货量、缺货日、预警与改造前一致（回归）。
- 配置开启且该圈有已发布需求计划：时间轴、补货任务、缺货预警、SKU 规划页 **同一** `resolvePlanningDemand`。
- 规划页同时展示 Champion 影子（若仍用预测的缺货日/建议量），不参与下单计算。
- 同一 `spu_id` 在试点仓内全进或全出，禁止半套颜色。
- 关闭开关或归档需求计划版本后，该圈立即回到已发布预测。

---

## 2. 决策摘要

| 项 | 选择 |
|----|------|
| 现网预测 | **冻结**：生成、复核、发布、准确率页不改公式；预测页提示试点圈补货不再听预测改数 |
| 需求域 | 新表 `demand_plan_*`，禁止把需求计划写入 `sales_forecast_monthly` |
| 试点粒度 | `skus.project_group` ∈ 配置列表 **且** `warehouse_code` ∈ 配置列表 |
| 第一期默认仓 | **仅 `US-WEST`**（最小爆破半径；US-EAST/DE/UK 仍吃预测） |
| 第一期项目组 | 配置填入；选取规则见 §4（SKU 少、有销量、有快照、SPU 完整） |
| 需求 v0 | 有货日还原近窗水平 × 已发布预测的季节形状，再按仓占比拆到目的仓 |
| 消费 | `resolvePlanningDemand(skuId, warehouseCode)` → `{ dailyByMonth, source, championDailyByMonth }` |
| 驱动范围 | 时间轴、建议补货量、缺货预警、`uncoverableByNewPo`、SKU 规划计算 |
| 不驱动 | 覆盖天数健康灯口径不变（页上标注非试点决策口径）；PMC 不自动转跟单 |
| 紧急出货/调拨 | 本期不做 |
| SKU 继任图 / 流量广告 | 本期不做 |
| 开关默认 | **off** |

---

## 3. 架构

```text
销量历史 + 库存日快照          已发布 sales_forecast（只读）
        \                      /
         生成 demand_plan 草稿
                 ↓
         人工修正（可选）
                 ↓
         试点发布 demand_plan_versions
                 ↓
        resolvePlanningDemand
         ├─ 试点命中 → demand Map
         └─ 否则     → forecast Map
                 ↓
     projectDailyInventory（现网，不改公式）
                 ↓
     规划页 / 补货任务 / 缺货预警
```

| 单元 | 职责 | 不做什么 |
|------|------|----------|
| `demand-plan-generate` | 按试点 SKU 生成月度日均需求行 | 不调用、不修改 `generateBaselineForecast*` |
| `demand-plan-publish` | 草稿 → `pilot_published` | 不改 `sales_forecast_versions.status` |
| `resolvePlanningDemand` | 统一需求入口 | 不在各任务里分叉 if |
| `buildSkuWarehouseTimeline` | 把 `forecastMap` 换成 resolver 结果 | 不改 `projectDailyInventory` 日余额公式 |
| 规划页影子列 | 用 Champion Map 再跑一次纯函数时间轴 | 不写第二套 lots |

现有路由前缀保留。新增 `/api/demand-plans*`。库存规划 API 扩展对照字段，不改 URL。

---

## 4. 试点圈选取规则

配置项一律环境变量（关停不依赖页面；不新建系统配置表）：

| 键 | 含义 | 第一期 |
|----|------|--------|
| `DEMAND_PLAN_PILOT_ENABLED` | 总开关 | `false` |
| `DEMAND_PLAN_PILOT_PROJECT_GROUPS` | 逗号分隔，匹配 `skus.project_group` 精确值 | 人工填一组，如 `项目6组` |
| `DEMAND_PLAN_PILOT_WAREHOUSES` | 逗号分隔仓码 | `US-WEST` |

**小圈合格条件（实施前用查询选定，写入配置，不写死在代码）：**

- `project_group` 非空，活跃 SKU 建议 **20～80**（少于 20 对照噪声大，多于 80 不像通路试点）。
- 所选 SKU 近 90 天有销量，且 `US-WEST` 有库存快照或分仓占比。
- 组内 `spu_id` 为空的 SKU：仍按 SKU 进圈，但规划页标记「无 SPU，换色迁移不保证」。
- 组内有 `spu_id` 的：该 SPU 在 **本项目组 ∩ 本仓** 的全部活跃 SKU 必须同时命中配置；若 SPU 成员跨两个项目组，**整 SPU 不进试点**（写入生成日志，避免半套颜色）。

命中判定伪代码：

```text
inPilot = ENABLED
  and sku.project_group in PROJECT_GROUPS
  and warehouse in WAREHOUSES
  and sku 未被「跨组 SPU」排除
  and 存在 status=pilot_published 的需求计划行覆盖该 sku
```

无需求计划行时：**回退 Champion 预测**，并在规划页显示 `demand_missing_fallback_forecast`，避免试点仓需求变 0 导致假缺货。

---

## 5. 数据模型

### 5.1 `demand_plan_versions`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| version_no | varchar(50) unique | 如 `DP-20260921-01` |
| version_name | varchar(200) | |
| status | enum | `draft` / `pilot_published` / `archived` |
| start_month | varchar(7) | 地平线首月 `YYYY-MM` |
| horizon_months | int | 默认 12（覆盖 180 天滚动） |
| project_group | varchar(20) | 本版本绑定的试点项目组 |
| warehouse_code | varchar(50) | 本版本绑定仓，第一期 `US-WEST` |
| published_at | timestamptz | |
| created_by / published_by | uuid | |
| created_at / updated_at | timestamptz | |

同一 `(project_group, warehouse_code)` 同时最多一个 `pilot_published`。新发布自动把旧的改为 `archived`。

### 5.2 `demand_plan_monthly`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| version_id | uuid FK | |
| sku_id | uuid FK | |
| warehouse_code | varchar(50) | 与版本仓一致 |
| period | varchar(7) | `YYYY-MM` |
| system_daily_avg | numeric(12,4) | 系统需求日均 |
| manual_daily_avg | numeric(12,4) 可空 | 人工覆盖 |
| adjust_reason | text 可空 | 有 manual 则必填 |
| unconstrained_recent_daily | numeric(12,4) | 还原近窗日均（审计） |
| champion_forecast_daily | numeric(12,4) | 生成时快照的预测日均 |
| in_stock_day_ratio | numeric(8,4) | 近窗有货日占比 |
| source | varchar(30) | `reconstructed_shape` / `fallback_forecast` / `manual` |
| created_at / updated_at | timestamptz | |

生效日均：`coalesce(manual_daily_avg, system_daily_avg)`。  
唯一：`(version_id, sku_id, warehouse_code, period)`。

不在本期新建「还原需求日事实表」的独立产品；还原结果写入上述审计字段即可。日序列仍按现网 `getForecastDailyForDate` 用月日均展开。

---

## 6. 需求 v0 生成规则

对试点圈每个活跃 SKU：

### 6.1 仓需求份额

与规划分仓同源：用周转/快照占比把「全站需求水平」拆到 `US-WEST`。无占比则该 SKU **不生成需求行**（命中回退预测，见 §4），禁止把 ALL 站预测日均 100% 灌进西仓。

### 6.2 未约束近窗水平 `U`

窗口：与预测一致的 `effectiveRecentWindowEnd` 起近 90 天。

近窗未约束水平 `U` **不再用库存有货日**（无可用历史库存）。改走销量分档反推，规则见 [sales-based-demand-reconstruction](./2026-09-21-sales-based-demand-reconstruction-design.md) §4：

- 主力（日历近 90 日均 ≥ 1，且非新品/间歇）：连续 ≥7 天零销视为疑似缺货，`U = min(sum/有效天数, 1.5×日历日均)`；有效天数 &lt; 30% 窗口则不还原。
- 长尾 / 新品 / 间歇：`U` = 日历近 90 天销量/90。
- 库存日快照 **只用于 §6.1 仓份额**，不定义缺货日。

`source`：发生还原为 `reconstructed_shape`；未还原仍用日历日均时为 `calendar_recent`（通路可跑）。无仓份额仍按 §6.1 不生成需求行、回退预测。

### 6.3 形状来自 Champion 预测

读该 SKU 最新已发布预测的月度 `effectiveDailyAvg`（`manual ?? forecast`），得到各月 `F_m`。  
全站水平 `F_ref` = 预测地平线内前 3 个已有月的均值；若无预测行，整 SKU `fallback_forecast` 且不进试点计算（回退）。

仓月需求：

```text
share = US-WEST 占比（0~1）
shape_m = F_m / F_ref    （F_ref≤0 则 shape_m=1）
system_daily_avg_m = U × share × clip(shape_m, 0.5, 2.0)
```

clip 防止还原水平乘上极端季节把试点补货打爆。`champion_forecast_daily` 存 `F_m × share`（同等仓口径）便于对照。

### 6.4 生命周期与准入

- 现网 `forecast_skipped` / 无发布预测：不生成需求行，回退预测（通常也无预测）。
- 不在本期复制 intermittent/新品分支；形状已来自预测，水平来自还原。

### 6.5 人工

草稿可改 `manual_daily_avg`，必须 `adjust_reason`。试点发布后是否可改：仅草稿可改；已发布需新版本（避免补货任务读到半改数据）。

---

## 7. 消费与对齐

### 7.1 `resolvePlanningDemand`

输入：`skuId`, `warehouseCode`。  
输出：

- `demandMap`: `YYYY-MM → 生效日均`（给 `getForecastDailyForDate`）
- `source`: `demand_plan` | `forecast`
- `championMap`: 仓口径 Champion（规划页影子；无预测则空）
- `flags`: `pilot_hit` / `fallback_forecast` / `no_share` / `cross_spu_excluded`

`avgDaily` 回退（Map 缺月时）：试点命中用需求计划近 3 月生效均值；否则保持现网历史/预测回退。

### 7.2 必须改调用点（同一函数）

- `buildSkuWarehouseTimeline`
- 补货预测任务里组时间轴/建议量的路径
- 缺货预警任务里组时间轴的路径
- `GET` SKU 规划详情

禁止只改页面、任务仍 `loadMergedPublishedForecastBySkuIds`。

### 7.3 健康灯

`computeSkuWarehouseHealth` 本期 **仍用现网需求口径**（预测或历史）。规划页文案：健康灯非试点决策；缺货日/建议量以时间轴为准。避免一次改两套灯导致「通路」无法对比。

### 7.4 PMC

补货建议可出现在试点圈，**不自动确认计划、不自动生成跟单**（与现网一致：仍要人工采纳）。试点文案增加：建议来源 `demand_plan`。

---

## 8. 页面与提示

1. **需求计划试点页**（新）：选项目组/仓、生成草稿、矩阵（系统/人工/Champion 仓口径）、发布/归档。不做完整预测工作台复制。
2. **SKU 规划页**：展示 `source`、缺货日（决策）、影子缺货日（预测）、建议量两列、有货日占比。
3. **销量预测页**：若当前 SKU 的 `project_group` 在试点配置中，只读提示「US-WEST 补货已改吃需求计划，此处改预测不会改变该仓建议」。

不做新管理层 15–180 驾驶舱。

---

## 9. 对照与快照

每次试点发布或每周任务（可与补货任务同日）写入只追加表 `demand_plan_pilot_snapshots`：

| 字段 | 说明 |
|------|------|
| captured_at, version_id, sku_id, warehouse_code | |
| stockout_date_demand / stockout_date_forecast | 决策 vs 影子 |
| suggested_qty_demand / suggested_qty_forecast | |
| unconstrained_recent_daily, champion_forecast_daily | |
| in_stock_day_ratio | |

本期不做自动胜负判定。通路验收看：快照能写出、开关 off 后建议量回到改造前抽样 SKU。

---

## 10. 风险与回滚

| 风险 | 处理 |
|------|------|
| 还原抬高需求 → 建议采购偏多 | PMC 人工采纳；clip 季节；小圈 |
| 无快照 SKU 当试点 | fallback + 数据风险标记 |
| 运营改预测以为能改补货 | 预测页提示 |
| US-WEST 试点、US-EAST 仍预测 | 接受（通路）；同一 SKU 两仓数字会不一致，页上标明仓 |
| 开关忘关 | 默认 false；发布环境须显式打开 |

回滚：`DEMAND_PLAN_PILOT_ENABLED=false` 或归档 `pilot_published`。不删表、不改预测数据。

---

## 11. 明确不做（本期）

- 修改 `forecast-baseline` / 协作生成 / 分层预测写回
- 需求计划驱动非试点仓
- 紧急出货、调拨、暂缓发货博弈
- 商品族预测主粒度（仅 SPU 全进全出约束）
- 合成预测健康度门禁（有标记即可）
- 网站式随机 50% SKU A/B
- 自动转 PMC 跟单

---

## 12. 验收清单

- [ ] 开关 off：抽样非试点 + 试点 SKU 的建议量/缺货日与改造前一致（或与 Champion 路径一致）
- [ ] 开关 on + 已发布需求计划：试点 `US-WEST` 规划/任务 `source=demand_plan`
- [ ] 同 SKU `US-EAST`（若存在）仍 `source=forecast`
- [ ] 无需求行或无占比：回退预测且有 flag，不出现需求 0 的假死缺货
- [ ] 跨项目组 SPU 被排除并打日志
- [ ] 规划页有影子缺货日；快照表有行
- [ ] 归档或关开关后任务回到预测

---

## 13. 实现落点（供后续 plan 用）

- Schema：`packages/db` 新表 + Drizzle
- 纯函数：`apps/web/server/lib/demand-plan-*.ts`（还原、shape、命中、resolve）
- 接入：`inventory-timeline-service.ts`、补货任务、预警任务、规划 API
- UI：需求计划试点页 + 规划页对照列 + 预测页提示
- 测试：命中/回退/SPU 排除/开关 off 回归；resolve 与时间轴用同一 Map 的单测
