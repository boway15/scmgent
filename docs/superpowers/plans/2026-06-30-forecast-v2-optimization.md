# 销量预测 v2 优化（方案 C）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在走步回测证据基础上，分 P0–P3 优化预测覆盖、算法分流与分层准确率，使主力 SKU 加权 MAPE ≤45%，并产品化分层复盘。

**Architecture:** 新增 `forecast-eligibility` 与 `forecast-accuracy-tier` 纯函数模块；在 `generateBaselineForecastVersionForStation` 准入门控；在 `forecast-baseline.ts` 按 lifecycle 分流；扩展准确率 API 与 `SalesForecastPage` 准确率 Tab。走步回测与线上共用生成逻辑。

**Tech Stack:** TypeScript, Hono, Drizzle ORM, PostgreSQL, Vitest, React 18, TanStack Query.

**设计基线:** [2026-06-30-forecast-v2-optimization-design.md](../specs/2026-06-30-forecast-v2-optimization-design.md)

---

## File Structure

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `packages/db/drizzle/0039_forecast_eligibility.sql` | `forecast_skipped` 枚举、`skus.force_forecast` |
| Modify | `packages/db/src/schema/inventory.ts` | `forceForecast` 列 |
| Modify | `packages/db/src/schema/sales-forecast.ts` | `forecast_skipped` 枚举值 |
| Create | `apps/web/server/lib/forecast-eligibility.ts` | SKU 准入判定 |
| Create | `apps/web/server/lib/forecast-eligibility.test.ts` | 准入单元测试 |
| Create | `apps/web/server/lib/forecast-accuracy-tier.ts` | 分层 WMAPE / 品类汇总 |
| Create | `apps/web/server/lib/forecast-accuracy-tier.test.ts` | 分层单元测试 |
| Modify | `apps/web/server/lib/forecast-collaboration.ts` | 准入门控、品类止血、复核项、stats |
| Modify | `apps/web/server/lib/forecast-baseline.ts` | 间歇/新品/decline 分支 |
| Modify | `apps/web/server/lib/forecast-baseline.test.ts` | 新分支测试 |
| Modify | `apps/web/server/lib/forecast-walkforward-backtest.ts` | `tierSummary` 输出 |
| Modify | `apps/web/server/lib/forecast-accuracy.ts` | 调用 tier 汇总（可选） |
| Modify | `apps/web/server/routes/sales-forecast.ts` | `GET accuracy/summary`、生成 stats |
| Modify | `apps/web/scripts/analyze-walkforward-csv.ts` | 复用 `forecast-accuracy-tier` |
| Modify | `apps/web/src/lib/api.ts` | 新类型与 client |
| Create | `apps/web/src/components/ForecastAccuracyTierSummary.tsx` | 分层卡片 |
| Modify | `apps/web/src/pages/SalesForecastPage.tsx` | 准确率 Tab 集成分层 |
| Modify | `apps/web/src/lib/forecast-methodology.ts` | 口径文档 |
| Modify | `docs/samples/forecast-backtest/README.md` | 分层 KPI 说明 |

妙搭同步：完成后 `pnpm zip:miaoda` 前将 `server/lib/forecast-*.ts` 同步至 `server/hono-app/`（CJS 无 `.js` 后缀）。

---

## Phase P0 — 准入、分层 KPI、品类止血（Week 1）

### Task 1: 数据库迁移 `0039`

**Files:**
- Create: `packages/db/drizzle/0039_forecast_eligibility.sql`
- Modify: `packages/db/src/schema/sales-forecast.ts`
- Modify: `packages/db/src/schema/inventory.ts`

- [ ] **Step 1: 写迁移 SQL**

