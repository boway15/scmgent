# AllCategory V4.1-W 周走步预测设计

**版本**：v1.0（2026-11-06）  
**状态**：待评审后实施  
**定位**：周度销量预测专用走步特征与分层 KPI，与月销量 V4.1 **并行**；月预测算法与 KPI 不变。  
**关联**：[2026-09-22-planning-horizon-weekly-monthly-design.md](./2026-09-22-planning-horizon-weekly-monthly-design.md)、[2026-11-04-weekly-demand-sales-lag-design.md](./2026-11-04-weekly-demand-sales-lag-design.md)

---

## 1. 背景与目标

### 1.1 问题

当前周预测默认 **内联 V4.1**（`demandForecastSource=v41_inline`）：

1. 走步特征 **d2/d3/d6/d12** 来自 **SKU 自然月销**，再生成 6 个月日均并 **拆 ISO 周**。
2. 近端虽用 `planningRecentWindowEnd` + recent30/90，但 **锚定分层与 T 层门槛仍按月 d**，与 26 周地平线、运营「看近几周」心智不完全一致。
3. Champion 月预测对照仍保留，但 **周系统列无法解释为「近 8 周销量结构」**。

### 1.2 目标

- 新增 **V4.1-W**：以 **ISO 周** 为走步单位，特征窗 **w4 / w8 / w12 / w16**（周销量折算日均）。
- **26 周逐周直接输出**系统日均，**不再**「先 6 自然月再拆周」作为默认路径（内联 V4.1 保留为回滚/对照）。
- 分层命名仍为 T1–T99，**准入与加权公式与 V4.1 同构**，仅度量从 d→w、active6→activeW8、cv6→cv8 等。
- 验收：相对现有 `v41_inline`，**近 4 周 WMAPE** 有 measurable 改善或 Bias 更稳；全 26 周不明显劣化。

### 1.3 非目标

- 不替换 **月销量预测** 的 `computeAllCatV41ForecastForMonth` 与 `FORECAST_ALGO_MODE`。
- 不改变补货「仍以月预测为准」的现行产品声明（直至单独立项接入）。
- 不在首期引入 Dify 周工作流；T99 仍 **人工校准** 为主。

---

## 2. 方案对比（已选 B）

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 仅近端 w 替换 | 远月仍用月 V4.1 拆周 | 实现快，口径混用难解释 → 不选 |
| **B. 全 26 周 V4.1-W** | 每周 walk-forward + 周特征 | **推荐** |
| C. 纯 U×形状 | 去掉 V4.1 分层 | 与现有 KPI/矩阵能力脱节 → 不选 |

---

## 3. 特征定义

### 3.1 数据聚合

- 输入：`sales_history_daily`（与现周计划相同），按 **平台** 过滤后聚合。
- 先按 **ISO 周键** `YYYY-Www` 汇总 `qty_sold`（周界与 `planning-calendar.isoWeekKeyFromUtcDate` 一致）。
- 走步目标：预测地平线中第 `horizonWeekIndex` 个 ISO 周 `W*`；**仅使用严格早于 `W*` 周一 00:00 UTC 的历史周**（walk-forward，无泄漏）。

### 3.2 w4 / w8 / w12 / w16

对目标周 `W*`（walk-forward 锚点，批量生成时可对 `horizonIndex>0` 冻结于首周锚点，与 V4.1 首月锚 tier 一致）：

| 符号 | 定义 |
|------|------|
| `qN` | 目标周之前连续 N 个 ISO 周的销量之和（缺周按 0） |
| **w4** | `q4 / 28` |
| **w8** | `q8 / 56` |
| **w12** | `q12 / 84` |
| **w16** | `q16 / 112` |

内部可保留 `q4,q8,q12,q16` 供 tooltip / 调试。

### 3.3 active / cv / trend（周版）

