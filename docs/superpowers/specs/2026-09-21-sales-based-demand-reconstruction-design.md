# 销量反推需求还原（阶段 A）设计

> **状态**：待评审  
> **日期**：2026-09-21  
> **范围**：把「历史销量 ≠ 真实需求」做成可计算的近窗/月训练口径；不改 v2/V4.1 结构公式，只换它们吃的近端水平与月序列清洗。  
> **前置**：需求引擎分析（销量预测 → 真实需求 → 修正 → 回测）；本文件只覆盖阶段 A。

**关联**

- [2026-06-29-sales-forecast-collaboration-design.md](./2026-06-29-sales-forecast-collaboration-design.md) — 现网预测工作台
- [2026-06-30-forecast-v2-optimization-design.md](./2026-06-30-forecast-v2-optimization-design.md) — 生命周期 / 分层
- [2026-09-21-demand-plan-pilot-design.md](./2026-09-21-demand-plan-pilot-design.md) — 需求计划试点（§6.2 原写库存快照还原；**以本文为准修订**，见 §8）

---

## 1. 已锁定决策

| 项 | 选择 | 原因 |
|----|------|------|
| 缺货证据 | **销量连续零销**，不用库存日快照回填历史 | 快照无 2024–2025 历史；用空库存外推是编数据 |
| 分档 | **S 分档** | 主力才还原；长尾零销多半是卖不动 |
| 主力阈值 | 还原前日历近 90 日均 **≥ 1**（腰部 + 核心） | 与准确率分层「长尾 &lt;1/日」对齐 |
| 零销阈值 | 主力连续 **≥ 7** 天销量为 0 | 与现 `collectStockoutExcludedDates` 一致 |
| 新品 / 间歇 | **不还原** | 零销是形态，不是缺货 |
| 库存快照 | 继续每日落库，**本期不参与还原** | 留给 12 个月后的校准，不两套口径同时训模型 |
| 大促压顶 | 阶段 A **不做** | 避免家具大促被 2σ 削掉 |
| 商品族 / 流量 / 合成健康度 | 不在阶段 A | 依赖还原账先算对 |

做不到、必须写进产品文案：

- 部分断货（残库存、断色）推不出来。
- 「卖了 100、不断货 180」没有库存日历就得不到 180；最多得到「按有销日折算」的下限（例如 100/70×90）。

---

## 2. 问题：现网「剔除断货日」几乎无效

`collectStockoutExcludedDates` 会标出连续 ≥7 天销量为 0 的日期，随后 `filterSalesRowsExcludingDates` 丢掉这些行，但日均仍是：

```text
sum(qty) / 90
```

零销行分子本就是 0，丢掉后分子不变，分母仍是 90，**近窗日均仍被缺货压低**。方法论里写的「窗口剔除后再算日均」与实现不一致。

阶段 A 的核心修正：**合格 SKU 用非缺货天数作分母**。

---

## 3. 目标与验收

### 3.1 目标

1. 主力 SKU 近 30/90 日均反映「有销日水平」，而不是日历日均。
2. 长尾、新品、间歇、有效天数不足者不放大需求。
3. 原始销量可对账；还原只用于预测训练与「模型回测」。
4. 生成结果可解释：每个 SKU 能看到是否还原、缺货天数、倍数、封顶。

### 3.2 验收（可离线用已有日销表复算，不必先改 UI）

| 用例 | 期望 |
|------|------|
| 主力：90 天卖 100，连续 20 天为 0，其余天有销 | `U_90 ≈ 100/70`，且 `U_90 ≤ 1.5 × (100/90)` |
| 长尾：日历近 90 日均 0.4，连续 14 天为 0 | **不还原**，仍用 `sum/90` |
| 间歇 / 新品 | 不还原 |
| 主力但有效天数 &lt; 30% 窗口 | 不还原，打标 `coverage_insufficient` |
| 现网回归 | 未命中还原规则的 SKU，近窗与改前一致（仍 ÷30/÷90） |

走步回测：主力层同时报 **vs 实际销量 WMAPE** 与 **vs 还原需求 WMAPE**（后者仅对发生还原的月/SKU）。不要求一次打赢准确率；要求缺货段不再把模型「高估」当成唯一故事。

---

## 4. 规则（纯函数）

窗口与现网一致：`effectiveRecentWindowEnd` 起近 30 / 近 90 自然日。站点、平台过滤与现网预测生成相同。

先用 **未还原** 序列算：

- `calendar_daily_90 = sum_90 / 90`
- `calendar_daily_30 = sum_30 / 30`
- `lifecycle = classifySalesLifecycle(...)`（现网，输入仍为未还原近窗）
- `volume_ok = calendar_daily_90 ≥ 1`

### 4.1 是否还原 `should_unconstrain`

同时满足才还原该窗口：

1. `volume_ok`
2. `lifecycle` 不是 `new`、`intermittent`
3. 窗口内存在至少一段「首销之后、连续 ≥7 天 qty=0」
4. `effective_days / window_days ≥ 0.3`

否则 `U = calendar_daily`，`reconstructed = false`。

上市前空白（首销日之前的零销）**不算**缺货。

### 4.2 还原公式

```text
stockout_days     = 窗口内疑似缺货日天数
effective_days    = window_days − stockout_days
raw_U             = sum(qty in window) / effective_days
U                 = min(raw_U, 1.5 × calendar_daily)
```