```sql
-- packages/db/drizzle/0039_forecast_eligibility.sql
ALTER TYPE forecast_review_issue_type ADD VALUE IF NOT EXISTS 'forecast_skipped';
ALTER TABLE skus ADD COLUMN IF NOT EXISTS force_forecast boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: 更新 Drizzle schema**

`packages/db/src/schema/sales-forecast.ts` — 在 `forecastReviewIssueTypeEnum` 数组末加 `'forecast_skipped'`。

`packages/db/src/schema/inventory.ts` — 在 `skus` 表加：

```typescript
forceForecast: boolean('force_forecast').notNull().default(false),
```

- [ ] **Step 3: 本地 migrate**

Run: `cd packages/db && pnpm drizzle-kit push`（或项目惯用 migrate 命令）  
Expected: `force_forecast` 列与枚举值存在

---

### Task 2: `forecast-eligibility` 模块

**Files:**
- Create: `apps/web/server/lib/forecast-eligibility.ts`
- Create: `apps/web/server/lib/forecast-eligibility.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// forecast-eligibility.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateForecastEligibility, classifyVolumeTier } from './forecast-eligibility.js';

describe('evaluateForecastEligibility', () => {
  it('passes when recent90 > 0', () => {
    expect(evaluateForecastEligibility({
      recent30DailyAvg: 1,
      recent90DailyAvg: 2,
      salesDays365: 10,
    })).toEqual({ eligible: true, tier: 'tail' });
  });

  it('skips when no sales signal', () => {
    expect(evaluateForecastEligibility({
      recent30DailyAvg: 0,
      recent90DailyAvg: 0,
      salesDays365: 5,
    })).toEqual({ eligible: false, reason: 'no_recent_sales' });
  });

  it('passes on force_forecast', () => {
    expect(evaluateForecastEligibility({
      recent30DailyAvg: 0,
      recent90DailyAvg: 0,
      salesDays365: 0,
      forceForecast: true,
    })).toEqual({ eligible: true, tier: 'tail' });
  });
});