| 月 V4.1 | V4.1-W |
|---------|--------|
| active2 / active6 / active12 | **activeW4 / activeW8 / activeW16**（前 N 周内销量>0 的 ISO 周个数） |
| cv6（近 6 个有销月） | **cv8**（近 8 周内有销周的周销量 CV） |
| trendRatio（q3 vs q6−q3 月） | **trendRatioW**（q4 vs q8−q4 周，或 q8 vs q16−q8；实现取与 SQL 原型最接近且可测的一种，见 §7） |

### 3.4 近 30 / 近 90

- **不变**：日销滚动窗，截止 `planningRecentWindowEnd` + `resolveRecentDemandWindows`（缺货还原）。
- 用于 growth 判定、T99 保底、T4 上界 cap（与 V4.1 相同逻辑，cap 中 `d6` 参数改为 **w8**）。

### 3.5 同比

- 优先 **去年同 ISO 周** 日均（已有 `lastYearSameWeekDailyAvg`）。
- 季节/品类系数：首期 **复用** 目标周所在 **日历月** 的 seasonality/trend（与内联 V4.1 一致），避免重做品类表。

---

## 4. 分层与公式（与 V4.1 同构映射）

**准入门槛**：数值上与 d6 对齐的 **w8 日均**（例如 T1 AMAZON w8≥20），因同为「件/天」口径；active/cv 用 W 列。

**锚定加权**（替换 d 为 w）：

| 层级 | V4.1（月） | V4.1-W（周） |
|------|------------|--------------|
| T1 | 0.15·d2 + 0.55·d6 + 0.30·d12 | **0.15·w4 + 0.55·w8 + 0.30·w16** |
| T2 | 0.25·d3 + 0.55·d6 + 0.20·d12 | **0.25·w4 + 0.55·w8 + 0.20·w16** |
| T3 | 0.35·d3 + 0.50·d6 + 0.15·d12 | **0.35·w4 + 0.50·w8 + 0.15·w16** |
| T3P | 0.45·d3 + 0.45·d6 + 0.10·d12 | **0.45·w4 + 0.45·w8 + 0.10·w16** |
| T4A | 0.50·d3 + 0.45·d6 + 0.05·d12 | **0.50·w4 + 0.45·w8 + 0.05·w16** |
| T4B 长/短 | d3/d6/d12 组合 | **w4/w8/w16** 同结构 |
| T99 | max(近30,近90,d3)×… | **max(近30,近90,w4)×…** |

**后续管道**（复用 V4.1 函数，horizon 改为周序号）：

- `resolveEffectiveTrendDecay` → trendRatio 换 `metrics.trendRatioW`，cv6→cv8
- 远周折减：用 **horizonWeekIndex**，`k = ⌊horizonWeekIndex / 4 ⌋` 映射原 `horizonMonthIndex` 折扣阶梯（与现 `weekIndexToHorizonMonthIndex` 一致）
- `tierConservativeFactor`、`applyV41CoreUpperBiasCap`、`applyV41TailUpperBiasCap`（w8 代 d6）、flex bias shadow 等同理

**模型标识**：`allcat_v41_w`；系统串 `AllCategory-KPI-CoreFirst-T99-V41-W`。

---

## 5. 接入点

### 5.1 配置

| 变量 | 值 | 说明 |
|------|-----|------|
| `DEMAND_PLAN_WEEKLY_ALGO` | `v41_inline`（默认）\| `v41_w` | **仅影响周计划生成**；与 `FORECAST_ALGO_MODE` 解耦 |
| 非 v41 月模式 | — | 仍走 `published_champion` / legacy，不自动启用 V4.1-W |

### 5.2 生成（`generateDemandPlanDraft`）

- `v41_w`：调用 `computeDemandPlanInlineV41WForSku` → 对 `weeks[]` 每周 `systemDailyAvg`，`blend_meta.algo = 'v41_w'`。
- `generationMeta.demandForecastSource = 'v41_w'`。
- Champion 列逻辑不变（只读对照）。

### 5.3 读路径

