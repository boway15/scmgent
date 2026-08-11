# T99 系统保守保底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 V4.1 批量生成路径为 T99 写入确定性保守日均（断销归零 + `max(近30,近90)×0.6` + 远月衰减），矩阵可见、补货可用，不依赖逐条 Dify。

**Architecture:** 在 `forecast-demand.ts` 实现统一水位 `resolveT99SystemFloorDaily`；`computeAllCatV41BoundedDaily` 对 T99 调用该函数；**必须同步改** `forecast-collaboration.ts` 中 `!anchorForecastable` 分支（当前硬编码 `forecastDailyAvg: 0`，否则算法改了矩阵仍全 0）。文案与「待校准」提示跟随非零系统数调整。

**Tech Stack:** TypeScript、Node `tsx --test`、既有 V4.1 / 补货消费链路、React 文案组件。

**Spec:** [`docs/superpowers/specs/2026-08-11-t99-system-floor-design.md`](../specs/2026-08-11-t99-system-floor-design.md)

## Global Constraints

- 水位：`base = max(recent30, recent90) × 0.6`；`recent30 ≤ 0` → 全地平线 0（闸门优先）
- 远月：`k ≥ 3` 再 × `0.72`（对齐 `V41_T4B_FLEX_DECAY_*`）
- 仍标 `T99`；`excludedFromMainStats = true`；不进主 KPI
- 预测矩阵**不含** `categoryPoolFloor`；补货 fallback 可继续用 pool，但 `recent30 ≤ 0` 时 fallback 亦为 0
- 不批量调 Dify；不改 T1–T4B 门槛；不强制重算历史版本
- 测试命令：`pnpm --filter @scm/web exec tsx --test <path>`

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/forecast-demand.ts` | `resolveT99SystemFloorDaily`；闸门化 `resolveT99ReplenishmentFallbackDaily` |
| `apps/web/server/lib/forecast-demand.test.ts` | 水位 / fallback / 消费单测 |
| `apps/web/server/lib/forecast-allcat-v41.ts` | T99 bounded 出数、factors 审计字段、标签与复核文案 |
| `apps/web/server/lib/forecast-allcat-v41.test.ts` | bounded / 全月生成单测 |
| `apps/web/server/lib/forecast-collaboration.ts` | **关键**：T99 草稿写入 `v41.forecastDaily`，不再硬编码 0 |
| `apps/web/src/lib/forecast-labels.ts` | 前端分层标签 |
| `apps/web/server/lib/forecast-profile-class.ts` | 服务端分层标签 |
| `apps/web/src/components/ForecastStrategySection.tsx` | 策略说明 |
| `apps/web/src/pages/SalesForecastListPage.tsx` | 列表 T99 说明 |
| `apps/web/src/pages/SalesForecastVersionDetailPage.tsx` | 版本详情说明 |
| `apps/web/src/lib/forecast-horizon-column-help.ts` | 列帮助文案 |
| `apps/web/src/components/ForecastSkuDetailDrawer.tsx` | 抽屉诊断文案 |
| `docs/superpowers/specs/2026-08-11-t99-system-floor-design.md` | 状态改为已实现 |

---

### Task 1: T99 系统水位函数（TDD）

**Files:**
- Modify: `apps/web/server/lib/forecast-demand.ts`
- Modify: `apps/web/server/lib/forecast-demand.test.ts`

**Interfaces:**
- Produces:
  - `export type T99FloorMode = 'zero_gate_recent30' | 'recent_max06'`
  - `export const T99_SYSTEM_FLOOR_DISCOUNT = 0.6`
  - `export const T99_SYSTEM_FLOOR_FLEX_DECAY_FROM_K = 3`
  - `export const T99_SYSTEM_FLOOR_FLEX_DECAY_FACTOR = 0.72`
  - `export function resolveT99SystemFloorDaily(input: { recent30DailyAvg?: number \| null; recent90DailyAvg?: number \| null; horizonIndex?: number; discount?: number; flexDecayFromK?: number; flexDecayFactor?: number }): { daily: number; mode: T99FloorMode }`
  - `resolveT99ReplenishmentFallbackDaily`: 当 `recent30 ≤ 0` 返回 `0`（忽略 recent90 / pool）

- [ ] **Step 1: 写失败单测**

在 `forecast-demand.test.ts` 增加 import：`resolveT99SystemFloorDaily`，并追加：

```ts
it('resolveT99SystemFloorDaily zero-gates when recent30 is 0 even if recent90 > 0', () => {
  const near = resolveT99SystemFloorDaily({
    recent30DailyAvg: 0,
    recent90DailyAvg: 5,
    horizonIndex: 0,
  });
  const far = resolveT99SystemFloorDaily({
    recent30DailyAvg: 0,
    recent90DailyAvg: 5,
    horizonIndex: 4,
  });
  assert.equal(near.daily, 0);
  assert.equal(near.mode, 'zero_gate_recent30');
  assert.equal(far.daily, 0);
  assert.equal(far.mode, 'zero_gate_recent30');
});

