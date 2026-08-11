# AI Assist Start-Month Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 辅助预测强制对齐版本 `startMonth`：历史截断至开始月之前，地平线从开始月起整段覆盖写入；无开始月则拒绝。

**Architecture:** 抽出可单测的 asOf / 历史上界解析；`runDifySingleSkuForecast` 要求 `versionId` + 非空 `startMonth`，用 `asOf` 替换全部原 `today` 时间口径；`versionSummary` 暴露 `startMonth`；前端无开始月时禁用 AI。

**Tech Stack:** Hono、现有 `forecast-dify-single` / `forecast-start-month`、React、Node `tsx --test`

## Global Constraints

- 必须有 `versionId`；禁止隐式 `getOrCreateDraftVersion` 建无开始月草稿
- 无 `startMonth` → HTTP 400，文案：`AI 辅助预测需要版本开始月；请带开始月重新生成草稿后再试`
- `asOf = resolveForecastStartMonthAsOf(startMonth)`（UTC 月初）
- 历史 / `historyCapEnd` / 销量查询 max 截止到开始月上月
- 地平线：`buildMonthlyForecastHorizon(asOf, monthCount)`，整段覆盖写入
- 不改 Dify DSL；不写准确率表；不加偏差列；仅草稿可写

**Spec:** `docs/superpowers/specs/2026-08-11-ai-assist-start-month-backtest-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `apps/web/server/lib/forecast-dify-single.ts` | asOf 解析、拒绝无开始月、时间口径改用 asOf |
| `apps/web/server/lib/forecast-dify-single.test.ts` | 扩展单测 |
| `apps/web/server/lib/forecast-sku-context.ts` | `versionSummary.startMonth` |
| `apps/web/src/lib/api.ts` | `ForecastVersionSummary.startMonth` |
| `apps/web/src/components/ForecastAssistPanel.tsx` | 禁用 / 提示 |
| `apps/web/src/components/ForecastSkuDetailDrawer.tsx` | 传入 `startMonth` |

---

### Task 1: 纯函数 — 解析 AI 回测 asOf / 历史上界

**Files:**
- Modify: `apps/web/server/lib/forecast-dify-single.ts`
- Modify: `apps/web/server/lib/forecast-dify-single.test.ts`

**Interfaces:**
- Produces:
  - `export const AI_ASSIST_START_MONTH_REQUIRED_MESSAGE = 'AI 辅助预测需要版本开始月；请带开始月重新生成草稿后再试'`
  - `export function resolveAiAssistBacktestAsOf(startMonth: string | null | undefined): Date` — 空则 throw Error(message)，status 可在调用方设 400
  - `export function resolveAiAssistHistoryMaxMonth(asOf: Date): { year: number; month: number }` — 开始月上月
  - `export function resolveAiAssistHistoryCapEnd(asOf: Date): Date` — `Date.UTC(y, m, 0)` 其中 y/m 来自 asOf

- [ ] **Step 1: Write failing tests**

Append to `forecast-dify-single.test.ts`:

```ts
import {
  AI_ASSIST_START_MONTH_REQUIRED_MESSAGE,
  resolveAiAssistBacktestAsOf,
  resolveAiAssistHistoryMaxMonth,
  resolveAiAssistHistoryCapEnd,
} from './forecast-dify-single.js';

