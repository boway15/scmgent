# Forecast Accuracy Detail Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 草稿可进准确率复盘；详情展示「预测值/实际值」三态；产品 UI 去掉走步回测，批量回测始终针对当前版本。

**Architecture:** 抽出可单测的地平线/状态机纯函数；服务端 `getVersionQtyTotals` 聚合预测行与销量后返回 status + qty；详情/列表放开 draft 准确率入口并删除走步 UI；回测 `versionId` 固定为当前详情 id。

**Tech Stack:** Hono、Drizzle、React Query、现有 `forecast-baseline` / `sales-history-monthly`、Node `tsx --test`

## Global Constraints

- 预测值/实际值只在详情准确率区，不进版本列表
- 列表草稿「准确率」列仍固定 `-`
- 地平线含 ≥ 当前未结束月 → 整格 `进行中`（不展示部分数字）
- 实绩汇总为 0 → `-`；否则 `预测总量 / 实际总量`（整数千分位）
- 预测总量 = Σ(`forecastDailyAvg` × 当月天数)；仅已结束月；平台过滤与准确率一致（V4.1 平台码）
- 实际总量：日表优先否则月表；与 `resolveActualMonthlyDailyAvg` 同源
- 走步：仅去掉产品 UI；保留 scripts 与 `POST .../accuracy/walkforward`（路由加 deprecated 注释）
- API 路径跟现网：`/api/sales-forecast-versions/:id/qty-totals`（不用 spec 示例里的 `/sales-forecasts/versions/...`）

**Spec:** `docs/superpowers/specs/2026-08-12-forecast-accuracy-detail-totals-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `apps/web/server/lib/forecast-qty-totals.ts` | 地平线解析、状态机、`getVersionQtyTotals` |
| `apps/web/server/lib/forecast-qty-totals.test.ts` | 纯函数单测 |
| `apps/web/server/routes/sales-forecast.ts` | `GET .../qty-totals`；walkforward 注释 deprecated |
| `apps/web/src/lib/api.ts` | `getSalesForecastVersionQtyTotals` 类型与请求 |
| `apps/web/src/pages/SalesForecastVersionDetailPage.tsx` | draft 准确率 Tab；汇总展示；去掉走步；回测绑当前版本 |
| `apps/web/src/pages/SalesForecastListPage.tsx` | 草稿「复盘」链到 `?view=accuracy` |

---

### Task 1: 纯函数 — 地平线月份与 qty-totals 状态机

**Files:**
- Create: `apps/web/server/lib/forecast-qty-totals.ts`
- Create: `apps/web/server/lib/forecast-qty-totals.test.ts`

**Interfaces:**
- Produces:
  - `export type ForecastQtyTotalsStatus = 'in_progress' | 'empty_actual' | 'ready'`
  - `export type ForecastQtyTotalsResult = { status: ForecastQtyTotalsStatus; forecastQty: number; actualQty: number; label: string }`
  - `export function monthKey(year: number, month: number): string` → `YYYY-MM`
  - `export function resolveHorizonMonthKeys(input: { distinctMonths: string[]; startMonth: string | null; monthCount: number; now?: Date }): string[]`
  - `export function buildForecastQtyTotalsResult(input: { horizonMonthKeys: string[]; forecastQty: number; actualQty: number; now?: Date }): ForecastQtyTotalsResult`
  - `export function formatQtyTotalsLabel(status: ForecastQtyTotalsStatus, forecastQty: number, actualQty: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildForecastQtyTotalsResult,
  formatQtyTotalsLabel,
  monthKey,
  resolveHorizonMonthKeys,
} from './forecast-qty-totals.js';