it('resolveT99SystemFloorDaily uses max(r30,r90)*0.6 near and *0.72 far', () => {
  // max(2, 4) * 0.6 = 2.4; far = 2.4 * 0.72 = 1.728
  const near = resolveT99SystemFloorDaily({
    recent30DailyAvg: 2,
    recent90DailyAvg: 4,
    horizonIndex: 1,
  });
  const far = resolveT99SystemFloorDaily({
    recent30DailyAvg: 2,
    recent90DailyAvg: 4,
    horizonIndex: 3,
  });
  assert.equal(near.daily, 2.4);
  assert.equal(near.mode, 'recent_max06');
  assert.equal(far.daily, 1.728);
  assert.equal(far.mode, 'recent_max06');
});

it('resolveT99ReplenishmentFallbackDaily zero-gates when recent30 is 0', () => {
  assert.equal(
    resolveT99ReplenishmentFallbackDaily({
      recent30DailyAvg: 0,
      recent90DailyAvg: 10,
      categoryPoolFloorDaily: 3,
    }),
    0,
  );
});
```

保留既有用例 `T99 zero forecast falls back to recent sales for replenishment`（r30=2 仍期望 1.2）。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts`  
Expected: FAIL（`resolveT99SystemFloorDaily` 未导出 / 闸门未实现）

- [ ] **Step 3: 最小实现**

在 `forecast-demand.ts` 中，于 `resolveT99ReplenishmentFallbackDaily` 附近新增：

```ts
export type T99FloorMode = 'zero_gate_recent30' | 'recent_max06';

export const T99_SYSTEM_FLOOR_DISCOUNT = 0.6;
export const T99_SYSTEM_FLOOR_FLEX_DECAY_FROM_K = 3;
export const T99_SYSTEM_FLOOR_FLEX_DECAY_FACTOR = 0.72;

function nonNegDaily(value?: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function resolveT99SystemFloorDaily(input: {
  recent30DailyAvg?: number | null;
  recent90DailyAvg?: number | null;
  horizonIndex?: number;
  discount?: number;
  flexDecayFromK?: number;
  flexDecayFactor?: number;
}): { daily: number; mode: T99FloorMode } {
  const recent30 = nonNegDaily(input.recent30DailyAvg);
  const recent90 = nonNegDaily(input.recent90DailyAvg);
  if (recent30 <= 0) {
    return { daily: 0, mode: 'zero_gate_recent30' };
  }
  const discount =
    input.discount != null && Number.isFinite(input.discount) && input.discount > 0
      ? input.discount
      : T99_SYSTEM_FLOOR_DISCOUNT;
  const decayFrom =
    input.flexDecayFromK != null && Number.isFinite(input.flexDecayFromK)
      ? Math.max(0, Math.floor(input.flexDecayFromK))
      : T99_SYSTEM_FLOOR_FLEX_DECAY_FROM_K;
  const decayFactor =
    input.flexDecayFactor != null && Number.isFinite(input.flexDecayFactor) && input.flexDecayFactor > 0
      ? input.flexDecayFactor
      : T99_SYSTEM_FLOOR_FLEX_DECAY_FACTOR;
  const k = Math.max(0, Math.floor(input.horizonIndex ?? 0));
  let daily = Math.max(recent30, recent90) * discount;
  if (k >= decayFrom) daily *= decayFactor;
  return {
    daily: Math.round(daily * 10_000) / 10_000,
    mode: 'recent_max06',
  };
}
```

