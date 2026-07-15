# 销量预测 v2 走步回测优化设计（方案 C）

> **状态**：草案，待评审  
> **日期**：2026-06-30  
> **前置**：[2026-06-29-sales-forecast-collaboration-design.md](./2026-06-29-sales-forecast-collaboration-design.md)  
> **依据**：全量走步回测 `asOf=2026-01-01`、6 个月、US/ALL（8,934 SKU，50,121 准确率行）

## 1. 背景与问题陈述

### 1.1 走步回测结论摘要

| 指标 | 全量（算术均） | 有销量行、销量加权 |
|------|----------------|-------------------|
| 月均 MAPE | 336%–550% | **约 72%** |
| 月均偏差 | +22%–+64% | **+130%**（低估为主） |
| 高偏差行（MAPE>30%） | — | **75%**（11,655 / 15,521） |

| 结构问题 | 数量 | 占比 |
|----------|------|------|
| 6 个月全零销量 SKU | 4,458 | 53% |
| 有任意月份实际销量 SKU | 3,994 | 47% |
| 极低销量（&lt;1/日）SKU | 2,150 | — |

**三类根因**（评估层 → 覆盖层 → 算法层）：

1. **评估口径失真**：算术均 MAPE 被极低销量 SKU 拉高；缺销量分层 KPI。
2. **覆盖过宽**：所有 `isActive` SKU 均生成预测；零近期销量仍可能注入品类中位数。
3. **算法场景错配**：成熟 SKU 季节×趋势叠加导致高估；新品（DJ505 段）无历史导致低估；间歇 SKU 仍用连续模型。

### 1.2 业务优先级（方案 C 默认）

在 A（主力准）/ B（全覆盖）/ C（新品）中，**默认对齐 A**：补货主力 SKU（均实际 ≥5/日）预测质量优先；长尾可跳过或低置信；新品走独立通道。

### 1.3 非目标

- 不引入 ML / Dify 端到端替代 v2。
- 不为走步回测单独 fork 一套算法（与线上生成共用 `forecast-baseline.ts` + `forecast-collaboration.ts`）。
- 不在本阶段重做导入中心或销量宽表格式。

---

## 2. 目标与成功指标

### 2.1 分阶段目标

| 阶段 | 主题 | 交付 | 验收（走步回测同参数复跑） |
|------|------|------|---------------------------|
| **P0** | 准入 + 分层 KPI + 品类止血 | 少生成噪音 SKU；准确率可分层读 | 可比 SKU ↓约 50%；主力层 WMAPE 可度量 |
| **P1** | 间歇 / 新品规则 | 算法按生命周期分流 | 极低销量 WMAPE &lt;80%；新品偏差收敛 |
| **P2** | 成熟 SKU 因子调参 | 6组/2组 高估收敛 | 主力层 WMAPE **≤45%**；高偏差行 **≤50%** |
| **P3** | 产品化 | 准确率分层 UI、走步回测入口 | 运营无需跑脚本即可看分层 |

### 2.2 核心 KPI 定义

**销量分层**（按 6 个月均实际日均 `avg_actual_daily`）：

| 档位 | 条件 | 主指标 |
|------|------|--------|
| 主力 core | ≥5/日 | 加权 MAPE（WMAPE）、加权 bias |
| 腰部 mid | 1–5/日 | WMAPE |
| 长尾 tail | &gt;0 且 &lt;1/日 | WAPE 或「有销月份占比」 |
| 跳过 skipped | 准入未通过 | 不生成预测、不纳入回测 |

**偏差**：`bias_rate = (actual − forecast) / forecast`（负=高估，正=低估）。

**WMAPE**：`Σ(|forecast−actual|) / Σ(actual)`，仅 `actual_daily > 0` 行。

---

## 3. 方案 C 架构

```text
销量历史 ──► SKU 准入 (forecast-eligibility)
                  │
                  ├─ 跳过 → 复核项 forecast_skipped（info）
                  │
                  └─ 通过 → 生命周期分流
                              ├─ new      → 新品通道（near + ramp，禁远月 yoy）
                              ├─ intermittent → 间歇通道（封顶 / 无季节趋势）
                              └─ 其他     → v2 地平线模型（现有）
                                        │
                                        ▼
                              sales_forecast_monthly
                                        │
                    走步回测 / 月结准确率 ──► 分层汇总 API ──► 查询复盘 UI
```

**原则**：准入与算法补丁均为纯函数 + 生成链路钩子；走步回测 `runWalkForwardAccuracyBacktest` 与线上 `generateBaselineForecastVersion` 共用同一套逻辑。

---

## 4. P0：准入、分层 KPI、品类止血

### 4.1 SKU 准入规则

新增 `apps/web/server/lib/forecast-eligibility.ts`：

```typescript
export type ForecastEligibilityInput = {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  salesDays365: number;
  forceForecast?: boolean; // SKU 主数据扩展字段，见 4.4
};

export type ForecastEligibilityResult =
  | { eligible: true; tier: 'core' | 'mid' | 'tail' }
  | { eligible: false; reason: 'no_recent_sales' | 'insufficient_history' };
```

