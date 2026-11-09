# AllCategory V4.1-W 周走步预测 Implementation Plan

> **For agent:** REQUIRED SUB-SKILL: use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task with checkpoints.

**Goal:** 周度销量预测在 `DEMAND_PLAN_WEEKLY_ALGO=v41_w` 下用 w4/w8/w12/w16 走步特征直接生成 26 周系统日均，与现有 `v41_inline` 可切换、可回滚。

**Architecture:** 新建 `forecast-allcat-v41-w.ts` 移植 V4.1 分层与套限幅逻辑；新建 `demand-plan-inline-v41-w.ts` 对接日销→ISO 周聚合；`generateDemandPlanDraft` 按 env 分支；读路径与 UI 识别 `demandForecastSource=v41_w`。

**Spec:** [docs/superpowers/specs/2026-11-06-allcat-v41-w-weekly-design.md](../specs/2026-11-06-allcat-v41-w-weekly-design.md)

---

## File map

| Action | Path |
|--------|------|
| Create | `apps/web/server/lib/forecast-allcat-v41-w.ts` |
| Create | `apps/web/server/lib/forecast-allcat-v41-w.test.ts` |
| Create | `apps/web/server/lib/demand-plan-algo-mode.ts` |
| Create | `apps/web/server/lib/demand-plan-inline-v41-w.ts` |
| Create | `apps/web/server/lib/demand-plan-inline-v41-w.test.ts` |
| Modify | `apps/web/server/lib/demand-plan-service.ts` |
| Modify | `apps/web/server/lib/demand-plan-sku-detail.ts` |
| Modify | `packages/db/src/schema/demand-plan.ts` |
| Modify | `apps/web/src/lib/api.ts` (types if needed) |
| Modify | `apps/web/src/components/ForecastStrategySection.tsx` |
| Modify | `apps/web/src/components/DemandPlanWeeklyForecastTable.tsx` |
| Modify | `apps/web/src/lib/forecast-v41-system-formula.ts` (w tooltip) |
| Modify | `docs/business/scm-demand-supply-inventory-logic.md` (一行索引) |

---

## Task 1: 周销量聚合 + walk-forward metrics

**Files:** Create `forecast-allcat-v41-w.ts`, `forecast-allcat-v41-w.test.ts`

1. 实现 `aggregateDailyQtyByIsoWeek(dailyRows) → Map<weekKey, qty>`.
2. 实现 `computeWalkForwardWeeklyMetrics(weeklyQtyMap, targetWeekKey, historyCapEnd?) → AllCatV41WMetrics`（w4/w8/w12/w16, activeW*, cv8, trendRatioW）。
3. 写测试：固定日销序列，断言 w8、activeW8、目标周之后数据不参与。
4. 运行：`pnpm --filter @scm/web test forecast-allcat-v41-w.test.ts`（或项目既有 node:test 命令）。

**Done:** metrics 单测绿。

---

## Task 2: 分层 + computeAllCatV41WForecastForWeek

**Files:** Continue `forecast-allcat-v41-w.ts`

1. 从 `forecast-allcat-v41.ts` **复制并改签名**：`classifyAllCatV41WTier`、`computeAllCatV41WBaseDaily`（w 加权表）。
2. 实现 `computeAllCatV41WForecastForWeek`：入参与 V4.1 月版对齐（platform, horizonWeekIndex, recent30/90, seasonality, demandReconstruct…），内部 `k = floor(horizonWeekIndex/4)` 复用 `resolveV41MonthFactor` 等（calendarMonth 取该周周一所在月）。
3. 导出 `ALLCAT_V41_W_MODEL = 'allcat_v41_w'`.
4. 单测：T1 加权公式、T99 floor、近端 w8 门槛样例。

**Done:** 单周 forecast 与手工算例一致。

---

## Task 3: demand-plan-algo-mode + schema 类型

**Files:** Create `demand-plan-algo-mode.ts`, modify `packages/db/src/schema/demand-plan.ts`

1. `resolveDemandPlanWeeklyAlgo(env?) → 'v41_inline' | 'v41_w'`（默认 `v41_inline`）。
2. 扩展 `DemandPlanWeekBlendMeta.algo` 与 `DemandPlanGenerationMeta.demandForecastSource` union。
3. 无需 DB migration（jsonb 仅 TypeScript 约束）。

