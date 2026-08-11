# Forecast Drawer Actual Daily Avg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在销售预测 SKU 明细弹窗的预测表中展示各月实际日均，便于回看预测与实绩；未来月显示 `-`，当月标「进行中」。

**Architecture:** 纯函数根据月份标签 + 月销量 Map + asOf 算出 `actualByMonth`；`GET /sales-forecasts/sku-detail` 按请求 `months`（或版本 `monthLabels`）查 `sales_history_monthly` 后组装；弹窗在「生效」后渲染「实际日均」列。

**Tech Stack:** Hono、Drizzle/`loadMonthlySalesBySkuIds`、React、TanStack Query、Node `tsx --test`

## Global Constraints

- 实际口径：日均（件/天），与「生效」同列对比
- 未来月：`actualDailyAvg = null` → UI `-`
- 当前自然月：`qty / max(1, asOf.getUTCDate())`，`inProgress = true`，UI 标注「进行中」
- 已过月无销量：`0`（不是 `-`）
- 不加偏差列；不改列表矩阵；不写 `forecast_accuracy_monthly`
- 日历比较与 horizon 一致：UTC
- 日均两位小数：`Math.round(x * 100) / 100`

---

## File Map

| File | Responsibility |
|------|----------------|
| `apps/web/server/lib/forecast-drawer-actual.ts` | 解析 months、按 asOf 计算 actualByMonth |
| `apps/web/server/lib/forecast-drawer-actual.test.ts` | 纯函数单测 |
| `apps/web/server/routes/sales-forecast.ts` | `sku-detail` 加载销量并返回 `actualByMonth` |
| `apps/web/src/lib/api.ts` | 请求 `months` + 响应类型 |
| `apps/web/src/lib/forecast-horizon-column-help.ts` | 「实际日均」列帮助文案 |
| `apps/web/src/components/ForecastSkuDetailDrawer.tsx` | 传 months、渲染列 |

**Spec:** `docs/superpowers/specs/2026-08-11-forecast-drawer-actual-daily-design.md`

---

### Task 1: 纯函数 `forecast-drawer-actual` + 单测

**Files:**
- Create: `apps/web/server/lib/forecast-drawer-actual.ts`
- Test: `apps/web/server/lib/forecast-drawer-actual.test.ts`

**Interfaces:**
- Consumes: `parseForecastMonth` from `./forecast-demand.js`
- Produces:
  - `export type ForecastDrawerActualCell = { monthLabel: string; actualDailyAvg: number | null; inProgress: boolean }`
  - `export function parseMonthsQuery(raw: string | undefined | null): string[]`
  - `export function buildForecastDrawerActualByMonth(input: { monthLabels: string[]; qtyByMonthLabel: Map<string, number>; asOf?: Date }): ForecastDrawerActualCell[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/server/lib/forecast-drawer-actual.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMonthsQuery,
  buildForecastDrawerActualByMonth,
} from './forecast-drawer-actual.js';

describe('forecast-drawer-actual', () => {
  it('parses months query and drops empties', () => {
    assert.deepEqual(parseMonthsQuery('2026-03,2026-04, ,2026-05'), [
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    assert.deepEqual(parseMonthsQuery(undefined), []);
  });

  it('returns null actual for future months', () => {
    const asOf = new Date('2026-08-11T12:00:00.000Z');
    const cells = buildForecastDrawerActualByMonth({
      monthLabels: ['2026-09'],
      qtyByMonthLabel: new Map([['2026-09', 100]]),
      asOf,
    });
    assert.deepEqual(cells, [
      { monthLabel: '2026-09', actualDailyAvg: null, inProgress: false },
    ]);
  });

  it('uses full calendar days for past months; zero when missing', () => {
    const asOf = new Date('2026-08-11T12:00:00.000Z');
    const cells = buildForecastDrawerActualByMonth({
      monthLabels: ['2026-06', '2026-07'],
      qtyByMonthLabel: new Map([['2026-06', 300]]),
      asOf,
    });
    assert.equal(cells[0]!.actualDailyAvg, 10); // 300/30
    assert.equal(cells[0]!.inProgress, false);
    assert.equal(cells[1]!.actualDailyAvg, 0);
    assert.equal(cells[1]!.inProgress, false);
  });

  it('uses elapsed UTC days for current month and marks inProgress', () => {
    const asOf = new Date('2026-08-11T12:00:00.000Z');
    const cells = buildForecastDrawerActualByMonth({
      monthLabels: ['2026-08'],
      qtyByMonthLabel: new Map([['2026-08', 110]]),
      asOf,
    });
    assert.deepEqual(cells, [
      { monthLabel: '2026-08', actualDailyAvg: 10, inProgress: true }, // 110/11
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-drawer-actual.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/server/lib/forecast-drawer-actual.ts`:

```ts
import { parseForecastMonth } from './forecast-demand.js';

export type ForecastDrawerActualCell = {
  monthLabel: string;
  actualDailyAvg: number | null;
  inProgress: boolean;
};

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function roundDaily(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(year: number, month: number): number {
  return year * 100 + month;
}

export function parseMonthsQuery(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildForecastDrawerActualByMonth(input: {
  monthLabels: string[];
  qtyByMonthLabel: Map<string, number>;
  asOf?: Date;
}): ForecastDrawerActualCell[] {
  const asOf = input.asOf ?? new Date();
  const asOfKey = monthKey(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1);
  const elapsedDays = Math.max(1, asOf.getUTCDate());

  return input.monthLabels.map((monthLabel) => {
    const parsed = parseForecastMonth(monthLabel);
    if (!parsed) {
      return { monthLabel, actualDailyAvg: null, inProgress: false };
    }
    const key = monthKey(parsed.year, parsed.month);
    if (key > asOfKey) {
      return { monthLabel, actualDailyAvg: null, inProgress: false };
    }
    const qty = input.qtyByMonthLabel.get(monthLabel) ?? 0;
    if (key === asOfKey) {
      return {
        monthLabel,
        actualDailyAvg: roundDaily(qty / elapsedDays),
        inProgress: true,
      };
    }
    const days = daysInCalendarMonth(parsed.year, parsed.month);
    return {
      monthLabel,
      actualDailyAvg: days > 0 ? roundDaily(qty / days) : 0,
      inProgress: false,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-drawer-actual.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-drawer-actual.ts apps/web/server/lib/forecast-drawer-actual.test.ts
git commit -m "feat(forecast): add drawer actual daily avg pure helpers"
```

---

### Task 2: `sku-detail` 路由返回 `actualByMonth`

**Files:**
- Modify: `apps/web/server/routes/sales-forecast.ts`（`GET /sales-forecasts/sku-detail`，约 671–791 行）

**Interfaces:**
- Consumes: `parseMonthsQuery`, `buildForecastDrawerActualByMonth`；`loadMonthlySalesBySkuIds` from `../lib/sales-history-query.js`；`getVersionForecastSummary`（已有 `monthLabels`）；`normalizeSalesPlatform` / 现有 platform 口径（与 horizon 一致时用请求 `platform`）
- Produces: JSON 增加 `actualByMonth: ForecastDrawerActualCell[]`

- [ ] **Step 1: Extend the handler**

在 `salesForecastRoutes.get('/sales-forecasts/sku-detail', ...)` 内：

1. Import:

```ts
import { loadMonthlySalesBySkuIds } from '../lib/sales-history-query.js';
import {
  parseMonthsQuery,
  buildForecastDrawerActualByMonth,
} from '../lib/forecast-drawer-actual.js';
import { parseForecastMonth } from '../lib/forecast-demand.js';
```

（若 `parseForecastMonth` / `loadMonthlySalesBySkuIds` 已在文件中 import，则合并，勿重复。）

2. 解析月份：在拿到 `versionSummary` 之后：

```ts
const monthsFromQuery = parseMonthsQuery(c.req.query('months'));
const monthLabels =
  monthsFromQuery.length > 0 ? monthsFromQuery : versionSummary.monthLabels;
```

注意：当前 handler 里 `getVersionForecastSummary` 已在 `Promise.all` 中；把 `monthLabels` 的确定放在 `Promise.all` **之后**，再按需查销量。

3. 加载销量并组装（仅当 `monthLabels.length > 0`）：