describe('classifyVolumeTier', () => {
  it('classifies core at 5/day', () => {
    expect(classifyVolumeTier(5)).toBe('core');
    expect(classifyVolumeTier(4.99)).toBe('mid');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @scm/web exec vitest run server/lib/forecast-eligibility.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// forecast-eligibility.ts
export type VolumeTier = 'core' | 'mid' | 'tail';

export type ForecastEligibilityInput = {
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  salesDays365: number;
  forceForecast?: boolean;
};

export type ForecastEligibilityResult =
  | { eligible: true; tier: VolumeTier }
  | { eligible: false; reason: 'no_recent_sales' | 'insufficient_history' };

export function classifyVolumeTier(avgActualDaily: number): VolumeTier {
  if (avgActualDaily >= 5) return 'core';
  if (avgActualDaily >= 1) return 'mid';
  return 'tail';
}

export function evaluateForecastEligibility(
  input: ForecastEligibilityInput,
): ForecastEligibilityResult {
  if (input.forceForecast) {
    const hint = Math.max(input.recent30DailyAvg, input.recent90DailyAvg);
    return { eligible: true, tier: classifyVolumeTier(hint) };
  }
  if (input.recent90DailyAvg > 0 || input.recent30DailyAvg > 0) {
    const hint = Math.max(input.recent30DailyAvg, input.recent90DailyAvg);
    return { eligible: true, tier: classifyVolumeTier(hint) };
  }
  if (input.salesDays365 >= 30) {
    return { eligible: true, tier: 'tail' };
  }
  return { eligible: false, reason: 'no_recent_sales' };
}

export function shouldUseCategoryReference(input: {
  lifecycle: string;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
}): boolean {
  if (input.recent90DailyAvg <= 0) return false;
  if (input.lifecycle === 'intermittent') return false;
  if (input.lifecycle === 'new') return input.recent30DailyAvg > 0;
  return true;
}
```

- [ ] **Step 4: 运行测试通过**

Run: `pnpm --filter @scm/web exec vitest run server/lib/forecast-eligibility.test.ts`  
Expected: PASS

---

### Task 3: 生成链路接入准入 + 品类止血

**Files:**
- Modify: `apps/web/server/lib/forecast-collaboration.ts`（约 629–870 行 SKU 循环）
- Modify: `apps/web/server/lib/forecast-collaboration.test.ts`

- [ ] **Step 1: 扩展 sku 查询含 forceForecast**

```typescript
.select({ id: skus.id, code: skus.code, category: skus.category, forceForecast: skus.forceForecast })
```

- [ ] **Step 2: SKU 循环开头准入判断**

在 `for (const sku of skuRows)` 内、`rawSalesRows` 之后：

```typescript
const eligibility = evaluateForecastEligibility({
  recent30DailyAvg,
  recent90DailyAvg,
  salesDays365: salesDays365,
  forceForecast: sku.forceForecast ?? false,
});
if (!eligibility.eligible) {
  reviewDrafts.push({
    skuId: sku.id,
    station,
    platform,
    issueType: 'forecast_skipped',
    severity: 'info',
    message: `${sku.code} 近 90 天无销量且历史不足，已跳过预测生成`,
    suggestedDailyAvg: 0,
  });
  continue;
}
```

- [ ] **Step 3: 品类参考消费侧**

在调用 `computeForecastDailyAvgForMonth` 前，若 `!shouldUseCategoryReference({ lifecycle, recent30DailyAvg, recent90DailyAvg })`，传 `categoryReferenceDailyAvg: undefined`。

- [ ] **Step 4: 返回 eligibilityStats**

```typescript
return {
  version,
  forecastRows,
  reviewRows,
  eligibilityStats: {
    eligible: eligibleCount,
    skipped: skippedCount,
    byTier: { core, mid, tail },
  },
};
```

- [ ] **Step 5: 测试** — 对 `shouldUseCategoryReference` 与跳过逻辑加纯函数测试  
Run: `pnpm --filter @scm/web exec vitest run server/lib/forecast-collaboration.test.ts`

---

### Task 4: `forecast-accuracy-tier` 与 API

**Files:**
- Create: `apps/web/server/lib/forecast-accuracy-tier.ts`
- Create: `apps/web/server/lib/forecast-accuracy-tier.test.ts`
- Modify: `apps/web/server/routes/sales-forecast.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: 写 tier 模块测试**

```typescript
import { describe, expect, it } from 'vitest';
import { computeWeightedMape, summarizeAccuracyByTier } from './forecast-accuracy-tier.js';

describe('computeWeightedMape', () => {
  it('weights by actual daily', () => {
    const mape = computeWeightedMape([
      { actualDaily: 10, forecastDaily: 8, mape: 0.25 },
      { actualDaily: 1, forecastDaily: 3, mape: 2 },
    ]);
    // WMAPE = (2+2)/(10+1) ≈ 0.3636
    expect(mape).toBeCloseTo(0.3636, 3);
  });
});
```

- [ ] **Step 2: 实现 `summarizeAccuracyByTier`**

输入：`{ skuCode, actualDaily, forecastDaily, mape, biasRate }[]` + 可选 `categoryBySku`。  
输出：`{ global, byTier: Record<VolumeTier | 'skipped', TierStats>, byCategory: CategoryStats[] }`。

- [ ] **Step 3: 新增路由**

`GET /sales-forecasts/accuracy/summary` — query: `versionId`, `year?`, `month?`  
从 `forecast_accuracy_monthly` 拉行 → `summarizeAccuracyByTier`。

- [ ] **Step 4: api.ts 类型 + `fetchForecastAccuracySummary()`**

- [ ] **Step 5: vitest 全通过**

Run: `pnpm --filter @scm/web exec vitest run server/lib/forecast-accuracy-tier.test.ts`

---

### Task 5: 走步回测与脚本复用 tier

**Files:**
- Modify: `apps/web/server/lib/forecast-walkforward-backtest.ts`
- Modify: `apps/web/scripts/analyze-walkforward-csv.ts`

- [ ] **Step 1:** `runWalkForwardAccuracyBacktest` 返回前对准确率行调 `summarizeAccuracyByTier`，写入 `summary` 文本与 `tierSummary` 字段。

- [ ] **Step 2:** 脚本改为 `import { summarizeAccuracyByTier } from '../server/lib/forecast-accuracy-tier.js'`，删除重复分层逻辑。

- [ ] **Step 3: P0 验收走步回测**

Run: `pnpm forecast:walkforward -- --as-of 2026-01-01 --months 6 --station US`  
Expected: 输出含主力/腰部/长尾分层；可比 SKU 数较基线约减半

---

## Phase P1 — 间歇与新品通道（Week 2）

### Task 6: 间歇 SKU 算法分支

**Files:**
- Modify: `apps/web/server/lib/forecast-baseline.ts` — `computeForecastDailyAvgForMonth`
- Modify: `apps/web/server/lib/forecast-baseline.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
it('intermittent lifecycle caps forecast without seasonality', () => {
  const result = computeForecastDailyAvgForMonth({
    recent30DailyAvg: 0.5,
    recent90DailyAvg: 2,
    lastYearSameMonthDailyAvg: 10,
    lifecycle: 'intermittent',
    horizonMonthIndex: 0,
    seasonalityFactor: 1.2,
    trendFactor: 1.1,
    calendarMonth: 6,
  });
  expect(result.forecastDailyAvg).toBeLessThanOrEqual(2.3); // 2 * 1.15
  expect(result.categoryTrendApplied).toBe(true); // factors not applied
});
```

- [ ] **Step 2: 在 `computeForecastDailyAvgForMonth` 顶部加 intermittent 分支**（见设计 5.1）

- [ ] **Step 3: 测试通过**

Run: `pnpm --filter @scm/web exec vitest run server/lib/forecast-baseline.test.ts`

---

### Task 7: 新品 SKU 算法分支

**Files:**
- Modify: `apps/web/server/lib/forecast-baseline.ts`
- Modify: `apps/web/server/lib/forecast-baseline.test.ts`

- [ ] **Step 1: 测试 `lifecycle=new` 时 k=5 的 structural 权重接近 0**

```typescript
it('new lifecycle suppresses yoy structural for far months', () => {
  const near = computeForecastDailyAvgForMonth({
    recent30DailyAvg: 3,
    recent90DailyAvg: 2,
    lastYearSameMonthDailyAvg: 0,
    lifecycle: 'new',
    horizonMonthIndex: 0,
    calendarMonth: 3,
    monthlyRows: [],
    refYear: 2025,
    refMonth: 12,
  });
  const far = computeForecastDailyAvgForMonth({
    ...同上,
    horizonMonthIndex: 5,
  });
  expect(far.forecastDailyAvg).toBeLessThanOrEqual(near.forecastDailyAvg * 1.5);
});
```

- [ ] **Step 2: 实现 new 分支**（设计 5.2：`growth_factor=1`，`rampDecay`）

- [ ] **Step 3: `buildReviewItemsForForecast` 新品 warning 文案**

---

### Task 8: P1 走步回测回归

- [ ] **Step 1:** `pnpm forecast:walkforward -- --sku-code DJ502530_2` — 成熟 SKU 不回归恶化  
- [ ] **Step 2:** 抽 3 个 `DJ505` 新品 SKU 单跑，偏差应低于基线 orders of magnitude  
- [ ] **Step 3:** 记录主力层 WMAPE 到 `docs/samples/forecast-backtest/README.md`

---

## Phase P2 — 成熟 SKU 因子调参（Week 3）

### Task 9: decline / 下滑期季节收缩

**Files:**
- Modify: `apps/web/server/lib/forecast-baseline.ts` — `computeForecastDailyAvgForMonth` 季节/趋势应用段

- [ ] **Step 1: 测试** — `recent30=4, recent90=6, lifecycle=mature` 时有效季节系数向 1 收缩

- [ ] **Step 2: 实现 `shrinkSeasonalityForDecline()` 纯函数**

```typescript
function shrinkSeasonalityForDecline(
  seasonality: number,
  trend: number,
  recent30: number,
  recent90: number,
  lifecycle: SalesLifecycle,
): { seasonality: number; trend: number } {
  const declining =
    lifecycle === 'decline' || (recent90 > 0 && recent30 < recent90 * 0.8);
  if (!declining) return { seasonality, trend };
  return {
    seasonality: 1 + (seasonality - 1) * 0.5,
    trend: Math.min(trend, 1),
  };
}
```

- [ ] **Step 3: 接入 v2 乘积前**

---

### Task 10: 地平线 w_near 下调 + stockout growth 上限

**Files:**
- Modify: `apps/web/server/lib/forecast-baseline.ts` — `computeHorizonBlendWeights` 增加可选 override

- [ ] **Step 1: 测试** — declining mature SKU k=0 时 w_near=0.5

- [ ] **Step 2: `stockout_suspected` 的 `computeYoYGrowthFactor` 结果 `min(..., 1.0)`**

- [ ] **Step 3: 20 SKU 清单走步对比**（DJ502952_1、DJ503734_1 等）文档化到 `docs/samples/forecast-backtest/README.md`

---

### Task 11: P2 全量验收

- [ ] **Step 1:** `pnpm forecast:walkforward` 全量 US  
- [ ] **Step 2:** 主力层 WMAPE ≤45%，高偏差行占比 ≤50%（主力层）  
- [ ] **Step 3:** 未达标则只调 P2 参数，不回退 P0/P1

---

## Phase P3 — 产品化（Week 4）

### Task 12: `ForecastAccuracyTierSummary` 组件

**Files:**
- Create: `apps/web/src/components/ForecastAccuracyTierSummary.tsx`
- Modify: `apps/web/src/pages/SalesForecastPage.tsx`

- [ ] **Step 1: 组件接收 `TierSummary` props，四卡布局（主力/腰/尾/跳过）**

- [ ] **Step 2: accuracy Tab 加载 `fetchForecastAccuracySummary`**

- [ ] **Step 3: 走步回测 mutation 成功后展示 `tierSummary`**

---

### Task 13: 生成页 eligibilityStats + 方法论文档

**Files:**
- Modify: `apps/web/src/pages/SalesForecastPage.tsx` — 生成 Tab
- Modify: `apps/web/src/lib/forecast-methodology.ts`
- Modify: `docs/samples/forecast-backtest/README.md`

- [ ] **Step 1: 生成成功后展示「准入 N / 跳过 M」**

- [ ] **Step 2: 方法论新增「准入与分层」「间歇/新品通道」两节**

---

### Task 14: CLI `--tier` 与妙搭同步

**Files:**
- Modify: `apps/web/scripts/run-forecast-walkforward-backtest.ts`
- 妙搭：`server/hono-app/` 对应文件

- [ ] **Step 1: `--tier=core` 仅过滤 summary 输出**

- [ ] **Step 2: `pnpm zip:miaoda` 前确认 hono-app 同步**

---

## 验证清单（全阶段）

- [ ] `forecast-eligibility.test.ts` / `forecast-accuracy-tier.test.ts` / `forecast-baseline.test.ts` 全绿
- [ ] 准入 SKU 不再为「365 天零销且非 force」写预测行
- [ ] `GET /sales-forecasts/accuracy/summary` 返回 `byTier.core.wmape`
- [ ] 走步回测 summary 含分层块
- [ ] 主力层 WMAPE ≤45%（P2 后）
- [ ] `SalesForecastPage` 准确率 Tab 可见分层卡片
- [ ] `forecast-methodology.ts` 与实现一致

---

## Spec Coverage Self-Review

| 设计章节 | 对应 Task |
|----------|-----------|
| §4 P0 准入 | Task 1–3 |
| §4.2 品类止血 | Task 3 |
| §4.3 分层 KPI | Task 4–5 |
| §4.4 数据模型 | Task 1 |
| §5 P1 间歇/新品 | Task 6–8 |
| §6 P2 调参 | Task 9–11 |
| §7 P3 UI/CLI | Task 12–14 |
| §8 API | Task 4, 12 |
| §10 测试 | 各 Task vitest + walkforward |

无 TBD 占位；`force_forecast` UI 明确 defer 到 backlog（设计 §14）。

---

## 执行选项

**Plan 已保存至 `docs/superpowers/plans/2026-06-30-forecast-v2-optimization.md`。**

1. **Subagent-Driven（推荐）** — 每 Task 派生子 agent，Task 间人工/主 agent 复核  
2. **Inline Execution** — 本会话按 Phase P0→P3 连续实现，每 Phase 末走步回测 checkpoint  

请选择执行方式，或先评审设计 spec §14 开放问题（默认业务优先级 A）。
