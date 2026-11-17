# 预测分区域×分平台 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步执行。步骤使用 `- [ ]` 勾选跟踪。

**Goal:** 统一「行上 `sales_region` 优先」的归区口径（生成 / 护栏 / 准确率），并落实校准只写 **区域×渠道叶子**（与禁止全平台合计对称）。

**Architecture:** 将 `resolveSalesRowRegion` 提升为单一权威函数；基线生成改为「按平台一次拉日销 → 内存按区分桶」，替代仅 `stationIn` 的 SQL 分桶。校准链路在 API、矩阵抽屉、导入/导出三处对称拦截「区域或平台合计」。不新增 DB 迁移；不改补货主路径（已用 `resolveSalesRowRegion`）。

**Tech Stack:** Hono、`apps/web/server/lib/*`、React（`ForecastSkuDetailDrawer` / `ForecastHorizonPanel`）、node:test（`pnpm --filter @scm/web exec tsx --test <file>`）

## Global Constraints

- 设计基线：`docs/superpowers/specs/2026-11-12-sales-fulfillment-region-design.md` §5.1、§2.2
- **唯一可写叶子：** `sales_region ∈ {US,CA,EU,UK,MX,BR,OTHER,UNMAPPED}` × `platform ∈ V4.1 分平台`；`sales_region='ALL'` / `platform='ALL'` 为遗留或加总行，**不可写 `manual`**
- **归区：** 行上 `sales_region`（可映射码或 `UNMAPPED`）> `resolveSalesRegion(station)`；禁止猜区
- **单区筛选 + 区域「合计」展示：** 仅展示一个区域时，叶子仍是该区×渠道，**允许**在「分平台」下校准（与现网单站口径一致）
- Commit 仅在用户明确要求时执行
- 范围 **不含** P1（映射失败阻断基线、区域历史月表）、**不含** C 池 key 带 `salesRegion`（P2）