改 `resolveT99ReplenishmentFallbackDaily` 开头：在解析 `recent30` 后，若 `recent30 <= 0` 则 `return 0`（不再用 recent90/pool）。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-demand.ts apps/web/server/lib/forecast-demand.test.ts
git commit -m "feat(forecast): add T99 system floor daily with recent30 zero-gate"
```

---

### Task 2: V4.1 bounded 对 T99 出数 + factors

**Files:**
- Modify: `apps/web/server/lib/forecast-allcat-v41.ts`
- Modify: `apps/web/server/lib/forecast-allcat-v41.test.ts`

**Interfaces:**
- Consumes: `resolveT99SystemFloorDaily` from `./forecast-demand.js`
- Produces: `computeAllCatV41BoundedDaily` 对 T99 返回非零（有动销时）；`horizonFactors.t99FloorDaily` / `t99FloorMode`；`ALLCAT_V41_TIER_LABEL.T99 = 'T99 保守保底'`；`tierKpiTarget('T99')` 改为保守保底语义字符串（如 `T99_CONSERVATIVE_FLOOR`）；`buildT99ReviewMessage` 接受可选 `floorMode` / `floorDaily`

- [ ] **Step 1: 写失败单测**

在 `forecast-allcat-v41.test.ts` 追加：

```ts
it('computeAllCatV41BoundedDaily applies T99 system floor with far-month decay', () => {
  const metrics = {
    q1: 0, q3: 0, q6: 0, q12: 0,
    d2: 0, d3: 0, d6: 0, d12: 0,
    active2: 0, active6: 0, active12: 0,
    cv6: 9, trendRatio: 1,
  };
  const near = computeAllCatV41BoundedDaily({
    tier: 'T99',
    baseDaily: 0,
    productCategory: 'U',
    forecastMonth: 7,
    horizonIndex: 0,
    metrics,
    recent30DailyAvg: 2,
    recent90DailyAvg: 4,
  });
  const far = computeAllCatV41BoundedDaily({
    tier: 'T99',
    baseDaily: 0,
    productCategory: 'U',
    forecastMonth: 7,
    horizonIndex: 3,
    metrics,
    recent30DailyAvg: 2,
    recent90DailyAvg: 4,
  });
  const gated = computeAllCatV41BoundedDaily({
    tier: 'T99',
    baseDaily: 0,
    productCategory: 'U',
    forecastMonth: 7,
    horizonIndex: 0,
    metrics,
    recent30DailyAvg: 0,
    recent90DailyAvg: 4,
  });
  assert.equal(near.forecastDaily, 2.4);
  assert.equal(far.forecastDaily, 1.728);
  assert.equal(gated.forecastDaily, 0);
});

it('computeAllCatV41ForecastForMonth writes T99 floor into horizonFactors', () => {
  const monthlyRows = Array.from({ length: 3 }, (_, i) => ({
    saleYear: 2026,
    month: i + 1,
    qtySold: i === 2 ? 0 : 1,
  }));
  const result = computeAllCatV41ForecastForMonth({
    productCategory: 'U',
    platform: 'AMAZON',
    forecastYear: 2026,
    forecastMonth: 7,
    horizonIndex: 0,
    monthlyRows,
    recent30DailyAvg: 3,
    recent90DailyAvg: 2,
  });
  assert.equal(result.tier, 'T99');
  assert.equal(result.forecastDaily, 1.8); // max(3,2)*0.6
  assert.equal(result.horizonFactors.t99FloorMode, 'recent_max06');
  assert.equal(result.horizonFactors.t99FloorDaily, 1.8);
});
```

既有用例 `T99 when no sales in recent complete month`（无 recent30 传入、近月断销）仍期望 `forecastDaily === 0`，保留。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts`  
Expected: FAIL（T99 仍归零）

- [ ] **Step 3: 实现 bounded + factors + 文案**

1. `import { resolveT99SystemFloorDaily, type T99FloorMode } from './forecast-demand.js'`
2. 扩展 `AllCatV41BoundedDailyResult` 可选字段：`t99FloorMode?: T99FloorMode; t99FloorDaily?: number`
3. 替换 T99 分支：

```ts
if (input.tier === 'T99') {
  const floor = resolveT99SystemFloorDaily({
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    horizonIndex: input.horizonIndex ?? 0,
  });
  return {
    ...zeroBoundedDailyResult(false),
    forecastDaily: floor.daily,
    t99FloorMode: floor.mode,
    t99FloorDaily: floor.daily,
  };
}
```

4. 在 `computeAllCatV41ForecastForMonth` 写 factors 处（`horizonFactors` 组装后）增加：

```ts
if (tier === 'T99') {
  const floor = resolveT99SystemFloorDaily({
    recent30DailyAvg: input.recent30DailyAvg,
    recent90DailyAvg: input.recent90DailyAvg,
    horizonIndex: input.horizonIndex,
  });
  horizonFactors.t99FloorDaily = floor.daily;
  horizonFactors.t99FloorMode = floor.mode;
}
```