**默认准入**（满足其一）：

1. `recent90DailyAvg > 0`
2. `recent30DailyAvg > 0`
3. `salesDays365 >= 30` 且站点过滤后存在任意销量
4. `skus.force_forecast = true`（可选字段）

**不满足**：不写入 `sales_forecast_monthly`；写入复核项 `issueType=forecast_skipped`（见 4.4）。

**生成范围变化**：`generateBaselineForecastVersionForStation` 在 SKU 循环内先调 `evaluateForecastEligibility`；`forecastRows` 仅统计准入 SKU。

### 4.2 品类中位数止血

修改 `computeCategoryReferenceBySku` 的**消费侧**（`computeNearTermLevel` / `computeBaselineDailyAvg`）：

| 条件 | 是否使用品类参考 |
|------|------------------|
| `lifecycle === 'new'` 且 `recent30 > 0` | 是 |
| `recent90 <= 0` | **否** |
| `lifecycle === 'intermittent'` | **否** |
| 其他，`recent90 > 0` 且品类参考存在 | 仅当 `weights.wCat > 0`（保持现有） |

避免零近期销量 SKU 被品类中位数「抬出」预测。

### 4.3 分层准确率汇总

新增 `apps/web/server/lib/forecast-accuracy-tier.ts`：

- `classifyVolumeTier(avgActualDaily)` → `core | mid | tail`
- `summarizeAccuracyByTier(rows)` → 各档 SKU 数、可比行、WMAPE、bias、高偏差占比
- `summarizeAccuracyByCategory(rows, categoryBySku)` → 品类 Top N

**API**：

- `GET /api/sales-forecasts/accuracy/summary?versionId=&year=&month=`  
  返回 `{ global, byTier[], byCategory[] }`
- 走步回测 `runWalkForwardAccuracyBacktest` 返回体增加 `tierSummary` 字段

**脚本**：`analyze-walkforward-csv.ts` 改为调用 `forecast-accuracy-tier.ts`，避免逻辑重复。

### 4.4 数据模型（P0 最小变更）

```sql
-- packages/db/drizzle/0039_forecast_eligibility.sql

ALTER TYPE forecast_review_issue_type ADD VALUE IF NOT EXISTS 'forecast_skipped';

ALTER TABLE skus ADD COLUMN IF NOT EXISTS force_forecast boolean NOT NULL DEFAULT false;
```

Drizzle：`forecastReviewIssueTypeEnum` 增加 `forecast_skipped`；`skus.forceForecast`。

---

## 5. P1：间歇与新品算法通道

### 5.1 间歇 SKU（`lifecycle === 'intermittent'`）

在 `computeForecastDailyAvgForMonth` 入口增加分支：

```text
若 lifecycle === 'intermittent':
  baseline = recent90DailyAvg（或 Croston 期望，首版用 recent90）
  forecast = min(baseline, max(recent30, recent90) × 1.15)
  不乘 seasonality × trend（factor 恒为 1）
  confidence_level = 'low'
```

复核：自动 `issueType=trend_shift` 或新增 `intermittent_sku`（首版复用 `missing_history` severity=info）。

### 5.2 新品 SKU（`lifecycle === 'new'`）

**条件**：`ageDays < 90`（asOf 时点与线上一致）。

```text
若 lifecycle === 'new':
  k <= 2: baseline = near_level（仅 recent30/90 + 有限品类参考）
  k >= 3: baseline = near_level × rampDecay(k)，禁止 structural_level 主导
  rampDecay(k) = min(1, 0.5 + k × 0.15)  // k=0→0.5, k=3→0.95
  growth_factor 强制 = 1（不走 yoy 外推）
  confidence_level = 'low'
```

**SPU 同类迁移（可选 P1.1）**：当 `recent90=0` 且同 SPU 有 sibling `recent30>0`，`near_level = median(sibling recent30)`。

### 5.3 新品 listing 复核

`buildReviewItemsForForecast`：`lifecycle === 'new'` 时增加：

```text
issueType: 'trend_shift' 或 'missing_history'
severity: 'warning'
message: 新品/上架不足 90 天，预测为低置信度，请人工确认或填写预期日均
```

发布门禁（P2 联动）：`confidence_level=low` 且 `lifecycle=new` 的 SKU 不计入「必须复核」阻塞，但列入发布 warnings。

---

## 6. P2：成熟 SKU 因子调参

### 6.1 下滑期季节收缩

当 `lifecycle === 'decline'` 或 `recent30 < 0.8 × recent90`：

```text
effectiveSeasonality = 1 + (seasonalityFactor - 1) × 0.5
effectiveTrend = min(trendFactor, 1.0)
```

再经现有 `clip(0.7, 1.3)`。

### 6.2 地平线近期权重下调

当 `recent30 < 0.8 × recent90` 且 `lifecycle` 为 `mature` | `decline`：

```text
k=0: w_near 从 0.65 → 0.50（computeHorizonBlendWeights 增加 override 参数）
```

### 6.3 断货怀疑