## File Structure（本 P0 触及）

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/region-mapping.ts` | 新增/导出 `resolveSalesRowRegion`（权威） |
| `apps/web/server/lib/region-channel-planning.ts` | 改为 re-export，避免双实现 |
| `apps/web/server/lib/forecast-region-partition.ts` | `groupRowsBySalesRegion` 内部调用权威函数 |
| `apps/web/server/lib/sales-history-query.ts` | 日销查询返回 `salesRegion`；可选按区过滤辅助 |
| `apps/web/server/lib/forecast-collaboration.ts` | 按平台一次加载 + 内存分区生成 |
| `apps/web/server/lib/forecast-aggregate-guard.ts` | 近 90 天基准用行上区域 |
| `apps/web/server/lib/forecast-accuracy.ts` | 实际销量归区用行上区域 |
| `apps/web/server/lib/forecast-calibration-import.ts` | 区域列 + cell key 四维 |
| `apps/web/server/lib/forecast-calibration-guard.ts` | **新建** 纯函数：是否可校准叶子 |
| `apps/web/server/routes/sales-forecast.ts` | PATCH 校验区域合计 |
| `apps/web/server/lib/forecast-horizon-export.ts` | 校准导出过滤遗留/合计区域 |
| `apps/web/src/lib/forecast-calibration-view.ts` | **新建** 前端与后端一致的「可编辑视图」判定 |
| `apps/web/src/components/ForecastSkuDetailDrawer.tsx` | `mergedRegion` 禁编 |
| `apps/web/src/components/ForecastHorizonPanel.tsx` | 导出校准前提示分区域 |

## 验收标准（P0 Done）

1. 单测：`行上 US + 站点 EU` 的日销计入 **US** 桶，不计入 EU（生成路径或纯函数测）。
2. 护栏 / 准确率：同上样例，实际侧 key 为 `sku::US::channel`。
3. PATCH `manual`：`platform=ALL` 或 `sales_region=ALL` → 400，中文文案与平台侧对称。
4. 矩阵：区域「合计」+ 多区、草稿 → 抽屉不可编辑校准；单区筛选 + 分平台 → 可编辑。
5. 导入：明细含「区域」列时，只匹配对应叶子；同 SKU 不同区域不撞键。
6. `pnpm --filter @scm/web exec tsx --test` 本计划新增/修改的 `*.test.ts` 全部通过。

---

### Task 1: 权威 `resolveSalesRowRegion`（TDD）

**Files:**
- Modify: `apps/web/server/lib/region-mapping.ts`
- Modify: `apps/web/server/lib/region-mapping.test.ts`（若无则 Create）
- Modify: `apps/web/server/lib/region-channel-planning.ts`
- Modify: `apps/web/server/lib/forecast-region-partition.ts`

**Interfaces:**
- Produces:
  - `export function resolveSalesRowRegion(row: { salesRegion?: string | null; station?: string | null }, tables: RegionMappingTables): RuntimeRegion`

- [ ] **Step 1: 写失败测试**

```ts
// region-mapping.test.ts 增补
it('resolveSalesRowRegion prefers row sales_region over station map', () => {
  const tables = { stations: new Map([['Amazon德国', 'EU']]), warehouses: new Map() };
  assert.equal(
    resolveSalesRowRegion({ salesRegion: 'US', station: 'Amazon德国' }, tables),
    'US',
  );
  assert.equal(resolveSalesRowRegion({ salesRegion: null, station: 'Amazon德国' }, tables), 'EU');
});
```

- [ ] **Step 2:** 在 `region-mapping.ts` 实现（逻辑与现 `region-channel-planning.ts:65-72` 一致，含 `UNMAPPED`）
- [ ] **Step 3:** `region-channel-planning.ts` 改为 `import { resolveSalesRowRegion } from './region-mapping.js'` 并 re-export（保持既有 import 不破坏）
- [ ] **Step 4:** `groupRowsBySalesRegion` 改为调用 `resolveSalesRowRegion`，删除重复分支
- [ ] **Step 5:** 运行 `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/region-mapping.test.ts`

---

### Task 2: 日销查询带出 `salesRegion`

**Files:**
- Modify: `apps/web/server/lib/sales-history-query.ts`
- Modify: `apps/web/server/lib/sales-history-query.test.ts`（若无则 Create 最小用例）

**Interfaces:**
- Consumes: `resolveSalesRowRegion`（Task 1）
- Produces: `DailySalesPoint.salesRegion` 在 `loadDailySalesBySkuIdsInRange` 的 SELECT 中填充

- [ ] **Step 1:** `loadDailySalesBySkuIdsInRange` 的 `select` 增加 `salesHistory.salesRegion`，写入 `DailySalesPoint`
- [ ] **Step 2:** 单测 mock 或断言 select 形状（若项目无 DB 单测，则依赖 Task 3 集成测）
- [ ] **Step 3:** 新增纯函数（同文件或 `sales-history-query.ts`）：

```ts
export function filterDailySalesByResolvedRegion<T extends DailySalesPoint>(
  rows: readonly T[],
  region: RuntimeRegion,
  tables: RegionMappingTables,
): T[] {
  return rows.filter((row) => resolveSalesRowRegion(row, tables) === region);
}
```

---

### Task 3: 基线生成 — 按平台一次加载 + 内存分区（核心）

**Files:**
- Modify: `apps/web/server/lib/forecast-collaboration.ts`
- Create: `apps/web/server/lib/forecast-collaboration-region-load.test.ts`

**Interfaces:**
- Consumes: `filterDailySalesByResolvedRegion`, `loadDailySalesBySkuIdsInRange`, `loadRegionMappingTables`
- Produces: `generateBaselineForPlatformRegions` 内每个 `(region, platform)` 使用**已过滤**的 `Map<skuId, DailySalesPoint[]>`

**设计要点（必做）：**

1. 在 `generateBaselineForPlatformRegions` 开头：`tables = await loadRegionMappingTables(db)`。
2. 对该 `platform` **只调用一次** `loadDailySalesBySkuIdsInRange({ …, platform, 不传 stationIn/stationNotIn })`。
3. 对每个 `bucket`：`filtered = filterDailySalesByResolvedRegion(allRows, bucket.region, tables)` 再 `groupDailySalesBySkuId`。
4. `generateBaselineForStationPlatform` 增加可选参数 `preloadedDailyBySku?: Map<...>`；若传入则**跳过**内部 `loadDailySalesBySkuIdsInRange` 的 station 过滤，仅用预加载 Map。
5. **保留** `stationIn/stationNotIn` 参数签名但标记 `@deprecated` 内部不再用于分区（避免大范围调用方改动）。
6. `useAllCatV41` 的 `platform: 'ALL'` 辅助加载同样用全量日销再按区过滤。

- [ ] **Step 1: 写失败测试** `forecast-collaboration-region-load.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterDailySalesByResolvedRegion } from './sales-history-query.js';
import type { RegionMappingTables } from './region-mapping.js';