```ts
let actualByMonth = buildForecastDrawerActualByMonth({
  monthLabels,
  qtyByMonthLabel: new Map(),
});

if (monthLabels.length > 0) {
  const parsedMonths = monthLabels
    .map((label) => ({ label, parsed: parseForecastMonth(label) }))
    .filter((row): row is { label: string; parsed: { year: number; month: number } } => row.parsed != null);

  if (parsedMonths.length > 0) {
    const sorted = [...parsedMonths].sort(
      (a, b) => a.parsed.year - b.parsed.year || a.parsed.month - b.parsed.month,
    );
    const first = sorted[0]!.parsed;
    const last = sorted[sorted.length - 1]!.parsed;
    const platform = /* 与请求一致：c.req.query('platform') 已校验非空 */ platform.trim();
    // 若文件内已有 normalizeSalesPlatform，用于与 horizon 一致：
    // const platformKey = normalizeSalesPlatform(platform) 或直接传 platform（loadMonthlySalesBySkuIds 内部会处理）

    const monthlyBySku = await loadMonthlySalesBySkuIds({
      skuIds: [resolvedSkuId],
      platform,
      minYear: first.year,
      minMonth: first.month,
      maxYear: last.year,
      maxMonth: last.month,
    });
    const rows = monthlyBySku.get(resolvedSkuId) ?? [];
    const qtyByMonthLabel = new Map<string, number>();
    for (const row of rows) {
      const label = `${row.saleYear}-${String(row.month).padStart(2, '0')}`;
      // 优先使用 formatForecastMonth(row.saleYear, row.month) 若已 import
      qtyByMonthLabel.set(label, (qtyByMonthLabel.get(label) ?? 0) + row.qtySold);
    }
    actualByMonth = buildForecastDrawerActualByMonth({
      monthLabels,
      qtyByMonthLabel,
    });
  }
}
```

4. `return c.json({ ...existing, actualByMonth })`。

**实现注意：**
- `platform` 变量名与现有 handler 局部变量对齐（当前从 `c.req.query('platform')` 取得）。
- `ALL` 渠道必须能出数：确认传入 `loadMonthlySalesBySkuIds` 的 platform 字符串与 horizon 历史加载一致（可读 `forecast-horizon.ts` 中 `loadHistoryQtyBySkuPlatform` 的调用）。
- 月份标签格式统一用已有 `formatForecastMonth`，避免手写 pad 不一致。

- [ ] **Step 2: Smoke-check types**

Run（在 `apps/web` 下，若项目有 tsc 脚本则用；否则跳过仅保证 import 无误）:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-drawer-actual.test.ts
```

Expected: 仍 PASS；路由文件无语法错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/routes/sales-forecast.ts
git commit -m "feat(forecast): return actualByMonth from sku-detail"
```

---

### Task 3: API 客户端 + 列帮助

**Files:**
- Modify: `apps/web/src/lib/api.ts`（`getSalesForecastSkuDetail`）
- Modify: `apps/web/src/lib/forecast-horizon-column-help.ts`

**Interfaces:**
- Produces: `months?: string[]` 请求参数；响应 `actualByMonth`
- Produces: `getForecastHorizonColumnHelp('actual', ctx)` 文案

- [ ] **Step 1: Update `api.ts`**

将 `getSalesForecastSkuDetail` 改为：

```ts
getSalesForecastSkuDetail: (params: {
  versionId: string;
  skuId?: string;
  skuCode?: string;
  station: string;
  platform: string;
  months?: string[];
}) => {
  const qs = new URLSearchParams({
    versionId: params.versionId,
    station: params.station,
    platform: params.platform,
  });
  if (params.skuId) qs.set('skuId', params.skuId);
  if (params.skuCode) qs.set('skuCode', params.skuCode);
  if (params.months?.length) qs.set('months', params.months.join(','));
  return request<{
    versionSummary: ForecastVersionSummary;
    context: SkuForecastContext | null;
    reviewItems: ForecastReviewItem[];
    actualByMonth: Array<{
      monthLabel: string;
      actualDailyAvg: number | null;
      inProgress: boolean;
    }>;
    sku: {
      id: string;
      code: string;
      name: string;
      category: string | null;
      productCategory: string | null;
      lifecycle: string | null;
      salesCountry: string | null;
      ownerName: string | null;
      developerName: string | null;
      merchantCode: string | null;
      merchantName: string | null;
      specAttrs: Record<string, string> | null;
      unit: string;
      leadTimeDays: number | null;
      moq: number | null;
    };
  }>(`/api/sales-forecasts/sku-detail?${qs}`);
},
```

- [ ] **Step 2: Update column help**

在 `COMMON` 增加：

```ts
actual:
  '实际日均：销售历史月表件数折算。已完整月份 ÷ 当月天数；当前月 ÷ 已过天数并标「进行中」；尚未到达的预测月为空（-）。与「生效」同口径便于回看偏差。',
```

