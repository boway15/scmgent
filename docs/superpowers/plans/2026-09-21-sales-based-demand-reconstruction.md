# 销量反推需求还原 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主力 SKU 的近 30/90 日均改为「销量合计 ÷ 非缺货天数」（封顶 1.5×），长尾/新品/间歇不放大，并让走步回测与线上生成走同一函数。

**Architecture:** 新增纯函数模块 `forecast-demand-unconstrain.ts`，复用现有 `collectStockoutExcludedDates`。预测生成、SKU 上下文、校准脚本改吃该函数的 `unconstrainedDaily`；生命周期与准入仍用还原前的日历日均。审计字段写入已有 `horizon_factors` JSON，不建新表。

**Tech Stack:** TypeScript、Node `tsx --test`（`node:test`）、现有 `forecast-baseline.ts` / `forecast-collaboration.ts`。

**设计基线:** [2026-09-21-sales-based-demand-reconstruction-design.md](../specs/2026-09-21-sales-based-demand-reconstruction-design.md)

## Global Constraints

- 缺货只按销量连续零销反推；禁止用 `inventory_daily_snapshots` 当预测分母。
- 主力门槛：还原前 `calendar_daily_90 ≥ 1`；连续 ≥7 天 qty=0；有效天数 / 窗口 ≥ 0.3；`U ≤ 1.5 × calendar_daily`。
- `lifecycle` 为 `new` 或 `intermittent` 时不还原；`stockout_suspected` / `mature` / `growth` / `decline` 可以还原。
- 生命周期、准入用 **未还原** 日历近窗；`near_level` 与 V4.1 近端用 **还原后** `U`。
- 上市前（`firstSaleDate` 之前）零销不算缺货。
- 阶段 A 关闭预测主路径的月序列 2σ 大促压顶；整月有效天数为 0 时保持 0，禁止品类均值填洞。
- 测试命令：`pnpm --filter @scm/web exec tsx --test <file>`（工作目录为 `apps/web`）。不要做妙搭 ZIP/CJS 同步。
- 用户未要求时不要 `git push`；每任务末步可本地 commit。

---

## File Structure

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `apps/web/server/lib/forecast-demand-unconstrain.ts` | 近窗/月序列还原纯函数与常量 |
| Create | `apps/web/server/lib/forecast-demand-unconstrain.test.ts` | §3.2 验收用例 |
| Modify | `apps/web/server/lib/forecast-baseline.ts` | 可选审计字段并入 `HorizonFactorSnapshot` / `parseHorizonFactors` |
| Modify | `apps/web/server/lib/forecast-collaboration.ts` | 生成近窗改 `U`；C 类月序列改还原；审计写入 factors |
| Modify | `apps/web/server/lib/forecast-sku-context.ts` | 查询复盘近窗与生成一致 |
| Modify | `apps/web/server/lib/forecast-profile-calibration.ts` | 校准近窗与生成一致 |
| Modify | `apps/web/server/lib/forecast-a-class-calibration.ts` | A 类校准近窗与生成一致 |
| Modify | `apps/web/server/lib/forecast-allcat-v41.ts` | V4.1 `horizonFactors` 合并还原审计 |
| Modify | `apps/web/server/lib/forecast-monthly-clean.ts` | `winsorizePromo` 开关，默认保持旧测例 |
| Modify | `apps/web/server/lib/forecast-seasonality-rebuild.ts` | 季节重建关闭 promo 压顶（无日表则不做日级还原） |
| Modify | `apps/web/server/lib/forecast-walkforward-backtest.ts` | 主力层加「vs 还原月需求」WMAPE |
| Modify | `apps/web/src/lib/forecast-methodology.ts` | 口径与实现一致 |
| Modify | `apps/web/server/lib/forecast-collaboration.test.ts` | 若有近窗断言则对齐 |
| 不改 | `packages/db` | 无新列 |

需求计划试点生成 `U` 时 **import 本模块**，不要再写库存有货日公式（见需求计划 spec §6.2 修订）。本计划不实现需求计划表。

---

### Task 1: 近窗还原纯函数

**Files:**
- Create: `apps/web/server/lib/forecast-demand-unconstrain.ts`
- Create: `apps/web/server/lib/forecast-demand-unconstrain.test.ts`
- Modify: `apps/web/server/lib/forecast-baseline.ts`（仅 `collectStockoutExcludedDates` 已存在，本任务只消费它）