（若已从 `bounded` 带出字段，优先用 `bounded.t99FloorDaily` / `bounded.t99FloorMode`，避免重复计算。）

5. `ALLCAT_V41_TIER_LABEL.T99 = 'T99 保守保底'`
6. `tierKpiTarget` default → `'T99_CONSERVATIVE_FLOOR'`（替换 `NO_FORECAST_T99_EXCEPTION`）
7. `buildT99ReviewMessage`：

```ts
export function buildT99ReviewMessage(input: {
  skuCode: string;
  productCategory: string;
  platform: string;
  metrics: AllCatV41Metrics;
  floorMode?: T99FloorMode;
  floorDaily?: number;
}): string {
  const platformLabel = formatAllCatV41PlatformLabel(input.platform);
  const floorNote =
    input.floorMode === 'zero_gate_recent30' || (input.floorDaily != null && input.floorDaily <= 0)
      ? '近30天断销，系统归零'
      : `系统保守保底日均 ${roundDaily(input.floorDaily ?? 0)}（max(近30,近90)×0.6，远月衰减）`;
  return (
    `T99 ${floorNote}（全品类 V4.1）：${input.skuCode}，商品分类 ${input.productCategory}，平台 ${platformLabel}；` +
    `波动较大 / 销量连续性不足 / 核心渠道信号不足；` +
    `近6月变异系数 cv6=${roundDaily(input.metrics.cv6)}，趋势比 trend=${roundDaily(input.metrics.trendRatio)}`
  );
}
```

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/forecast-allcat-v41.ts apps/web/server/lib/forecast-allcat-v41.test.ts
git commit -m "feat(forecast): apply T99 system floor in V4.1 bounded daily"
```

---

### Task 3: 批量写入接线（去掉 T99 硬编码 0）

**Files:**
- Modify: `apps/web/server/lib/forecast-collaboration.ts`（约 1314–1398：`!anchorForecastable` 分支）

**Interfaces:**
- Consumes: `v41.forecastDaily` / `v41.forecastDailyP10` / `v41.forecastDailyP90` / `v41.baseDaily`；`resolveT99SystemFloorDaily`；更新后的 `buildT99ReviewMessage`
- Produces: T99 草稿行写入真实系统保底日均；复核 `suggestedDailyAvg` 为近端 floor

- [ ] **Step 1: 改 `!anchorForecastable` 循环体**

将硬编码 0 改为使用 `v41` 结果：

```ts
if (!anchorForecastable) {
  if (v41.forecastDaily > 0) wroteForecast = true;
  forecastDrafts.push({
    skuId: sku.id,
    station,
    platform,
    forecastYear: horizonMonth.forecastYear,
    month: horizonMonth.month,
    baselineDailyAvg: v41.baseDaily,
    forecastDailyAvg: v41.forecastDaily,
    lifecycle,
    confidenceLevel: v41.confidenceLevel,
    versionId: version.id,
    horizonFactors: v41.horizonFactors,
    forecastProfileClass: productCategory,
    profileSegment: anchorTier,
    horizonBand: v41.horizonBand,
    continuity12m: v41.metrics.active12 / 12,
    cv12m: v41.metrics.cv6,
    forecastDailyP10: v41.forecastDailyP10,
    forecastDailyP90: v41.forecastDailyP90,
    forecastModel: ALLCAT_V41_MODEL,
  });
  continue;
}
```

- [ ] **Step 2: 改循环后复核草稿**

```ts
if (!anchorForecastable) {
  const floor = resolveT99SystemFloorDaily({
    recent30DailyAvg,
    recent90DailyAvg,
    horizonIndex: 0,
  });
  reviewDrafts.push({
    skuId: sku.id,
    station,
    platform,
    issueType: 'forecast_skipped',
    severity: wroteForecast ? 'warning' : 'info',
    message: buildT99ReviewMessage({
      skuCode: sku.code,
      productCategory,
      platform,
      metrics: anchorV41.metrics,
      floorMode: floor.mode,
      floorDaily: floor.daily,
    }),
    suggestedDailyAvg: floor.daily,
  });
}
```

确保文件顶部已 import `resolveT99SystemFloorDaily`。

说明：`isAllCatV41Forecastable('T99')` **保持 false**，继续走该分支（需写全地平线含 0 月，不能落入 `forecastDaily <= 0` 的 `continue` 跳过逻辑）。

- [ ] **Step 3: 跑相关单测**

Run:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
```