`stockout_suspected`：`growth_factor` 上限 **1.0**（原为 1.3）。

### 6.4 验证方法

1. 固定 20 个高估 SKU（走步回测 Top 列表，如 DJ502952_1、DJ503734_1）。
2. 对比优化前后 `horizon_factors` 与 6 个月 WMAPE。
3. 全量走步回测复跑，主力层 WMAPE ≤45%。

**不调整**：全局 clip 区间、默认 `w_near/w_yoy` 表（除 6.2 条件触发外）。

---

## 7. P3：产品化

### 7.1 查询复盘 · 准确率 Tab

`SalesForecastPage.tsx`（`insightsView === 'accuracy'`）：

| 组件 | 内容 |
|------|------|
| `ForecastAccuracyTierSummary` | 主力/腰部/长尾/跳过 四卡 WMAPE、bias、高偏差% |
| 走步回测按钮 | 调用已有 `POST /accuracy/walkforward`，展示 `tierSummary` |
| 品类 Top 表 | 可折叠，SKU≥20 的品类加权 MAPE |

### 7.2 生成预测页

生成完成后展示：`准入 SKU 数 / 跳过数 / 各档分布`（来自生成 API 新字段 `eligibilityStats`）。

### 7.3 方法论文档

更新 `apps/web/src/lib/forecast-methodology.ts`：

- 准入规则、分层 KPI 口径
- 间歇/新品通道说明
- 走步回测与线上口径一致声明

### 7.4 走步回测 CLI

`run-forecast-walkforward-backtest.ts` 增加 `--tier=core|mid|all`（仅影响汇总输出，不改变写库范围，避免与线上一口径分叉）。

---

## 8. API 变更汇总

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/sales-forecasts/generate-baseline` | 响应增加 `eligibilityStats` |
| GET | `/sales-forecasts/accuracy/summary` | **新增** 分层汇总 |
| POST | `/sales-forecasts/accuracy/walkforward` | 响应增加 `tierSummary` |
| GET | `/sales-forecasts/accuracy` | `summary` 文本追加主力层 WMAPE（可选） |

`apps/web/src/lib/api.ts` 同步类型。

---

## 9. 权限与审计

- 走步回测：保持 `requireMenu('data.forecast')` + 现有 audit action `sales_forecast.walkforward_backtest`。
- `force_forecast` 字段：仅商品主数据编辑权限可改（复用 SKU 更新 API，若无则 P3 前仅 DB 维护）。

---

## 10. 测试策略

| 层级 | 文件 | 覆盖 |
|------|------|------|
| 单元 | `forecast-eligibility.test.ts` | 准入边界 |
| 单元 | `forecast-accuracy-tier.test.ts` | WMAPE、分层 |
| 单元 | `forecast-baseline.test.ts` | 间歇/新品/decline 分支 |
| 单元 | `forecast-collaboration.test.ts` | 品类参考止血、跳过不写行 |
| 集成 | `forecast-walkforward-backtest` 单 SKU | DJ502530_2 回归 |
| 冒烟 | `pnpm forecast:walkforward -- --sku-code DJ502952_1` | 高估 SKU 偏差收敛 |

---

## 11. 发布与回滚

1. **DB**：先 migrate `0039`，再发应用。
2. **行为变更**：下次「生成预测」生效；已发布版本不变。
3. **回滚**：代码回退即可；`force_forecast` 列可保留；`forecast_skipped` 枚举值不可删（Postgres 限制），回滚后忽略即可。

---

## 12. 里程碑

| 周 | 交付 |
|----|------|
| W1 | P0 完成 + 走步回测复跑报告 |
| W2 | P1 完成 + 20 SKU 因子复盘 |
| W3 | P2 调参 + 主力 WMAPE 验收 |
| W4 | P3 UI + 文档 + 妙搭 hono-app 同步 |

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 准入过严导致补货缺预测 | `force_forecast` + 发布 warnings 保留 coverage_gap |
| 新品通道仍低估 | 运营人工调整 + SPU 迁移 P1.1 |
| 全量回测耗时长（~15min） | 开发阶段 `--sku-code` / `--tier=core` 汇总 |
| 与 P2 迭代计划重叠（ABC 分层） | ABC 权重放在本方案之后，准入 tier 仅用于评估 |

---

## 14. 开放问题（评审时确认）

1. **默认业务优先级**是否确认为「主力准」（A）？若选 B，P0 准入改为「跳过仅当 365 天零销」。
2. **`force_forecast`** 是否需要商品主数据 UI？首版可仅 DB。
3. **间歇 SKU** 首版用 `recent90` 封顶还是引入 Croston？建议首版封顶，Croston 放 backlog。

---

## 15. 参考文件

| 文件 | 说明 |
|------|------|
| `apps/web/server/lib/forecast-collaboration.ts` | 生成主链路 |
| `apps/web/server/lib/forecast-baseline.ts` | v2 公式 |
| `apps/web/server/lib/forecast-walkforward-backtest.ts` | 走步回测 |
| `apps/web/scripts/analyze-walkforward-csv.ts` | 离线分析 |
| `docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv` | 全量样本 |