**Interfaces:**
- Consumes: `collectStockoutExcludedDates`, `roundDaily`, `SalesLifecycle` from `forecast-baseline.js`
- Produces: `unconstrainRecentDaily`, constants, `UnconstrainRecentDailyResult`, `DemandReconstructAudit`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unconstrainRecentDaily } from './forecast-demand-unconstrain.js';

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function daysBetweenInclusive(start: Date, end: Date): Array<{ saleDate: string; qtySold: number }> {
  const rows: Array<{ saleDate: string; qtySold: number }> = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    rows.push({ saleDate: new Date(t).toISOString().slice(0, 10), qtySold: 0 });
  }
  return rows;
}

describe('unconstrainRecentDaily', () => {
  it('reconstructs core SKU: 100 sold in 70 days, 20 consecutive zeros → U=100/70 capped by 1.5×calendar', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03'); // 90 days
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows) {
      if (row.saleDate <= '2026-05-11') row.qtySold = 100 / 70;
    }
    const qtySum = rows.reduce((s, r) => s + r.qtySold, 0);
    assert.ok(Math.abs(qtySum - 100) < 0.01);

    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, true);
    assert.equal(result.stockoutDays, 20);
    assert.equal(result.effectiveDays, 70);
    assert.equal(result.skipReason, null);
    const calendar = 100 / 90;
    const expected = Math.min(100 / 70, 1.5 * calendar);
    assert.ok(Math.abs(result.unconstrainedDaily - expected) < 1e-4);
    assert.equal(result.reconstructCapHit, false);
  });

  it('does not reconstruct tail when calendar 90 daily < 1', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows.slice(0, 10)) row.qtySold = 2;
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, false);
    assert.equal(result.skipReason, 'tail');
    assert.equal(result.unconstrainedDaily, result.calendarDaily);
  });

  it('does not reconstruct new or intermittent', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows.slice(0, 70)) row.qtySold = 2;
    for (const lifecycle of ['new', 'intermittent'] as const) {
      const result = unconstrainRecentDaily({
        sales: rows,
        windowStart,
        windowEnd,
        lifecycle,
        firstSaleDate: '2026-04-01',
      });
      assert.equal(result.reconstructed, false);
      assert.equal(result.skipReason, lifecycle);
    }
  });

  it('skips coverage_insufficient when effective days < 30% of window', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows.slice(0, 20)) row.qtySold = 10;
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2025-01-01',
    });
    assert.equal(result.reconstructed, false);
    assert.equal(result.skipReason, 'coverage_insufficient');
  });

  it('ignores zeros before firstSaleDate', () => {
    const windowEnd = utcDate('2026-05-31');
    const windowStart = utcDate('2026-03-03');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    for (const row of rows) {
      if (row.saleDate >= '2026-05-01') row.qtySold = 5;
    }
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2026-05-01',
    });
    assert.equal(result.skipReason === 'no_run' || result.stockoutDays === 0, true);
  });

  it('caps at 1.5× calendar daily', () => {
    const windowEnd = utcDate('2026-04-29');
    const windowStart = utcDate('2026-01-30');
    const rows = daysBetweenInclusive(windowStart, windowEnd);
    const windowDays = rows.length;
    const sellDays = Math.ceil(windowDays * 0.32);
    for (const row of rows.slice(0, sellDays)) row.qtySold = 8;
    const result = unconstrainRecentDaily({
      sales: rows,
      windowStart,
      windowEnd,
      lifecycle: 'mature',
      firstSaleDate: '2024-01-01',
    });
    if (result.reconstructed) {
      assert.ok(result.unconstrainedDaily <= result.calendarDaily * 1.5 + 1e-9);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand-unconstrain.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`apps/web/server/lib/forecast-demand-unconstrain.ts`:

```ts
import {
  collectStockoutExcludedDates,
  roundDaily,
  type SalesLifecycle,
} from './forecast-baseline.js';

export const UNCONSTRAIN_VOLUME_MIN_DAILY = 1;
export const UNCONSTRAIN_MIN_RUN_DAYS = 7;
export const UNCONSTRAIN_MIN_EFFECTIVE_RATIO = 0.3;
export const UNCONSTRAIN_CAP_RATIO = 1.5;

export type ReconstructSkipReason =
  | 'tail'
  | 'new'
  | 'intermittent'
  | 'no_run'
  | 'coverage_insufficient';

export type UnconstrainRecentDailyResult = {
  calendarDaily: number;
  unconstrainedDaily: number;
  reconstructed: boolean;
  stockoutDays: number;
  effectiveDays: number;
  windowDays: number;
  reconstructCapHit: boolean;
  skipReason: ReconstructSkipReason | null;
};

export type DemandReconstructAudit = {
  demandReconstructed: boolean;
  stockoutDays90: number;
  effectiveDays90: number;
  calendarDaily90: number;
  unconstrainedDaily90: number;
  reconstructCapHit: boolean;
  reconstructSkipReason: ReconstructSkipReason | null;
};

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function countInclusiveWindowDays(windowStart: Date, windowEnd: Date): number {
  const start = Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate(),
  );
  const end = Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate());
  return Math.floor((end - start) / 86400000) + 1;
}

export function sumQtyInWindow(
  sales: Array<{ saleDate: string; qtySold: number }>,
  windowStart: Date,
  windowEnd: Date,
): number {
  const startKey = toDateKey(windowStart);
  const endKey = toDateKey(windowEnd);
  let sum = 0;
  for (const row of sales) {
    const key = String(row.saleDate).slice(0, 10);
    if (key < startKey || key > endKey) continue;
    sum += Number(row.qtySold) || 0;
  }
  return sum;
}

export function unconstrainRecentDaily(input: {
  sales: Array<{ saleDate: string; qtySold: number }>;
  windowStart: Date;
  windowEnd: Date;
  lifecycle: SalesLifecycle;
  firstSaleDate?: string | null;
}): UnconstrainRecentDailyResult {
  const windowDays = countInclusiveWindowDays(input.windowStart, input.windowEnd);
  const qtySum = sumQtyInWindow(input.sales, input.windowStart, input.windowEnd);
  const calendarDaily = windowDays > 0 ? qtySum / windowDays : 0;

  const skip = (reason: ReconstructSkipReason): UnconstrainRecentDailyResult => ({
    calendarDaily: roundDaily(calendarDaily),
    unconstrainedDaily: roundDaily(calendarDaily),
    reconstructed: false,
    stockoutDays: 0,
    effectiveDays: windowDays,
    windowDays,
    reconstructCapHit: false,
    skipReason: reason,
  });

  if (input.lifecycle === 'new') return skip('new');
  if (input.lifecycle === 'intermittent') return skip('intermittent');
  if (calendarDaily < UNCONSTRAIN_VOLUME_MIN_DAILY) return skip('tail');

  const excluded = collectStockoutExcludedDates(
    input.sales,
    input.windowStart,
    input.windowEnd,
    UNCONSTRAIN_MIN_RUN_DAYS,
  );
  const firstSale = input.firstSaleDate?.slice(0, 10) ?? null;
  if (firstSale) {
    for (const key of [...excluded]) {
      if (key < firstSale) excluded.delete(key);
    }
  }
  const stockoutDays = excluded.size;
  if (stockoutDays === 0) return skip('no_run');

  const effectiveDays = windowDays - stockoutDays;
  if (effectiveDays <= 0 || effectiveDays / windowDays < UNCONSTRAIN_MIN_EFFECTIVE_RATIO) {
    return skip('coverage_insufficient');
  }

  const rawU = qtySum / effectiveDays;
  const cap = calendarDaily * UNCONSTRAIN_CAP_RATIO;
  const reconstructCapHit = rawU > cap + 1e-12;
  const unconstrainedDaily = reconstructCapHit ? cap : rawU;

  return {
    calendarDaily: roundDaily(calendarDaily),
    unconstrainedDaily: roundDaily(unconstrainedDaily),
    reconstructed: true,
    stockoutDays,
    effectiveDays,
    windowDays,
    reconstructCapHit,
    skipReason: null,
  };
}

export function toDemandReconstructAudit(
  result90: UnconstrainRecentDailyResult,
): DemandReconstructAudit {
  return {
    demandReconstructed: result90.reconstructed,
    stockoutDays90: result90.stockoutDays,
    effectiveDays90: result90.effectiveDays,
    calendarDaily90: result90.calendarDaily,
    unconstrainedDaily90: result90.unconstrainedDaily,
    reconstructCapHit: result90.reconstructCapHit,
    reconstructSkipReason: result90.skipReason,
  };
}

export function applySkuVolumeGate(
  result: UnconstrainRecentDailyResult,
  calendarDaily90: number,
): UnconstrainRecentDailyResult {
  if (calendarDaily90 >= UNCONSTRAIN_VOLUME_MIN_DAILY) return result;
  if (result.skipReason === 'tail') return result;
  return {
    ...result,
    reconstructed: false,
    unconstrainedDaily: result.calendarDaily,
    reconstructCapHit: false,
    skipReason: 'tail',
    stockoutDays: 0,
    effectiveDays: result.windowDays,
  };
}
```

近 30 天调用同一函数时：先算 90 天 `calendarDaily`，再对 30 天结果 `applySkuVolumeGate(result30, calendar90)`，保证「是否主力」只看 90 天日历日均。

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand-unconstrain.test.ts`

Expected: `fail 0`。若「100/70」用例因窗口起止不是整 90 天失败，把测试的 `windowStart` 改成 `end - 89 days`（与现网 `addDays(end, -89)` 一致），不要改公式去迁就错误窗口。

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-demand-unconstrain.ts apps/web/server/lib/forecast-demand-unconstrain.test.ts
git commit -m "$(cat <<'EOF'
feat: add sales-based unconstrained recent daily demand

Use in-stock-day denominators for core SKUs so stockout zeros stop depressing near-window averages.
EOF
)"
```

---

### Task 2: 月序列还原（有日销量时）

**Files:**
- Modify: `apps/web/server/lib/forecast-demand-unconstrain.ts`
- Modify: `apps/web/server/lib/forecast-demand-unconstrain.test.ts`
- Modify: `apps/web/server/lib/forecast-monthly-clean.ts`

**Interfaces:**
- Consumes: `unconstrainRecentDaily` 的缺货日集合逻辑（`collectStockoutExcludedDates`）
- Produces: `unconstrainMonthQty`, `unconstrainLast12MonthlyQty`

- [ ] **Step 1: Write the failing tests**（追加到同一测试文件）

```ts
import { daysInCalendarMonth } from './forecast-baseline.js';
import { unconstrainMonthQty, unconstrainLast12MonthlyQty } from './forecast-demand-unconstrain.js';

it('scales a month with a 10-day zero run using selling-day average, cap 1.5×', () => {
  const rows: Array<{ saleDate: string; qtySold: number }> = [];
  for (let d = 1; d <= 31; d += 1) {
    const saleDate = `2026-05-${String(d).padStart(2, '0')}`;
    rows.push({ saleDate, qtySold: d <= 10 ? 0 : 5 });
  }
  const rawQty = 21 * 5;
  const result = unconstrainMonthQty({
    year: 2026,
    month: 5,
    rawQty,
    dailySales: rows,
    skuMayUnconstrain: true,
    firstSaleDate: '2025-01-01',
  });
  const sellingDays = 21;
  const expected = Math.min((rawQty / sellingDays) * 31, rawQty * 1.5);
  assert.equal(result.stockoutFullMonth, false);
  assert.ok(Math.abs(result.cleanedQty - expected) < 1e-4);
});

it('keeps zero when the whole month is stockout after prior sales', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    saleDate: `2026-04-${String(i + 1).padStart(2, '0')}`,
    qtySold: 0,
  }));
  const result = unconstrainMonthQty({
    year: 2026,
    month: 4,
    rawQty: 0,
    dailySales: rows,
    skuMayUnconstrain: true,
    firstSaleDate: '2025-01-01',
  });
  assert.equal(result.cleanedQty, 0);
  assert.equal(result.stockoutFullMonth, true);
});

it('leaves month unchanged when skuMayUnconstrain is false', () => {
  const result = unconstrainMonthQty({
    year: 2026,
    month: 5,
    rawQty: 40,
    dailySales: [],
    skuMayUnconstrain: false,
    firstSaleDate: '2025-01-01',
  });
  assert.equal(result.cleanedQty, 40);
  assert.equal(result.reconstructed, false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand-unconstrain.test.ts`

Expected: FAIL（`unconstrainMonthQty` 未导出）

- [ ] **Step 3: Implement monthly helpers**

在 `forecast-demand-unconstrain.ts` 追加：

```ts
export type UnconstrainMonthQtyResult = {
  cleanedQty: number;
  rawQty: number;
  reconstructed: boolean;
  stockoutFullMonth: boolean;
};

function monthBounds(year: number, month: number): { start: Date; end: Date; days: number } {
  const days = daysInCalendarMonth(year, month);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month - 1, days)),
    days,
  };
}

export function unconstrainMonthQty(input: {
  year: number;
  month: number;
  rawQty: number;
  dailySales: Array<{ saleDate: string; qtySold: number }>;
  skuMayUnconstrain: boolean;
  firstSaleDate?: string | null;
}): UnconstrainMonthQtyResult {
  const rawQty = Math.max(0, Number(input.rawQty) || 0);
  if (!input.skuMayUnconstrain) {
    return { cleanedQty: rawQty, rawQty, reconstructed: false, stockoutFullMonth: false };
  }
  const { start, end, days } = monthBounds(input.year, input.month);
  const excluded = collectStockoutExcludedDates(
    input.dailySales,
    start,
    end,
    UNCONSTRAIN_MIN_RUN_DAYS,
  );
  const firstSale = input.firstSaleDate?.slice(0, 10) ?? null;
  if (firstSale) {
    for (const key of [...excluded]) {
      if (key < firstSale) excluded.delete(key);
    }
  }
  if (excluded.size === 0) {
    return { cleanedQty: rawQty, rawQty, reconstructed: false, stockoutFullMonth: false };
  }
  const sellingDays = days - excluded.size;
  if (sellingDays <= 0) {
    return { cleanedQty: 0, rawQty, reconstructed: false, stockoutFullMonth: true };
  }
  const monthU = (rawQty / sellingDays) * days;
  const cleanedQty = roundDaily(Math.min(monthU, rawQty * UNCONSTRAIN_CAP_RATIO));
  return { cleanedQty, rawQty, reconstructed: cleanedQty !== rawQty, stockoutFullMonth: false };
}

export function unconstrainLast12MonthlyQty(input: {
  monthlyQty: number[];
  asOf: Date;
  dailySales: Array<{ saleDate: string; qtySold: number }>;
  skuMayUnconstrain: boolean;
  firstSaleDate?: string | null;
}): number[] {
  const qty = input.monthlyQty.slice();
  let y = input.asOf.getUTCFullYear();
  let m = input.asOf.getUTCMonth() + 1;
  for (let i = qty.length - 1; i >= 0; i -= 1) {
    const cell = unconstrainMonthQty({
      year: y,
      month: m,
      rawQty: qty[i] ?? 0,
      dailySales: input.dailySales,
      skuMayUnconstrain: input.skuMayUnconstrain,
      firstSaleDate: input.firstSaleDate,
    });
    qty[i] = cell.cleanedQty;
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return qty;
}
```

在文件顶部增加 `import { collectStockoutExcludedDates, daysInCalendarMonth, roundDaily, type SalesLifecycle } from './forecast-baseline.js';`

`forecast-monthly-clean.ts` 给 `cleanMonthlyQtyForTraining` 增加可选 `winsorizePromo?: boolean`（默认 `true`，旧测例不变）。当 `winsorizePromo === false` 时，`promo` 月保持 `rawQty`，`anomaly` 仍可标记但不改值。

- [ ] **Step 4: Re-run tests**

Run:

```
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand-unconstrain.test.ts server/lib/forecast-monthly-clean.test.ts
```

Expected: `fail 0`。给 `forecast-monthly-clean.test.ts` 加一例：`winsorizePromo: false` 时 200 不被压顶。

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-demand-unconstrain.ts apps/web/server/lib/forecast-demand-unconstrain.test.ts apps/web/server/lib/forecast-monthly-clean.ts apps/web/server/lib/forecast-monthly-clean.test.ts
git commit -m "$(cat <<'EOF'
feat: unconstrain monthly qty from consecutive zero-sales runs

Stop filling full-month stockouts with category means and skip promo winsorizing when requested.
EOF
)"
```

---

### Task 3: 预测生成接入近窗 `U` 与审计字段

**Files:**
- Modify: `apps/web/server/lib/forecast-baseline.ts`（`HorizonFactorSnapshot` + `parseHorizonFactors`）
- Modify: `apps/web/server/lib/forecast-collaboration.ts`
- Modify: `apps/web/server/lib/forecast-allcat-v41.ts`
- Modify: `apps/web/server/lib/forecast-baseline.test.ts`（parse 可选字段）
- Modify: `apps/web/server/lib/forecast-seasonality-rebuild.ts`

**Interfaces:**
- Consumes: `unconstrainRecentDaily`, `applySkuVolumeGate`, `toDemandReconstructAudit`, `unconstrainLast12MonthlyQty`
- Produces: 生成路径 `recent30DailyAvg`/`recent90DailyAvg` 为 `U`；`horizon_factors` 含审计键

- [ ] **Step 1: 扩展 snapshot 类型（可选字段，旧 JSON 仍能 parse）**

`HorizonFactorSnapshot` 增加：

```ts
  demandReconstructed?: boolean;
  stockoutDays90?: number;
  effectiveDays90?: number;
  calendarDaily90?: number;
  unconstrainedDaily90?: number;
  reconstructCapHit?: boolean;
  reconstructSkipReason?: string | null;
```

`parseHorizonFactors` 在成功解析 8 个必填数后，若 `value.demandReconstructed === true` 则带上其余审计字段；缺省忽略。

`computeForecastDailyAvgForMonth` 的 `horizonFactors` 展开 `input.demandReconstruct`（若传入）。`MonthlyForecastDailyAvgResult` 输入类型增加可选 `demandReconstruct?: DemandReconstructAudit`。

V4.1：`buildAllCatV41HorizonFactors` 之后 `Object.assign(horizonFactors, input.demandReconstruct ?? {})`。给 `computeAllCatV41ForecastForMonth` 增加可选 `demandReconstruct?: DemandReconstructAudit`。

- [ ] **Step 2: 写失败测例 — parse 保留审计**

在 `forecast-baseline.test.ts`：

```ts
it('parseHorizonFactors keeps demand reconstruct audit when present', () => {
  const parsed = parseHorizonFactors({
    nearLevel: 1,
    structuralLevel: 1,
    yoyMonthLevel: 1,
    yoyAnchorLevel: 1,
    growthFactor: 1,
    wNear: 0.65,
    wYoy: 0.35,
    horizonMonthIndex: 0,
    demandReconstructed: true,
    stockoutDays90: 20,
    unconstrainedDaily90: 1.4286,
  });
  assert.equal(parsed?.demandReconstructed, true);
  assert.equal(parsed?.stockoutDays90, 20);
});
```

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-baseline.test.ts`

Expected: 先 FAIL（字段被丢掉），实现后 PASS。

- [ ] **Step 3: 改 `forecast-collaboration.ts` 近窗**

不要再用「剔除零销行后仍 ÷30/÷90」。

对每个 SKU（两处循环：category 参考循环 + 生成循环）统一：

```ts
const calendar90 = roundDaily(sumQtySince(rawSalesRows, recent90Since) / 90);
const calendar30 = roundDaily(sumQtySince(rawSalesRows, recent30Since) / 30);
const salesDays90 = countSalesDaysSince(rawSalesRows, recent90Since);
const ageDays = computeAgeDaysFromFirstSale(firstSaleDate, today);
const maxZeroRunDays = computeMaxZeroRunDays(rawSalesRows, recent90Since, recentWindowEnd);
const lifecycle = classifySalesLifecycle({
  ageDays,
  salesDayRatio90: salesDays90 / 90,
  recent30DailyAvg: calendar30,
  recent90DailyAvg: calendar90,
  maxZeroRunDays,
});
const recon90 = unconstrainRecentDaily({
  sales: rawSalesRows,
  windowStart: recent90Since,
  windowEnd: recentWindowEnd,
  lifecycle,
  firstSaleDate,
});
const recon30raw = unconstrainRecentDaily({
  sales: rawSalesRows,
  windowStart: recent30Since,
  windowEnd: recentWindowEnd,
  lifecycle,
  firstSaleDate,
});
const recon30 = applySkuVolumeGate(recon30raw, recon90.calendarDaily);
const recent90DailyAvg = recon90.unconstrainedDaily;
const recent30DailyAvg = recon30.unconstrainedDaily;
const demandReconstruct = toDemandReconstructAudit(recon90);
```

`evaluateForecastEligibility` 继续传入 **calendar30/calendar90**（未还原），避免缺货 SKU 被还原后挤进准入。

`platformLookbackQty` 用 `rawSalesRows` 合计，不要用剔除后的行。

可以删除这两处的 `filterSalesRowsExcludingDates`（若无其它用途）。

生成每个月预测时把 `demandReconstruct` 传入 `computeForecastDailyAvgForMonth` / `computeAllCatV41ForecastForMonth`。

C 类池：

```ts
const skuMayUnconstrain = recon90.reconstructed || recon90.skipReason === null && recon90.calendarDaily >= 1;
// 更稳：skuMayUnconstrain = lifecycle 非 new/intermittent 且 calendar90 >= 1
const cleanedForPool = useMonthlyAbcd
  ? unconstrainLast12MonthlyQty({
      monthlyQty: rawMonthlyQty,
      asOf: recentWindowEnd,
      dailySales: rawSalesRows,
      skuMayUnconstrain:
        calendar90 >= 1 && lifecycle !== 'new' && lifecycle !== 'intermittent',
      firstSaleDate,
    })
  : rawMonthlyQty;
```

第一段循环算 `recent90BySkuId` 时同样走 `unconstrainRecentDaily`（lifecycle 用日历近窗，需在该循环内算 calendar/lifecycle，或先不还原 category 中位数——**规定：category 参考用 calendar90**，避免中位数被主力还原抬高。即第一段循环保持 `sum/90` 日历日均；只有生成循环与校准用 `U`）。

- [ ] **Step 4: 季节重建**

`forecast-seasonality-rebuild.ts`：`cleanMonthlyQtyForTraining(monthlyQty, { winsorizePromo: false })`。无日表，不在此做 7 天零销还原。

- [ ] **Step 5: 跑生成相关单测**

Run:

```
pnpm --filter @scm/web exec tsx --test server/lib/forecast-baseline.test.ts server/lib/forecast-collaboration.test.ts server/lib/forecast-allcat-v41.test.ts server/lib/forecast-demand-unconstrain.test.ts
```

Expected: `fail 0`。若 collaboration 测例断言旧近窗，按「日历准入 + U 近端」改断言，不要改回 ÷90。

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/lib/forecast-baseline.ts apps/web/server/lib/forecast-baseline.test.ts apps/web/server/lib/forecast-collaboration.ts apps/web/server/lib/forecast-allcat-v41.ts apps/web/server/lib/forecast-seasonality-rebuild.ts
git commit -m "$(cat <<'EOF'
fix: use unconstrained recent demand in forecast generation

Keep eligibility and lifecycle on calendar averages so stockouts are not treated as growth.
EOF
)"
```

---

### Task 4: 查询与校准路径对齐

**Files:**
- Modify: `apps/web/server/lib/forecast-sku-context.ts`
- Modify: `apps/web/server/lib/forecast-profile-calibration.ts`
- Modify: `apps/web/server/lib/forecast-a-class-calibration.ts`

**Interfaces:**
- Consumes: 与 Task 3 相同的近窗调用顺序
- Produces: 抽屉/校准 `recent30/90` 与生成一致

- [ ] **Step 1: 抽出共享 helper，避免三处复制**

在 `forecast-demand-unconstrain.ts` 增加：

```ts
export function resolveRecentDemandWindows(input: {
  sales: Array<{ saleDate: string; qtySold: number }>;
  recent30Since: Date;
  recent90Since: Date;
  recentWindowEnd: Date;
  lifecycle: SalesLifecycle;
  firstSaleDate?: string | null;
}): {
  calendar30: number;
  calendar90: number;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  recon30: UnconstrainRecentDailyResult;
  recon90: UnconstrainRecentDailyResult;
  demandReconstruct: DemandReconstructAudit;
} {
  const recon90 = unconstrainRecentDaily({
    sales: input.sales,
    windowStart: input.recent90Since,
    windowEnd: input.recentWindowEnd,
    lifecycle: input.lifecycle,
    firstSaleDate: input.firstSaleDate,
  });
  const recon30 = applySkuVolumeGate(
    unconstrainRecentDaily({
      sales: input.sales,
      windowStart: input.recent30Since,
      windowEnd: input.recentWindowEnd,
      lifecycle: input.lifecycle,
      firstSaleDate: input.firstSaleDate,
    }),
    recon90.calendarDaily,
  );
  return {
    calendar30: recon30.calendarDaily,
    calendar90: recon90.calendarDaily,
    recent30DailyAvg: recon30.unconstrainedDaily,
    recent90DailyAvg: recon90.unconstrainedDaily,
    recon30,
    recon90,
    demandReconstruct: toDemandReconstructAudit(recon90),
  };
}
```

注意：`unconstrainRecentDaily` 在 skip 时也设置 `calendarDaily`。lifecycle 必须在调用前用 **日历** `sum/30`、`sum/90` 算好（helper 不负责 classify）。

协作文件改用 `resolveRecentDemandWindows`，删掉 Task 3 里内联的重复块。

- [ ] **Step 2: 三个校准/上下文文件**

`forecast-sku-context.ts`、`forecast-profile-calibration.ts`、`forecast-a-class-calibration.ts`：

1. `calendar30/90 = sum(raw)/30/90`（raw，不剔除）
2. `classifySalesLifecycle` 用 calendar
3. `resolveRecentDemandWindows` 得到用于模型的 `recent30DailyAvg/recent90DailyAvg`

`forecast-a-class-calibration.ts` 里 `ageDays: 365` 硬编码保持不动（该文件原行为）。

- [ ] **Step 3: 跑相关测试**

Run:

```
pnpm --filter @scm/web exec tsx --test server/lib/forecast-sku-context.test.ts server/lib/forecast-demand-unconstrain.test.ts server/lib/forecast-collaboration.test.ts server/lib/forecast-a-class-calibration.ts
```

最后一项若不是测试文件则改为该目录已有 `forecast-a-class*.test.ts`（用 glob：`server/lib/forecast-a-class*.test.ts` `server/lib/forecast-profile-calibration*.test.ts`）。没有测例则补一个：sku-context 在 20 天连续 0 + 主力销量时 `recent90DailyAvg > calendar90`。

Expected: `fail 0`

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/lib/forecast-demand-unconstrain.ts apps/web/server/lib/forecast-collaboration.ts apps/web/server/lib/forecast-sku-context.ts apps/web/server/lib/forecast-profile-calibration.ts apps/web/server/lib/forecast-a-class-calibration.ts
git commit -m "$(cat <<'EOF'
fix: share unconstrained recent windows across forecast context paths

Drawer and calibration now match generation so stockout SKUs are not scored on calendar averages.
EOF
)"
```

---

### Task 5: 走步回测双口径 + 方法论

**Files:**
- Modify: `apps/web/server/lib/forecast-walkforward-backtest.ts`
- Modify: `apps/web/src/lib/forecast-methodology.ts`
- Modify: `apps/web/server/lib/forecast-demand-unconstrain.ts`（若需 `unconstrainMonthQty` 算实际月）

**Interfaces:**
- Consumes: 生成侧已是 `U`（经营回测 vs 原始实际不变）
- Produces: 汇总多一行 `wmapeVsUnconstrainedDemand`（仅主力、该月发生月级还原时）

- [ ] **Step 1: 在 walkforward 月准确率循环里**

对每个 SKU×月，在已有 `actualDaily`（原始销量/当月天数）之外：

```ts
const monthU = unconstrainMonthQty({
  year: forecastYear,
  month,
  rawQty: actualDaily * daysInCalendarMonth(forecastYear, month),
  dailySales: skuDailyRowsForThatMonth,
  skuMayUnconstrain: calendar90AtAsOf >= 1 && lifecycle !== 'new' && lifecycle !== 'intermittent',
  firstSaleDate,
});
const unconstrainedActualDaily = monthU.stockoutFullMonth
  ? actualDaily
  : monthU.cleanedQty / daysInCalendarMonth(forecastYear, month);
```

`skuMayUnconstrain` 用 **asOf 时** 的日历近 90 与 lifecycle（与生成一致），不要用「未来实际」泄漏。

加权 WMAPE 第二套：`actual = unconstrainedActualDaily`，仅 `unconstrainedActualDaily > 0`。写入现有 markdown/JSON 摘要字段 `unconstrainedWmape`，缺日销量则该字段 `null`（不编数）。

若 walkforward 当前拿不到日序列，只在已加载 `dailyBySku` 的路径计算；否则打印 `unconstrainedWmape: skipped_no_daily`。禁止为双口径再打一遍库存 API。

- [ ] **Step 2: 改方法论「断货抑制规则」表**

`apps/web/src/lib/forecast-methodology.ts` 中「零销段剔除」改为：

| 规则 | 条件 | 处理 | 影响 |
| 有销日折算 | 日历近90日均≥1，非新品/间歇，连续≥7天为0，有效天数≥30%窗口 | `U=min(sum/有效天数, 1.5×日历日均)` | 近端不再被缺货零压低 |
| 不还原 | 长尾/新品/间歇/无连续零销/覆盖不足 | 仍用日历 ÷30/÷90 | 避免把卖不动写成缺货 |

删掉「从窗口剔除后再 ÷90」的过时描述。

- [ ] **Step 3: 跑测**

Run:

```
pnpm --filter @scm/web exec tsx --test server/lib/forecast-walkforward-backtest.ts server/lib/forecast-demand-unconstrain.test.ts
```

若 walkforward 无单测文件，运行 `server/lib/forecast-accuracy*.test.ts` 中会 import 该模块的文件。Expected: `fail 0`

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/lib/forecast-walkforward-backtest.ts apps/web/src/lib/forecast-methodology.ts
git commit -m "$(cat <<'EOF'
docs: align forecast methodology with sales-based demand reconstruction

Report unconstrained-demand WMAPE in walkforward when daily history exists.
EOF
)"
```

---

## Spec coverage（自检）

| Spec 条款 | 任务 |
|-----------|------|
| 分母改为非缺货天数 + 1.5 封顶 + 分档 | Task 1 |
| 新品/间歇/覆盖不足/长尾不还原 | Task 1 |
| 上市前零销忽略 | Task 1 |
| 月序列还原、整月 0 不填均值、关大促压顶 | Task 2、Task 3 季节 |
| 生成用 U、准入/生命周期用日历 | Task 3 |
| category 中位数用日历 90 | Task 3 |
| horizon_factors 审计 | Task 3 |
| sku-context / 校准对齐 | Task 4 |
| 经营 vs 模型双回测 | Task 5 |
| 不用库存快照 | 全局约束 |
| 需求计划 U 复用本模块 | 结构表说明，不在本计划开发需求计划 |

无 TBD。`applySkuVolumeGate` 与 `resolveRecentDemandWindows` 命名在 Task 1–4 一致。