const tables: RegionMappingTables = {
  stations: new Map([['Amazon德国', 'EU']]),
  warehouses: new Map(),
};

describe('forecast region load', () => {
  it('keeps row-level US out of EU filter', () => {
    const rows = [
      { skuId: '1', qtySold: 1, saleDate: '2026-01-01', station: 'Amazon德国', warehouseCode: null, salesRegion: 'US' },
      { skuId: '1', qtySold: 2, saleDate: '2026-01-02', station: 'Amazon德国', warehouseCode: null, salesRegion: null },
    ];
    const us = filterDailySalesByResolvedRegion(rows, 'US', tables);
    const eu = filterDailySalesByResolvedRegion(rows, 'EU', tables);
    assert.equal(us.length, 1);
    assert.equal(eu.length, 1);
    assert.equal(us[0]!.qtySold, 1);
    assert.equal(eu[0]!.qtySold, 2);
  });
});
```

- [ ] **Step 2:** 按设计要点改 `forecast-collaboration.ts`
- [ ] **Step 3:** 运行单测 + 现有 `forecast-collaboration.test.ts`（`resolveBaselinePurgePlatformScope` 等不受影响）

---

### Task 4: 护栏与准确率 — 实际销量归区

**Files:**
- Modify: `apps/web/server/lib/forecast-aggregate-guard.ts`
- Modify: `apps/web/server/lib/forecast-aggregate-guard.test.ts`
- Modify: `apps/web/server/lib/forecast-accuracy.ts`

**Interfaces:**
- Consumes: `resolveSalesRowRegion`, `salesHistory.salesRegion` 列

- [ ] **Step 1:** `loadRecentDailyBySkuRegionPlatform`：`groupBy` 增加 `salesHistory.salesRegion`（或行级查询后 `resolveSalesRowRegion`）
- [ ] **Step 2:** `loadActualMonthlyDailyAvgByRegion`（`forecast-accuracy.ts`）同样改为 `resolveSalesRowRegion`
- [ ] **Step 3:** 单测：同一 station 两行，`sales_region` 不同 → 不同 `pairKey`

---

### Task 5: 校准守卫纯函数 + API（TDD）

**Files:**
- Create: `apps/web/server/lib/forecast-calibration-guard.ts`
- Create: `apps/web/server/lib/forecast-calibration-guard.test.ts`
- Modify: `apps/web/server/routes/sales-forecast.ts`

**Interfaces:**
- Produces:

```ts
export type ForecastCalibrationLeaf = {
  platform: string;
  salesRegion: string;
};

export function assertCalibrationWritableLeaf(row: ForecastCalibrationLeaf): { ok: true } | { ok: false; message: string };