describe('AI assist start-month backtest helpers', () => {
  it('rejects missing startMonth', () => {
    assert.throws(
      () => resolveAiAssistBacktestAsOf(null),
      (err: Error) => err.message === AI_ASSIST_START_MONTH_REQUIRED_MESSAGE,
    );
    assert.throws(() => resolveAiAssistBacktestAsOf('  '));
  });

  it('resolves asOf to UTC month start', () => {
    const asOf = resolveAiAssistBacktestAsOf('2026-02');
    assert.equal(asOf.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('history max is month before start', () => {
    const asOf = resolveAiAssistBacktestAsOf('2026-02');
    assert.deepEqual(resolveAiAssistHistoryMaxMonth(asOf), { year: 2026, month: 1 });
    const asOfJan = resolveAiAssistBacktestAsOf('2026-01');
    assert.deepEqual(resolveAiAssistHistoryMaxMonth(asOfJan), { year: 2025, month: 12 });
  });

  it('historyCapEnd is last day of prior month', () => {
    const asOf = resolveAiAssistBacktestAsOf('2026-02');
    const cap = resolveAiAssistHistoryCapEnd(asOf);
    assert.equal(cap.toISOString().slice(0, 10), '2026-01-31');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-dify-single.test.ts
```

- [ ] **Step 3: Implement helpers** in `forecast-dify-single.ts`:

```ts
import { resolveForecastStartMonthAsOf } from './forecast-start-month.js';

export const AI_ASSIST_START_MONTH_REQUIRED_MESSAGE =
  'AI 辅助预测需要版本开始月；请带开始月重新生成草稿后再试';

export function resolveAiAssistBacktestAsOf(startMonth: string | null | undefined): Date {
  const trimmed = startMonth?.trim();
  if (!trimmed) {
    const err = new Error(AI_ASSIST_START_MONTH_REQUIRED_MESSAGE);
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return resolveForecastStartMonthAsOf(trimmed);
}

export function resolveAiAssistHistoryMaxMonth(asOf: Date): { year: number; month: number } {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function resolveAiAssistHistoryCapEnd(asOf: Date): Date {
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 0));
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-dify-single.ts apps/web/server/lib/forecast-dify-single.test.ts
git commit -m "feat(forecast): AI assist backtest asOf helpers"
```

---

### Task 2: 接线 `runDifySingleSkuForecast`

**Files:**
- Modify: `apps/web/server/lib/forecast-dify-single.ts`（`runDifySingleSkuForecast`）

**Interfaces:**
- Consumes: helpers from Task 1；`version.startMonth`
- Behavior change: 必须 `input.versionId`；去掉成功路径上的 `getOrCreateDraftVersion`

- [ ] **Step 1: Require versionId + startMonth**

Near top of `runDifySingleSkuForecast` after sku lookup:

```ts
if (!input.versionId?.trim()) {
  const err = new Error('versionId is required for AI assist forecast');
  (err as Error & { status: number }).status = 400;
  throw err;
}
const version = await getForecastVersionById(input.versionId);
if (!version) {
  const err = new Error('预测版本不存在');
  (err as Error & { status: number }).status = 404;
  throw err;
}
assertVersionIsDraft(version.id);
const asOf = resolveAiAssistBacktestAsOf(version.startMonth);
```

Remove the `getOrCreateDraftVersion` branch.

- [ ] **Step 2: Replace `today` with `asOf` for all time-sensitive paths**

1. Delete `const today = new Date()`.
2. History load:

```ts
const historyMax = resolveAiAssistHistoryMaxMonth(asOf);
const historyStart = new Date(
  Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (DRAWER_HISTORY_MONTH_COUNT - 1), 1),
);
const monthlyBySku = await loadMonthlySalesBySkuIds({
  skuIds: [sku.id],
  platform,
  minYear: historyStart.getUTCFullYear(),
  minMonth: historyStart.getUTCMonth() + 1,
  maxYear: historyMax.year,
  maxMonth: historyMax.month,
});
const salesHistory = buildSalesHistory24(monthlyRows, asOf);
```

3. Horizon / trend:

```ts
const categoryTrend = buildCategoryTrendForHorizon(
  seasonalityLookup,
  sku.category,
  monthCount,
  asOf,
);
const forecastHorizon = buildMonthlyForecastHorizon(asOf, monthCount).map(...);
```

4. Cap + anchor:

```ts
const historyCapEnd = resolveAiAssistHistoryCapEnd(asOf);
// forecastYear/month from forecastHorizon[0], fallback asOf
```

5. Keep write loop unchanged (whole-horizon upsert).

- [ ] **Step 3: Add one integration-style unit test with mocked workflow（可选若难 mock）**

若现有测试文件无 DB mock，至少加纯函数断言：对 `startMonth=2026-02`、`monthCount=3`：

```ts
import { buildMonthlyForecastHorizon } from './forecast-baseline.js';
import { buildHistoryMonthLabels } from './forecast-horizon.js';

it('horizon and history labels align to startMonth asOf', () => {
  const asOf = resolveAiAssistBacktestAsOf('2026-02');
  const horizon = buildMonthlyForecastHorizon(asOf, 3);
  assert.deepEqual(
    horizon.map((h) => `${h.forecastYear}-${String(h.month).padStart(2, '0')}`),
    ['2026-02', '2026-03', '2026-04'],
  );
  const history = buildHistoryMonthLabels(3, asOf);
  assert.ok(!history.some((h) => h.monthLabel === '2026-02'));
  assert.equal(history.at(-1)?.monthLabel, '2026-01');
});
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-dify-single.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-dify-single.ts apps/web/server/lib/forecast-dify-single.test.ts
git commit -m "feat(forecast): align AI assist horizon to version startMonth"
```

---

### Task 3: `versionSummary.startMonth` + API 类型

**Files:**
- Modify: `apps/web/server/lib/forecast-sku-context.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Return startMonth from summary**

```ts
export type ForecastVersionSummary = {
  monthCount: number;
  monthLabels: string[];
  description: string;
  startMonth: string | null;
};

// in getVersionForecastSummary return:
return {
  monthCount,
  monthLabels,
  startMonth: startMonth || null,
  description: ...
};
```

- [ ] **Step 2: Update frontend type** `ForecastVersionSummary` in `api.ts` 增加 `startMonth: string | null`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/lib/forecast-sku-context.ts apps/web/src/lib/api.ts
git commit -m "feat(forecast): expose startMonth on version summary"
```

（`api.ts` 若有无关脏改动，只提交本任务 hunk。）

---

### Task 4: 前端禁用与提示

**Files:**
- Modify: `apps/web/src/components/ForecastAssistPanel.tsx`
- Modify: `apps/web/src/components/ForecastSkuDetailDrawer.tsx`

- [ ] **Step 1: Props**

`ForecastAssistPanel` 增加：

```ts
startMonth?: string | null;
```

- [ ] **Step 2: Gate AI buttons**

```ts
const hasStartMonth = Boolean(startMonth?.trim());
const aiDisabled = !difyEnabled || !hasStartMonth || aiPending || systemRecompute.isPending;
```

按钮 `disabled={aiDisabled}`；无开始月时在按钮旁或说明区显示：

`本版本无开始月，无法严格回测；请带开始月重新生成草稿`

有开始月时追加：

`按开始月 {startMonth} 严格回测（历史截止上月）`

更新顶部说明，勿再写死「基于今天」。

- [ ] **Step 3: Drawer 传参**

```tsx
<ForecastAssistPanel
  ...
  startMonth={detail?.versionSummary?.startMonth ?? horizonRowData?.version?.startMonth ?? null}
/>
```

若 horizon `version` 尚无 `startMonth` 字段，仅用 `detail.versionSummary.startMonth` 即可（Task 3 已保证）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ForecastAssistPanel.tsx apps/web/src/components/ForecastSkuDetailDrawer.tsx
git commit -m "feat(forecast): gate AI assist when version lacks startMonth"
```

---

### Task 5: 验证与收尾

- [ ] **Step 1: Run**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-dify-single.test.ts
```

Expected: all PASS

- [ ] **Step 2: Spec status → 已实现**

`docs/superpowers/specs/2026-08-11-ai-assist-start-month-backtest-design.md`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-ai-assist-start-month-backtest-design.md
git commit -m "docs(forecast): mark AI assist start-month backtest implemented"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 必须 versionId | Task 2 |
| 无 startMonth → 400 + 文案 | Task 1–2 |
| asOf UTC 月初 | Task 1 |
| 历史 / max / historyCapEnd | Task 1–2 |
| 地平线从开始月起 | Task 2 |
| 整段覆盖写入 | Task 2（保持现逻辑） |
| versionSummary.startMonth | Task 3 |
| 前端禁用 + 提示 | Task 4 |
| 单测 | Task 1–2, 5 |