`sum` 仍含全部日历日销量（缺货日为 0，不影响分子）。  
近 30、近 90 **各自**按本窗口重算缺货日与有效天数，不要用 90 天的缺货日去改 30 天分母。

倍数封顶 1.5：避免有效天数刚过 30% 时需求被放大超过 3 倍。命中封顶时标记 `capped`。

### 4.3 月训练序列

仅对 `should_unconstrain` 在「该月所属近窗逻辑」下为真、且该月存在 ≥7 天连续零销的月份：

```text
selling_days      = 该月天数 − 该月疑似缺货天数
month_U_qty       = (该月销量合计 / selling_days) × 该月日历天数
cleaned_qty       = min(month_U_qty, 1.5 × 该月原始销量)
```

`selling_days = 0`：不填品类均值；保持原始 0，并标 `stockout_full_month`（停售/长期断货不应被填成仍有需求）。

**不做**：整月 0 用品类均值填充；高于均值+2σ 当大促压顶（现 `cleanMonthlyQtyForTraining` 的 promo 分支阶段 A 对预测主路径停用或跳过；C 类池若仍调用该函数，promo 压顶同样关掉，只保留与本文一致的零销处理）。

### 4.4 生命周期与准入

- 判定生命周期、准入（`forecast-eligibility`）继续用 **未还原** 近窗，避免还原后把缺货 SKU 判成 growth。
- `stockout_suspected` 仍可按现网规则打标（最长零销 ≥7 等）；还原成功时复核文案改为「已按有销日折算近窗，仍可能低估部分断货」。
- `growth_factor` 上限对 `stockout_suspected` 的现网限制（≤1.0）保留：还原解决近端压低，不自动当成高增长。

### 4.5 写入预测

`recent30DailyAvg` / `recent90DailyAvg`（及依赖它们的 `near_level`）对还原成功的 SKU 改用 `U_30` / `U_90`。  
`horizon_factors`（或等价快照 JSON）增加审计字段，不另建日事实表：

| 键 | 含义 |
|----|------|
| `demandReconstructed` | boolean |
| `stockoutDays90` | int |
| `effectiveDays90` | int |
| `calendarDaily90` | 还原前日均 |
| `unconstrainedDaily90` | U |
| `reconstructCapHit` | boolean |
| `reconstructSkipReason` | `tail` / `new` / `intermittent` / `no_run` / `coverage_insufficient` / 空 |

走步回测与线上生成必须走同一函数。

---

## 5. 回测口径

| 名称 | 实际侧 | 用途 |
|------|--------|------|
| 经营回测 | 原始 `qty_sold` 折日均 | 卖了多少、补货有没有货 |
| 模型回测 | 若该月 `cleaned_qty` 存在则用还原月销量折日均，否则原始 | 近端有没有学对 |

缺货月经营回测出现「高估」可以接受，不作为唯一调参信号。

不在阶段 A 做误差类型全画像（季节/换码/价格等）。最多增加：`stockout_underestimate_risk`（发生还原或 `stockout_full_month`）。

---

## 6. 非目标

- 不把 `inventory_daily_snapshots` 接入预测分母。
- 不新建独立需求日事实产品表（审计进 `horizon_factors` 即可）。
- 不改人工 `manual_daily_avg`、发布流、补货消费函数签名。
- 不做 SPU 需求迁移、流量×转化、合成健康度、15/30/45 天滚动计划切片。
- 不把阶段 A 做成「需求计划替代预测」；需求计划试点若要取 `U`，调用本文同一纯函数。

---

## 7. 实现落点（评审通过后再写计划）

| 模块 | 变化 |
|------|------|
| `forecast-baseline.ts` | 抽出 `unconstrainRecentDaily`（或并列模块）；修正分母；单测覆盖 §3.2 |
| `forecast-collaboration.ts` / `forecast-sku-context.ts` / `forecast-profile-calibration.ts` / `forecast-a-class-calibration.ts` | 近窗改走同一函数，禁止各抄一份 ÷90 |
| `forecast-monthly-clean.ts` | 与 §4.3 对齐；去掉或关闭预测路径上的 promo 2σ 压顶 |
| `forecast-walkforward-backtest.ts` | 双口径汇总可选 |
| `forecast-methodology.ts` | 文档与实现一致：有效天数分母 + 分档 |

---

## 8. 对需求计划试点设计的修订

[2026-09-21-demand-plan-pilot-design.md](./2026-09-21-demand-plan-pilot-design.md) §6.2 原文：有快照则 `有货日销量/有货天数`，无快照则日历日均，**不用**连续零销。

在无历史库存的前提下该条不成立。修订为：

- 试点 `U` = 本文 §4 的 `U_90`（站点级，再按现网仓占比拆到 `US-WEST`）。
- `in_stock_day_ratio` 改名为或并行 `effective_sales_day_ratio` = `effective_days/90`（销量启发式，不是仓存有货率）。
- 库存快照仍可用于 **仓份额**（§6.1），不用于定义缺货日。

通路试点的开关、表结构、消费切流可以不变。

---

## 9. 后续（明确不在本期）

- 快照连续满 12 个月后：抽样对比「销量启发式 U」与「仓存有货日 U」，再决定是否切换主力口径。
- 阶段 B：SPU / SKU 继任。
- 阶段 C：健康度驱动补货权重、结构化人工对照回测。
