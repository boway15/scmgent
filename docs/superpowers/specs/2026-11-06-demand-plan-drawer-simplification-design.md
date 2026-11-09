# 周需求计划 SKU 详情抽屉瘦身与内联 V4.1 因子口径对齐

**版本**：v1.0（2026-11-06）  
**关联**：[2026-11-04-weekly-demand-matrix-parity.md](./2026-11-04-weekly-demand-matrix-parity.md)、[2026-11-04-weekly-demand-sales-lag-design.md](./2026-11-04-weekly-demand-sales-lag-design.md)

---

## 1. 背景与问题

周需求计划详情抽屉（`DemandPlanSkuDetailDrawer` / `DemandPlanWeeklyForecastTable`）当前将「月销量预测拆周列（置信度 / 基线 / 季节朴素 / 混合水平 / 系统 / 校准 / 生效）」与「周需求计划列（计划系统 / 计划校准 / 计划生效 / Champion）」并排放在同一张表中，导致以下问题：

1. **数据源错位（Bug）**：`loadDemandPlanSkuDetail` 在 `generationMeta.demandForecastSource === 'v41_inline'` 时，仍优先读取已发布月预测版本（`listForecastHorizon`）渲染左侧因子列，仅在无已发布月预测时才调用 `loadDemandPlanSkuInlineV41Horizon`。结果左侧因子推导的是旧月预测拆周（如 `27.38`），右侧 `计划系统` 则是内联 V4.1 周计划（如 `36.17`），同行数字无法互相解释。
2. **多平台内联因子未聚合**：`computeDemandPlanInlineV41ForSku` 在全平台（`ALL`）视角下仅取单一渠道（`AMAZON` 或首渠道）的 `displayV41` 因子，未调用 `aggregateAllCatV41HorizonFactorsForDisplay` 汇总各渠道的锚定、季节朴素与混合基线，也未支持按单渠道 `targetPlatform` 过滤。
3. **列高度冗余**：
   - `置信度`、`d6`、`趋势比`、`锚定` 在同一 SKU 的 26 周内固定不变，无需逐行占列。
   - V4.1 下 `基线` 与 `混合水平` 数值恒等（同为 `levelDaily`）。
   - 口径对齐后，周计划只有一套「系统预测 → 人工校准 → 生效日均」，无需并排展示两套「系统 / 校准 / 生效」及 `Champion` 列。
   - 内联 V4.1 模式下底部 `blend_meta` 折叠区展示 `w近=100% / w远=0%` 无诊断价值。

---

## 2. 设计决策

| 项 | 决策 |
|----|------|
| 顶部基线锚点摘要 | 移至周表正上方，展示全周期固定因子：商品分层、置信度、近 30/90 天日均、V4.1 走步特征（`d6`、`d3`、`趋势比`、`锚定日均`、加权公式） |
| 主表列（V4.1 模式） | **7 列单链路闭环**：`周次` \| `季节朴素` \| `混合基线` \| `系统预测` \| `人工校准` \| `生效日均` \| `实际日均` |
| 主表列（Legacy 模式） | `周次` \| `混合基线` \| Legacy 季节/趋势因子列 \| `系统预测` \| `人工校准` \| `生效日均` \| `实际日均` |
| 移除列 | 移除表内重复固定列（`置信度`、`d6`、`趋势比`、`锚定`）、合并 `基线` 与 `混合水平` 为 `混合基线`、移除旧月测拆周三列（`系统`、`校准`、`生效`）、移除 `Champion` 列 |
| 内联 V4.1 因子源 | 当版本为内联 V4.1（`generationMeta?.demandForecastSource === 'v41_inline' \|\| !forecastVersionId`）时，抽屉强制使用 `loadDemandPlanSkuInlineV41Horizon` 生成 `forecastHorizon` 与 `forecastContext` |
| 多平台因子聚合与分渠道支持 | `computeDemandPlanInlineV41ForSku` 支持 `targetPlatform`：全平台（`ALL`）下用 `aggregateAllCatV41HorizonFactorsForDisplay` 聚合各渠道因子并附 `platformContributions`；单平台下返回对应渠道因子与预测值 |
| `blend_meta` 折叠区 | 仅在 `algo === 'monthly'`（非内联 V4.1 的历史混合模式）下展示 |

---

## 3. 数据流与组件变更

### 3.1 后端：`apps/web/server/lib/demand-plan-inline-v41.ts`
- `computeDemandPlanInlineV41ForSku` 新增可选参数 `targetPlatform?: string`（默认 `'ALL'`）。
- 计算并返回 `recent30DailyAvg` 与 `recent90DailyAvg`（全平台或目标平台口径），供抽屉展示近期动销水位。
- 全平台（`ALL`）时，对每个预测月收集各渠道 V4.1 因子，按主渠道排序后调用 `aggregateAllCatV41HorizonFactorsForDisplay` 生成汇总 `allCatV41Factors`（含 `platformContributions`），`baselineDailyAvg` 取各渠道 `baseDaily` 之和。
- 单平台（如 `AMAZON`、`SHOPIFY`）时，`monthCells` 仅汇总目标渠道的预测日均与 V4.1 因子。

### 3.2 后端：`apps/web/server/lib/demand-plan-sku-detail.ts`
- 当 `useInlineV41Horizon` 为 `true` 时，直接调用 `loadDemandPlanSkuInlineV41Horizon`（传入当前 `platform`）构建 `forecastHorizon` 与 `forecastContext`，不再被已发布月预测版本的 `monthCells` 覆盖。
- 单平台视角（`platform !== 'ALL'`）下，使用 `splitMergedWeeklyDailyByPlatform` 将周计划行的 `systemDailyAvg` 与 `effectiveDailyAvg` 按各平台月形状拆分，使单平台抽屉中的 `系统预测` 与宽表分平台行一致。

### 3.3 前端：`apps/web/src/components/DemandPlanWeeklyForecastTable.tsx`
- 区块标题更新为「周需求计划 · 26 周明细」。
- 将「基线因子」摘要卡片移至表格上方，补充展示置信度与近 30/90 天日均。
- 表头精简为：`周次`、`季节朴素`、`混合基线`、`系统预测`、`人工校准`、`生效日均`、`实际日均`。
- `系统预测` 展示 `row.planSystemDailyAvg`（回退 `row.systemDailyAvg`），保留 V4.1 悬停公式拆解提示（并补充按 ISO 周日历天拆周说明）。
- `人工校准` 仅在 `planCalibrationEditable && platform === 'ALL'` 时可编辑；分平台只读视角提示切换全平台或导入校准。
- `生效日均` 展示 `row.planEffectiveDailyAvg`。
- 底部 `blend_meta` 折叠块仅在存在 `row.planBlendMeta?.algo === 'monthly'` 时渲染。