describe('forecast-qty-totals', () => {
  it('monthKey pads month', () => {
    assert.equal(monthKey(2026, 2), '2026-02');
  });

  it('resolveHorizonMonthKeys prefers distinct forecast months', () => {
    const keys = resolveHorizonMonthKeys({
      distinctMonths: ['2026-02', '2026-03'],
      startMonth: '2026-01',
      monthCount: 6,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.deepEqual(keys, ['2026-02', '2026-03']);
  });

  it('resolveHorizonMonthKeys falls back to startMonth + monthCount', () => {
    const keys = resolveHorizonMonthKeys({
      distinctMonths: [],
      startMonth: '2026-02',
      monthCount: 3,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.deepEqual(keys, ['2026-02', '2026-03', '2026-04']);
  });

  it('in_progress when horizon includes current month', () => {
    const r = buildForecastQtyTotalsResult({
      horizonMonthKeys: ['2026-07', '2026-08'],
      forecastQty: 100,
      actualQty: 90,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.equal(r.status, 'in_progress');
    assert.equal(r.label, '进行中');
  });

  it('empty_actual when all months completed and actualQty is 0', () => {
    const r = buildForecastQtyTotalsResult({
      horizonMonthKeys: ['2026-02', '2026-03'],
      forecastQty: 100,
      actualQty: 0,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.equal(r.status, 'empty_actual');
    assert.equal(r.label, '-');
  });

  it('ready formats thousands', () => {
    const r = buildForecastQtyTotalsResult({
      horizonMonthKeys: ['2026-02'],
      forecastQty: 12345,
      actualQty: 11900,
      now: new Date(Date.UTC(2026, 7, 12)),
    });
    assert.equal(r.status, 'ready');
    assert.equal(r.label, '12,345 / 11,900');
    assert.equal(formatQtyTotalsLabel('ready', 12345, 11900), '12,345 / 11,900');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec tsx --test server/lib/forecast-qty-totals.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

在 `forecast-qty-totals.ts` 实现上述导出（先不要写 DB 聚合）：

```ts
import { buildMonthlyForecastHorizon } from './forecast-baseline.js';
import { formatForecastStartMonth, resolveForecastStartMonthAsOf } from './forecast-start-month.js';

export type ForecastQtyTotalsStatus = 'in_progress' | 'empty_actual' | 'ready';

export type ForecastQtyTotalsResult = {
  status: ForecastQtyTotalsStatus;
  forecastQty: number;
  actualQty: number;
  label: string;
};

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function resolveHorizonMonthKeys(input: {
  distinctMonths: string[];
  startMonth: string | null;
  monthCount: number;
  now?: Date;
}): string[] {
  const distinct = [...new Set(input.distinctMonths.filter(Boolean))].sort();
  if (distinct.length > 0) return distinct;

  const start = input.startMonth?.trim();
  const count = Math.max(0, Math.floor(input.monthCount));
  if (!start || count <= 0) return [];

  const asOf = resolveForecastStartMonthAsOf(start);
  return buildMonthlyForecastHorizon(asOf, count).map((h) => monthKey(h.forecastYear, h.month));
}

export function formatQtyTotalsLabel(
  status: ForecastQtyTotalsStatus,
  forecastQty: number,
  actualQty: number,
): string {
  if (status === 'in_progress') return '进行中';
  if (status === 'empty_actual') return '-';
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  return `${fmt(forecastQty)} / ${fmt(actualQty)}`;
}

export function buildForecastQtyTotalsResult(input: {
  horizonMonthKeys: string[];
  forecastQty: number;
  actualQty: number;
  now?: Date;
}): ForecastQtyTotalsResult {
  const now = input.now ?? new Date();
  const currentMonth = formatForecastStartMonth(now);
  const horizon = input.horizonMonthKeys;
  if (horizon.length === 0) {
    return {
      status: 'empty_actual',
      forecastQty: 0,
      actualQty: 0,
      label: formatQtyTotalsLabel('empty_actual', 0, 0),
    };
  }
  if (horizon.some((m) => m >= currentMonth)) {
    return {
      status: 'in_progress',
      forecastQty: input.forecastQty,
      actualQty: input.actualQty,
      label: formatQtyTotalsLabel('in_progress', input.forecastQty, input.actualQty),
    };
  }
  if (input.actualQty <= 0) {
    return {
      status: 'empty_actual',
      forecastQty: input.forecastQty,
      actualQty: input.actualQty,
      label: formatQtyTotalsLabel('empty_actual', input.forecastQty, input.actualQty),
    };
  }
  return {
    status: 'ready',
    forecastQty: input.forecastQty,
    actualQty: input.actualQty,
    label: formatQtyTotalsLabel('ready', input.forecastQty, input.actualQty),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec tsx --test server/lib/forecast-qty-totals.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-qty-totals.ts apps/web/server/lib/forecast-qty-totals.test.ts
git commit -m "feat(forecast): add qty-totals status helpers"
```

---

### Task 2: `getVersionQtyTotals` + HTTP 路由

**Files:**
- Modify: `apps/web/server/lib/forecast-qty-totals.ts`
- Modify: `apps/web/server/routes/sales-forecast.ts`（在 `GET /sales-forecast-versions/:id` 附近增加 qty-totals；walkforward 路由加注释）
- Test: 扩展 `forecast-qty-totals.test.ts`（纯函数已覆盖状态机；本任务以手工/集成路径为主，可对 `completedMonthKeys` 过滤加单测）

**Interfaces:**
- Consumes: Task 1 helpers；`getForecastVersionById`；`daysInCalendarMonth`；`FORECAST_V41_PLATFORM_CODES`；`resolveActualMonthlyDailyAvg`（或同文件内批量销量查询）
- Produces: `export async function getVersionQtyTotals(versionId: string, now?: Date): Promise<ForecastQtyTotalsResult | null>`

- [ ] **Step 1: Add completed-month filter unit test**

```ts
it('filters completed months strictly before current', () => {
  const { filterCompletedMonthKeys } = await import('./forecast-qty-totals.js');
  // 若未导出则改为测试 buildForecastQtyTotalsResult 已覆盖；否则：
  assert.deepEqual(
    filterCompletedMonthKeys(['2026-06', '2026-07', '2026-08'], new Date(Date.UTC(2026, 7, 12))),
    ['2026-06', '2026-07'],
  );
});
```

导出：

```ts
export function filterCompletedMonthKeys(horizonMonthKeys: string[], now = new Date()): string[] {
  const currentMonth = formatForecastStartMonth(now);
  return horizonMonthKeys.filter((m) => m < currentMonth);
}
```

- [ ] **Step 2: Implement `getVersionQtyTotals`**

逻辑要点：

1. `getForecastVersionById`；不存在 → `null`
2. 查该版本 `sales_forecast_monthly`：`platform in FORECAST_V41_PLATFORM_CODES`，选出 `skuId, station, platform, forecastYear, month, forecastDailyAvg`
3. `distinctMonths` = 去重 `monthKey(year, month)`
4. `monthCount` = distinct 数；若 0 且有 `version.startMonth`，用 `version` 上无法得知 monthCount 时默认 `6`（或 `MAX` 与生成一致：可用 `stats` 无则 6）
5. `horizonMonthKeys = resolveHorizonMonthKeys({ distinctMonths, startMonth: version.startMonth, monthCount })`
6. 若 `buildForecastQtyTotalsResult` 在 qty=0 时已是 `in_progress`，可直接返回（无需扫销量）
7. 否则仅对 `filterCompletedMonthKeys(horizon)` 内的预测行：  
   `forecastQty += Number(forecastDailyAvg) * daysInCalendarMonth(y, m)`  
   `actualQty +=`：对每一行调用 `resolveActualMonthlyDailyAvg` 后 `actualDaily * days`（与现准确率同源；若性能不够再改为批量 SQL，本任务允许按行解析，与 `computeForecastAccuracyForMonth` 同风格）
8. `return buildForecastQtyTotalsResult({ horizonMonthKeys, forecastQty: Math.round(...), actualQty: Math.round(...) })`

注意：`in_progress` 时仍可提前返回，避免全量扫销量。

- [ ] **Step 3: Add route**

```ts
salesForecastRoutes.get(
  '/sales-forecast-versions/:id/qty-totals',
  requireMenu('data.forecast'),
  async (c) => {
    const result = await getVersionQtyTotals(c.req.param('id'));
    if (!result) return c.json({ message: 'Version not found' }, 404);
    return c.json(result);
  },
);
```

在 walkforward 路由上方加：

```ts
/** @deprecated 产品 UI 已下线；保留供脚本/离线诊断。主路径：历史开始月生成 + 当前版本批量回测 */
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm --dir apps/web exec tsx --test server/lib/forecast-qty-totals.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-qty-totals.ts apps/web/server/lib/forecast-qty-totals.test.ts apps/web/server/routes/sales-forecast.ts
git commit -m "feat(forecast): expose version qty-totals API"
```

---

### Task 3: 详情页 — 草稿复盘、汇总展示、去掉走步、回测绑当前版本

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/SalesForecastVersionDetailPage.tsx`
- Remove usages of: `WalkForwardMonthTierTable`、`computeWalkForwardAsOf`、`walkForwardMutation`、`sessionStorage` 影子版本

**Interfaces:**
- Consumes: `GET /api/sales-forecast-versions/:id/qty-totals`
- Produces: `api.getSalesForecastVersionQtyTotals(id)` → `ForecastQtyTotalsResult`

- [ ] **Step 1: Add API client**

在 `api.ts` 增加类型与方法（与服务端字段一致）：

```ts
export type ForecastQtyTotalsResult = {
  status: 'in_progress' | 'empty_actual' | 'ready';
  forecastQty: number;
  actualQty: number;
  label: string;
};

// inside api object:
getSalesForecastVersionQtyTotals: (id: string) =>
  request<ForecastQtyTotalsResult>(`/api/sales-forecast-versions/${id}/qty-totals`),
```

- [ ] **Step 2: Open accuracy for draft**

将 `isViewAllowed` 改为：

```ts
function isViewAllowed(view: DetailView, status: string): boolean {
  if (view === 'data') return true;
  if (view === 'review') return status === 'draft';
  if (view === 'accuracy') return status === 'draft' || status === 'published' || status === 'archived';
  return false;
}
```

`availableViews` 同步：

```ts
if (version.status === 'draft' || version.status === 'published' || version.status === 'archived') {
  views.push('accuracy');
}
```

- [ ] **Step 3: Remove walkforward UI/state**

删除：`walkForwardTier`、`walkForwardAccuracyVersionId`、`walkForwardMutation`、`viewingWalkForwardAccuracy`、`accuracyListVersionId` 回退逻辑、分层 select、走步按钮、`WalkForwardMonthTierTable`、影子版本提示、相关 import。

准确率查询始终：

```ts
versionId: versionId, // 当前详情版本
```

空状态文案改为：

`暂无准确率记录；可对当前版本运行「按开始月复盘回测」（需历史开始月且已结束月有实绩）。`

- [ ] **Step 4: Bind backtest to current version**

```ts
const accuracyBacktestMutation = useMutation({
  mutationFn: () =>
    api.backtestSalesForecastAccuracy({
      monthCount: accuracyBacktestMonths,
      versionId,
      createReviewItems: true,
    }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy'] });
    qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy-diagnostics'] });
    qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
    qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
    qc.invalidateQueries({ queryKey: ['sales-forecast-version-qty-totals', versionId] });
  },
});
```

删除 `accuracyDraftTargetVersionId` / `latestDraftVersion` 若仅服务于旧回测目标。

按钮文案：`按开始月复盘回测`；旁注 `个月` 保留。

默认 `accuracyBacktestMonths`：在 `version` 加载后若 `version.stats.monthCount > 0`，设为 `Math.min(6, version.stats.monthCount)`（`useEffect` 一次即可）。

- [ ] **Step 5: Fetch and render qty totals**

```ts
const { data: qtyTotals } = useQuery({
  queryKey: ['sales-forecast-version-qty-totals', versionId],
  queryFn: () => api.getSalesForecastVersionQtyTotals(versionId),
  enabled: activeView === 'accuracy' && Boolean(versionId),
});
```

在准确率 CardHeader（或诊断面板上方）展示：

```tsx
<p className="text-sm text-text-main">
  预测值 / 实际值：
  <span className="font-numeric font-medium">{qtyTotals?.label ?? '…'}</span>
</p>
```

- [ ] **Step 6: Smoke-check TypeScript**

Run: `pnpm --dir apps/web exec tsc -p tsconfig.json --noEmit`（若项目惯用其它命令则跟随 CI）  
Expected: 无因本页删除走步产生的未使用 import / 类型错误

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/SalesForecastVersionDetailPage.tsx
git commit -m "feat(forecast): draft accuracy tab, qty totals, drop walkforward UI"
```

---

### Task 4: 列表草稿「复盘」入口

**Files:**
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`

**Interfaces:**
- Consumes: 现有 `buildForecastVersionDetailSearch({ view: 'accuracy' })`
- Produces: 草稿行增加「复盘」Link（准确率列逻辑不变：草稿仍 `-`）

- [ ] **Step 1: Add draft 复盘 link**

在 `VersionRow` 操作区，对 **所有** 状态提供复盘，或至少 draft + published + archived：

```tsx
{(version.status === 'draft' ||
  version.status === 'published' ||
  version.status === 'archived') && (
  <Link
    to={`/data/forecast/${version.id}${accuracySearch}`}
    className="text-primary hover:underline"
  >
    复盘
  </Link>
)}
```

若 published/archived 已有「复盘」，合并为上述条件，避免重复 Link。

确认准确率列仍为：

```tsx
{version.status === 'published' || version.status === 'archived'
  ? formatForecastWmape(version.stats.accuracyWmape)
  : '-'}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/SalesForecastListPage.tsx
git commit -m "feat(forecast): add draft accuracy review link on version list"
```

---

### Task 5: 验收清单（手工）

- [ ] **Step 1: 历史开始月草稿**

生成 `startMonth` 为过去月的草稿 → 打开详情 → 可见「准确率复盘」→ `?view=accuracy` 不踢回。

- [ ] **Step 2: 预测值/实际值三态**

- 地平线含当月 → `进行中`  
- 全为过去月、无销量 → `-`  
- 有销量 → `数字 / 数字`  
- 列表无「预测值/实际值」列；草稿准确率列仍 `-`

- [ ] **Step 3: 回测与走步**

- 「按开始月复盘回测」写入**当前** versionId，明细表有行  
- 页面无「走步回测」按钮 / 分层下拉 / 影子版本提示  
- `POST /api/sales-forecasts/accuracy/walkforward` 仍存在（可选 curl 冒烟）

- [ ] **Step 4: 若有未提交改动则提交 docs 状态（可选）**

将 spec 状态改为 `实现中` 或 `已实现`（完成后）：

`docs/superpowers/specs/2026-08-12-forecast-accuracy-detail-totals-design.md`

```bash
git add docs/superpowers/specs/2026-08-12-forecast-accuracy-detail-totals-design.md
git commit -m "docs(forecast): mark accuracy detail totals spec implemented"
```

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| draft 准确率 Tab | Task 3 |
| 预测值/实际值三态 + 口径 | Task 1–3 |
| API qty-totals | Task 2 |
| 批量回测绑当前版本 + 文案 | Task 3 |
| 去掉走步 UI、保留 API/scripts | Task 2–3 |
| 列表草稿复盘、准确率列仍 `-` | Task 4 |
| 验收场景 | Task 5 |