export function isMergedRegionCalibrationView(input: {
  splitByRegion: boolean;
  salesRegions: string[];
}): boolean;
```

**规则：**

- `platform === 'ALL'` → 不可写（沿用现文案）
- `salesRegion === 'ALL'` → 不可写（新文案：「全区域预测行不可直接校准，请切换「分区域」或导入校准」）
- `isMergedRegionCalibrationView`：`!splitByRegion && salesRegions.length !== 1`（0=全区合计，>1=多区筛选仍可能加总展示，与产品一致：仅 **恰好单区** 且合计展示时视为叶子视图）

- [ ] **Step 1:** 单测覆盖 ALL 平台 / ALL 区域 / 正常叶子
- [ ] **Step 2:** PATCH 路由在 `manualPatch !== undefined` 时调用 `assertCalibrationWritableLeaf(existing)`

---

### Task 6: 校准导入 — 区域列与四维键

**Files:**
- Modify: `apps/web/server/lib/forecast-calibration-import.ts`
- Modify: `apps/web/server/lib/forecast-calibration-import.test.ts`

**Interfaces:**
- Produces:
  - `COL_REGION = '区域'`，aliases：`sales_region`, `region`
  - `forecastCellKey(skuId, salesRegion, platform, year, month)`
  - `existingByKey` 查询 `select` 增加 `salesRegion`
  - 导入行 `importKey` = `sku|salesRegion|platform|month`
  - **版本含区域叶子时**：CSV 缺区域列 → blocking error（抽样提示「请用分区域视图导出」）
  - **仅遗留 `sales_region=ALL` 版本**：保持旧行为（无区域列，兼容）

- [ ] **Step 1:** 扩展现有 import test：两区同 SKU 同平台同月，校准不同值，两条均更新
- [ ] **Step 2:** 实现解析与 commit 路径
- [ ] **Step 3:** `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/forecast-calibration-import.test.ts`

---

### Task 7: 校准导出与矩阵 UI

**Files:**
- Create: `apps/web/src/lib/forecast-calibration-view.ts`
- Modify: `apps/web/server/lib/forecast-horizon-export.ts`
- Modify: `apps/web/src/components/ForecastSkuDetailDrawer.tsx`
- Modify: `apps/web/src/components/ForecastHorizonPanel.tsx`
- Modify: `apps/web/server/routes/sales-forecast.ts`（`calibration` export 400 规则）

**前端 `forecast-calibration-view.ts`：**

```ts
export function canEditForecastCalibration(input: {
  mergedChannelView: boolean;
  splitByRegion: boolean;
  salesRegions: string[];
}): boolean {
  if (input.mergedChannelView) return false;
  if (!input.splitByRegion && input.salesRegions.length !== 1) return false;
  return true;
}
```

**后端：**

- `buildForecastCalibrationImportCsv`：在 `platform !== 'ALL'` 基础上，`row.salesRegion && row.salesRegion !== 'ALL'`
- 路由 `mode=calibration`：若版本存在 `sales_region <> 'ALL'` 叶子且 `splitByRegion !== true` → 400（文案对称分平台）

**抽屉文案：** 增加区域合计说明（与平台合计并列）。

- [ ] **Step 1:** 单测 `forecast-calibration-view`（可用 vitest 或最小 tsx test，与 web 包惯例对齐；若无前端单测，以手动验收清单代替并记入 PR）
- [ ] **Step 2:** 改 Drawer / Panel / export
- [ ] **Step 3:** 手动冒烟：草稿版本 → 合计区域不可编 → 分区域+分平台可编

---

### Task 8: 文档与 PRD 脚注

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-sales-fulfillment-region-design.md` §5.1 增补一句：「校准仅叶子可写；区域/平台合计只读」
- Modify: `apps/web/src/components/ForecastDataExplorer.tsx` description 一句（可选，与实现一致）

- [ ] **Step 1:** 设计文档增补（半段，不扩大范围）
- [ ] **Step 2:** 在父计划 `2026-11-12-sales-fulfillment-region.md` 顶部链到本 P0 计划

---

## Self-Review（计划自检）

| 需求 | 任务 |
|------|------|
| 行上区域优先于站点（生成） | Task 1–3 |
| 护栏/准确率一致 | Task 4 |
| 区域合计不可校准（对称平台） | Task 5–7 |
| 导入带区域 | Task 6 |
| 单区筛选可校准 | Task 5–7 `salesRegions.length === 1` |
| 不含 P1/P2 | Global Constraints |

## 建议执行顺序与工期

| 顺序 | Task | 预估 |
|------|------|------|
| 1 | Task 1 | 0.5h |
| 2 | Task 2–3 | 2–3h（核心） |
| 3 | Task 4 | 1h |
| 4 | Task 5–6 | 1.5h |
| 5 | Task 7–8 | 1.5h |

**合并 PR 建议：** 后端 Task 1–6 一 PR；前端 + 路由 Task 7 一 PR；或单 PR 若规模可控。

---

## 执行方式（请选择）

**Plan 已保存至** `docs/superpowers/plans/2026-11-13-forecast-region-platform-p0.md`。

1. **Subagent-Driven（推荐）** — 每 Task 独立子代理 + 步骤间人工/主代理复核  
2. **本会话 Inline** — 按 Task 1→8 连续实现，每 2–3 个 Task 设检查点  

回复 **「1」** 或 **「2」**（也可指定「先做 Task 3」）即可开始实现。