**Done:** tsc 通过。

---

## Task 4: SKU 批量 inline V4.1-W

**Files:** Create `demand-plan-inline-v41-w.ts`, `.test.ts`

1. 镜像 `computeDemandPlanInlineV41ForSku` 结构：分平台日销 → 周聚合 → 对 `horizonWeekKeys[0..25]` 调用 `computeAllCatV41WForecastForWeek`。
2. **Tier 锚定**：首周算 tier，horizonWeekIndex>0 时 metrics/tier 冻结（与 V4.1 `resolveWalkForwardMetricsTarget` 行为对齐）。
3. 返回 `Map<weekKey, daily>` + `weekCells[]`（供抽屉，含 allCatV41WFactors）。
4. 单测：两平台合并、skip 无销平台。

**Done:** 纯函数输出 26 键。

---

## Task 5: 接入 generateDemandPlanDraft

**Files:** Modify `demand-plan-service.ts`

1. 若 `resolveDemandPlanWeeklyAlgo() === 'v41_w'` 且 `isAllCatV41AlgoMode`（或文档化：v41_w 不要求月 algo，仅要求日销）→ 批量 `computeDemandPlanInlineV41WForSku`。
2. 写周行：`systemDailyAvg`，`blend_meta: { algo: 'v41_w', profileSegment, wNear/wYoy 若仍做 yoy 混合则 document；**首期建议纯 V4.1-W 输出，wNear=1,wYoy=0** }`。
3. `generationMeta.demandForecastSource = 'v41_w'`。
4. 扩展 `demand-plan-service` 现有测试或新增：mock 最小 SKU 生成 1 行 meta 断言。

**Done:** 本地 `POST /demand-plans/generate` 在 env 下 meta 正确。

---

## Task 6: SKU 抽屉读路径

**Files:** Modify `demand-plan-sku-detail.ts`

1. `useInlineV41WHorizon = generationMeta?.demandForecastSource === 'v41_w'`.
2. 加载 `loadDemandPlanSkuInlineV41WHorizon`（新建，或复用 inline-v41-w 导出）。
3. `forecastWeeks` 因子列展示 w8/w4，与矩阵 system 一致。

**Done:** 抽屉与矩阵同行同数（回归 2026-11-06 drawer 简化原则）。

---

## Task 7: 前端策略与表头

**Files:** `ForecastStrategySection.tsx`, `DemandPlanWeeklyForecastTable.tsx`, `forecast-v41-system-formula.ts`, `demand-plan-column-help.ts`

1. 策略 Tab：`context=weekly` 时增加 V4.1-W 表格与 env 说明；`v41_inline` 标为对照。
2. 抽屉置顶 w 特征；tooltip 支持 w 公式字符串。
3. 不改月预测页默认 Tab。

**Done:** 肉眼可辨两种周 algo。

---

## Task 8: 文档与 SOP

**Files:** `docs/business/scm-demand-supply-inventory-logic.md`, optional `docs/local-server-release-sop.md` 一行

1. 索引 V4.1-W 与 env。
2. 发布 SOP：切换 env → 全量 regenerate 草稿 → accuracy 对比 → 再考虑改默认。

**Done:** 运维可读。

---

## Task 9: 回测对比（可选但推荐）

**Files:** 脚本或扩展现有 `demand-plan-accuracy-export`

1. 同一 startWeek、两版 algo 生成草稿（或离线纯函数）对比 weekIndex 0–3 WMAPE。
2. 结论写入 spec §9 开放项。

**Done:** 有数据支撑是否改默认。

---

## Verification checklist

- [ ] `DEMAND_PLAN_WEEKLY_ALGO=v41_w` 生成 26 周行，`algo=v41_w`
- [ ] 默认 env 仍为 `v41_inline`，行为与现网一致
- [ ] 抽屉内联 v41_w 不读已发布月预测 cells
- [ ] 策略页 V4.1-W 与 w 定义可查阅
- [ ] 单测 `forecast-allcat-v41-w.test.ts` + `demand-plan-inline-v41-w.test.ts` 通过