`getForecastHorizonColumnHelp` 的 `column` 联合类型增加 `'actual'`，`switch` 增加：

```ts
case 'actual':
  return COMMON.actual;
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/forecast-horizon-column-help.ts
git commit -m "feat(forecast): api and column help for drawer actual daily"
```

---

### Task 4: 弹窗 UI 展示「实际日均」

**Files:**
- Modify: `apps/web/src/components/ForecastSkuDetailDrawer.tsx`

**Interfaces:**
- Consumes: `detail.actualByMonth`；`api.getSalesForecastSkuDetail({ ..., months })`

- [ ] **Step 1: Wire months into sku-detail query**

最小改动：保留现有 hooks 顺序，`months` 取自弹窗入参 `row.months`（矩阵行已含完整预测月；与 horizon 单行通常一致）。

将现有 `useQuery`（`sales-forecast-sku-detail`）改为：

```ts
const monthsForActual = (row?.months ?? []).map((m) => m.monthLabel);

const { data: detail, isLoading: detailLoading } = useQuery({
  queryKey: [
    'sales-forecast-sku-detail',
    versionId,
    row?.skuId,
    row?.skuCode,
    row?.station,
    row?.platform,
    monthsForActual.join(','),
  ],
  queryFn: () =>
    api.getSalesForecastSkuDetail({
      versionId,
      skuId: row!.skuId || undefined,
      skuCode: row!.skuId ? undefined : row!.skuCode,
      station: row!.station,
      platform: row!.platform,
      months: monthsForActual.length > 0 ? monthsForActual : undefined,
    }),
  enabled: Boolean(versionId && row && (row.skuId || row.skuCode)),
});
```

若打开弹窗时 `row.months` 为空，不传 `months`，服务端回退 `versionSummary.monthLabels`（Task 2）。

- [ ] **Step 2: Render column**

1. 构建查找 Map：

```ts
const actualByMonth = new Map(
  (detail?.actualByMonth ?? []).map((cell) => [cell.monthLabel, cell]),
);
```

2. 表头在「生效」`ForecastColumnHeader` 之后增加：

```tsx
<ForecastColumnHeader
  className="whitespace-nowrap"
  label="实际日均"
  help={getForecastHorizonColumnHelp('actual', columnHelpCtx)}
/>
```

3. 在每行 `<CalibrationCells ... />` 之后增加：

```tsx
<td className="p-2 align-middle font-numeric whitespace-nowrap">
  {(() => {
    const actual = actualByMonth.get(cell.monthLabel);
    if (!actual || actual.actualDailyAvg == null) return '-';
    return (
      <span className="inline-flex items-center gap-1">
        <span>{formatNumber(actual.actualDailyAvg)}</span>
        {actual.inProgress ? (
          <span className="text-[10px] font-normal text-text-sub">进行中</span>
        ) : null}
      </span>
    );
  })()}
</td>
```

4. 说明文案可在预测明细 `<p className="text-xs...">` 末尾加一句：「已发生月份展示实际日均，便于对照生效值；未来月为 -。」

- [ ] **Step 3: Manual sanity（本地有服务时）**

打开 `/data/forecast/:versionId`，点开含过去月的 SKU 明细：过去月有数字、未来月 `-`、当月有「进行中」。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ForecastSkuDetailDrawer.tsx
git commit -m "feat(forecast): show actual daily avg in sku detail drawer"
```

---

### Task 5: 验证与收尾

**Files:** 无新文件；必要时更新 spec 状态为「已实现」

- [ ] **Step 1: Run unit tests**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-drawer-actual.test.ts
```

Expected: PASS

- [ ] **Step 2: Spec status**

将 `docs/superpowers/specs/2026-08-11-forecast-drawer-actual-daily-design.md` 顶部状态改为 `已实现`。

```bash
git add docs/superpowers/specs/2026-08-11-forecast-drawer-actual-daily-design.md
git commit -m "docs(forecast): mark drawer actual daily design implemented"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 实际日均口径 | Task 1 |
| 未来月 null / `-` | Task 1 + 4 |
| 当月进行中 | Task 1 + 4 |
| 已过月 0.00 | Task 1 |
| sku-detail + months | Task 2 + 3 |
| 版本 monthLabels 回退 | Task 2 |
| loadMonthlySalesBySkuIds | Task 2 |
| 弹窗列 + 帮助 | Task 3 + 4 |
| 不加偏差 / 不改矩阵 | 全任务遵守 |
| 单测 | Task 1 + 5 |