若存在直接覆盖 collaboration 生成的测试，一并跑；无则本任务以代码审查 + 上述单测为准。

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/lib/forecast-collaboration.ts
git commit -m "feat(forecast): persist T99 system floor in batch draft rows"
```

---

### Task 4: 前端 / 标签文案

**Files:**
- Modify: `apps/web/src/lib/forecast-labels.ts` — `T99: 'T99 保守保底'`
- Modify: `apps/web/server/lib/forecast-profile-class.ts` — `T99: 'T99 保守保底'`
- Modify: `apps/web/src/components/ForecastStrategySection.tsx` — 标题与表格行：`T99 保守保底`；说明改为「有近30动销系统写保守数；近30=0全0；不进主KPI；Dify可选覆盖」；去掉「系统预测写入 0.00」绝对表述
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx` — T99 说明同步
- Modify: `apps/web/src/pages/SalesForecastVersionDetailPage.tsx` — 去掉「T99 系统预测为 0.00」绝对句，改为「T99 为系统保守保底；断销为 0；可用分层筛选定位」
- Modify: `apps/web/src/lib/forecast-horizon-column-help.ts` — `t99Diagnostic` 文案改为「T99 为系统保守保底（断销时为 0）；锚定/季节/混合水平仅供诊断。」；`COMMON.system` 分支去掉「固定为 0.00」
- Modify: `apps/web/src/components/ForecastSkuDetailDrawer.tsx` — 同步诊断句
- Verify: `ForecastHorizonPanel.tsx` 中「待校准」条件已是 `tier === 'T99' && manual == null && forecastDailyAvg === 0`，**无需改逻辑**（有系统数时自然不显示）

- [ ] **Step 1: 按上表改文案**（保持组件结构不变，只改字符串）

策略区 T99 行建议文案：

| 列 | 新文案 |
|----|--------|
| 名称 | 异常/低规律保守保底层 |
| 触发 | 连续性不足、cv 过高或近端弱信号；近30≤0 时归零 |
| 系统行为 | `max(近30,近90)×0.6`，远月×0.72；不进主 KPI |
| 准确率 | 不计入主准确率统计 |

- [ ] **Step 2: 快速检索残留「不预测」「固定为 0.00」**

Run（在仓库根目录）:

```bash
rg -n "T99 不预测|系统预测为 0\.00|固定为 0\.00|系统不预测" apps/web/src apps/web/server/lib/forecast-profile-class.ts apps/web/server/lib/forecast-allcat-v41.ts
```

Expected: 无面向用户的旧绝对表述（测试或历史英文 legacy 正则可保留）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/forecast-labels.ts apps/web/server/lib/forecast-profile-class.ts apps/web/src/components/ForecastStrategySection.tsx apps/web/src/pages/SalesForecastListPage.tsx apps/web/src/pages/SalesForecastVersionDetailPage.tsx apps/web/src/lib/forecast-horizon-column-help.ts apps/web/src/components/ForecastSkuDetailDrawer.tsx
git commit -m "docs(ui): relabel T99 as conservative system floor"
```

---

### Task 5: Spec 收尾 + 全量相关测试

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-t99-system-floor-design.md` — 状态改为 `已实现`

- [ ] **Step 1: 跑相关测试套件**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
```

Expected: 全部 PASS

- [ ] **Step 2: 更新 spec 状态行**

`> **状态**：已实现`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-t99-system-floor-design.md
git commit -m "docs(forecast): mark T99 system floor spec implemented"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| `resolveT99SystemFloorDaily` + 闸门 + 远月衰减 | Task 1 |
| 补货 fallback `recent30≤0` → 0 | Task 1 |
| `computeAllCatV41BoundedDaily` T99 出数 | Task 2 |
| `t99FloorDaily` / `t99FloorMode` factors | Task 2 |
| 标签/复核文案「保守保底」 | Task 2 + 4 |
| 批量矩阵写入非 0（去掉硬编码） | Task 3 |
| 前端策略/列表/抽屉/列帮助 | Task 4 |
| 「待校准」仅系统为 0 | Task 4（既有条件，verify） |
| 不进主 KPI / 不改 Dify / 不重跑历史 | Global Constraints（无额外代码） |
| 验收单测场景 | Task 1–2、5 |

无占位符；`resolveT99SystemFloorDaily` 签名在 Task 1/2/3 一致。