- `loadDemandPlanSkuDetail` / 抽屉：当 `demandForecastSource === 'v41_w'` 时加载 **周 horizon 因子**（w8、锚定公式、混合步骤），禁止回落到月内联 cells。
- 矩阵 tooltip：复用 `forecast-v41-system-formula` 扩展 **w 版** 文案。

### 5.4 元数据（JSON，首期不迁表）

```ts
// DemandPlanWeekBlendMeta.algo
'monthly' | 'v41_inline' | 'v41_w';

// DemandPlanGenerationMeta.demandForecastSource
'v41_inline' | 'v41_w' | 'published_champion' | 'legacy_blend';
```

旧版本无字段时行为不变。

---

## 6. UI

- **周度销量预测 → 预测策略**：增加 **V4.1-W** 专节（w 定义、与 V4.1 对照表、环境变量说明）；`v41_inline` 标为「对照/回滚」。
- **SKU 抽屉**：置顶 **w8 / w4 / activeW8 / cv8**；表头 help 链到策略页。
- 月预测策略页 **不修改** 默认叙事。

---

## 7. 测试与验收

### 7.1 单测

- `computeWalkForwardWeeklyMetrics`：ISO 周边界、walk-forward 无泄漏、缺周为 0。
- 分层准入：构造 w8/activeW8/cv8 边界用例（至少 T1/T99 各 1）。
- 与 V4.1 对比：同销量序列下 w8 与「近 8 周日均」一致。

### 7.2 集成

- 生成小 scope SKU 草稿：`blend_meta.algo === 'v41_w'` 且 26 行非空。
- 抽屉因子与矩阵 `system_daily_avg` 一致。

### 7.3 回测（脚本或 demand-plan accuracy）

- 仓库根目录：`pnpm demand-plan:compare-algo`（`apps/web/scripts/compare-demand-plan-weekly-algo.ts`）  
  对同一 `startWeek`、同一近窗，离线并行跑 inline 与 v41_w，按 **近 4 周** 与 **全可比周** 输出 WMAPE；可选 `--csv`。
- 线上版本对比：分别设 env 生成两版草稿，用需求计划 **准确度** 面板 / 导出 CSV。

---

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 周聚合与日表 ISO 周不一致 | 单测 + 与 `isoWeekKeyFromUtcDate` 交叉验证 |
| 门槛生搬 d6 导致覆盖突变 | 发布前用 accuracy 对比；必要时 w8 门槛 × 校准系数（文档化常数） |
| 与 Champion 偏离大 | UI 保留 Champion 列；策略页说明「双轨预期」 |

**回滚**：`DEMAND_PLAN_WEEKLY_ALGO=v41_inline`，重新生成草稿即可。

---

## 9. 开放项（实施前确认）

1. **默认开关**：首期 **默认仍为 `v41_inline`**，待回测通过后改为 `v41_w`（推荐）。
2. **trendRatioW** 精确公式：实现阶段在 `forecast-allcat-v41-w.test.ts` 中锁定一种并写入本节（若与 §3.3 不一致以代码+测试为准）。

---

## 10. 文件清单（预期）

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/forecast-allcat-v41-w.ts` | 周 metrics、tier、baseDaily、逐周 forecast |
| `apps/web/server/lib/forecast-allcat-v41-w.test.ts` | 特征与分层单测 |
| `apps/web/server/lib/demand-plan-inline-v41-w.ts` | SKU×平台批量、26 周行 |
| `apps/web/server/lib/demand-plan-algo-mode.ts` | 解析 `DEMAND_PLAN_WEEKLY_ALGO` |
| `demand-plan-service.ts` | 分支生成 |
| `demand-plan-sku-detail.ts` | 抽屉读路径 |
| `packages/db/src/schema/demand-plan.ts` | 类型 union 扩展 |
| `ForecastStrategySection.tsx` | V4.1-W 策略文案 |
| `DemandPlanWeeklyForecastTable.tsx` | w 因子展示 |
