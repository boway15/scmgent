# Layered Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地独立「分层销量预测」模块：组别→品类→平台→SKU 自上而下生成、reconcile、锁定编辑与发布；不写 `sales_forecast_*`、不接补货。

**Architecture:** 纯函数算法层（趋势/季节/缩放/reconcile）+ 生成编排写 `layered_forecast_*` + Hono API + React 列表/详情。`startMonth` 复用 `forecast-start-month.ts`；平台列表复用 `FORECAST_V41_PLATFORM_CODES`；组别用 `skus.project_group`。

**Tech Stack:** Drizzle/Postgres、Hono、React、TanStack Query、node:test

## Global Constraints

- 独立模块：禁止写入 `sales_forecast_versions` / `sales_forecast_monthly`
- 层级：`project_group` → `category`（叶子）→ `platform` → `sku`；`station=ALL`
- 组别：`skus.project_group`，空 → `(未分组)`
- SKU：先 `draft_qty`（近 90 天日均 × 月天数 × 裁剪后品类月季节因子），再 reconcile
- 锁定 SKU 不参与 cascade/reconcile；`pool = max(parent - locked_sum, 0)`
- 发布默认要求加总差额为 0；允许多份 `published`
- 菜单：`data.layered_forecast`；文案标明不进补货
- Spec：`docs/superpowers/specs/2026-08-11-layered-forecast-design.md`
- Commit 仅在用户明确要求或本 plan 步骤要求且用户已授权执行时进行；若会话未授权提交则跳过 commit 步骤并继续

---

## File Map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/layered-forecast.ts` | versions + nodes schema + enums |
| `packages/db/src/schema/index.ts` | export |
| `packages/db/drizzle/0074_layered_forecast.sql` | 表 + 菜单 + 角色授权 |
| `packages/db/drizzle/meta/_journal.json` | 登记 0074 |
| `packages/db/src/seed.ts` | 新环境菜单 |
| `apps/web/server/lib/layered-forecast-dims.ts` | 组别/品类叶子/占位符常量 |
| `apps/web/server/lib/layered-forecast-dims.test.ts` | |
| `apps/web/server/lib/layered-forecast-series.ts` | 趋势、季节、外推、子节点缩放 |
| `apps/web/server/lib/layered-forecast-series.test.ts` | |
| `apps/web/server/lib/layered-forecast-draft.ts` | SKU `draft_qty` |
| `apps/web/server/lib/layered-forecast-draft.test.ts` | |
| `apps/web/server/lib/layered-forecast-reconcile.ts` | reconcile + cascade 纯函数 |
| `apps/web/server/lib/layered-forecast-reconcile.test.ts` | |
| `apps/web/server/lib/layered-forecast-generate.ts` | 读历史、建节点、落库 |
| `apps/web/server/lib/layered-forecast-generate.test.ts` | 纯函数部分 + 可选 mock |
| `apps/web/server/lib/layered-forecast-mutate.ts` | patch/lock/reconcile/publish |
| `apps/web/server/lib/layered-forecast-mutate.test.ts` | |
| `apps/web/server/routes/layered-forecast.ts` | HTTP |
| `apps/web/server/index.ts` | mount |
| `apps/web/src/lib/api.ts` | 客户端 |
| `apps/web/src/pages/LayeredForecastListPage.tsx` | 列表+生成 |
| `apps/web/src/pages/LayeredForecastDetailPage.tsx` | 下钻+编辑 |
| `apps/web/src/router.tsx` | 路由 |

---

### Task 1: 维度常量与纯函数（TDD）

**Files:**
- Create: `apps/web/server/lib/layered-forecast-dims.ts`
- Create: `apps/web/server/lib/layered-forecast-dims.test.ts`

**Interfaces:**
- Produces:
  - `LAYERED_UNGROUPED = '(未分组)'`
  - `LAYERED_UNCATEGORIZED = '(未分类)'`
  - `LAYERED_PLATFORM_ALL = 'ALL'`
  - `normalizeProjectGroup(value: string | null | undefined): string`
  - `categoryLeaf(category: string | null | undefined): string` — 用 `normalizeCategoryPath` 后取最后一段
  - `addMonths(period: string, delta: number): string`
  - `daysInMonth(period: string): number`
  - `buildHorizonPeriods(startMonth: string, horizonMonths: number): string[]`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAYERED_UNGROUPED,
  LAYERED_UNCATEGORIZED,
  normalizeProjectGroup,
  categoryLeaf,
  addMonths,
  daysInMonth,
  buildHorizonPeriods,
} from './layered-forecast-dims.js';

describe('layered-forecast-dims', () => {
  it('normalizes project group', () => {
    assert.equal(normalizeProjectGroup(null), LAYERED_UNGROUPED);
    assert.equal(normalizeProjectGroup('  '), LAYERED_UNGROUPED);
    assert.equal(normalizeProjectGroup('项目1组'), '项目1组');
  });
  it('takes category leaf', () => {
    assert.equal(categoryLeaf('A/B/椅子'), '椅子');
    assert.equal(categoryLeaf(null), LAYERED_UNCATEGORIZED);
  });
  it('builds horizon and month helpers', () => {
    assert.equal(addMonths('2026-01', 1), '2026-02');
    assert.equal(daysInMonth('2026-02'), 28);
    assert.deepEqual(buildHorizonPeriods('2026-07', 3), ['2026-07', '2026-08', '2026-09']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/web && node --import tsx --test server/lib/layered-forecast-dims.test.ts
```

- [ ] **Step 3: 实现 `layered-forecast-dims.ts`**

复用 `@scm/db` 无依赖；`normalizeCategoryPath` 从 `./sku-category.js` import。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**（若已授权）

```bash
git add apps/web/server/lib/layered-forecast-dims.ts apps/web/server/lib/layered-forecast-dims.test.ts
git commit -m "feat(layered-forecast): add dimension helpers"
```

---

### Task 2: 趋势 / 季节 / 子节点缩放（TDD）

**Files:**
- Create: `apps/web/server/lib/layered-forecast-series.ts`
- Create: `apps/web/server/lib/layered-forecast-series.test.ts`

**Interfaces:**
- Produces:
  - `fitLinear(values: number[]): { a: number; b: number; r2: number }`
  - `monthlySeasonalFactors(values: number[], periods: string[]): { factors: Record<number, number>; peakMonth: number; strength: number }`
  - `clipFactor(f: number, min = 0.7, max = 1.3): number`
  - `extrapolateTrendSeasonal(history: number[], historyPeriods: string[], futurePeriods: string[]): { qty: number[]; seasonalityFactor: number[]; peakMonth: number }`
  - `scaleChildrenToParent(parentQty: number, childDrafts: number[]): number[]` — 全 0 则均分；结果之和 = parentQty（浮点用 round 到 2 位后微调末项）

规则：
- 历史长度 &lt; 3：外推用均值（或末值）× 季节（无季节则 1）
- 季节：对每个日历月收集 `value / trend`，归一化均值 1；峰月 = max factor 月
- `extrapolate`：对 future 索引 i：`(a + b * (n+i)) * clip(season[month])`，负数夹 0

- [ ] **Step 1: 写失败测试**（含：缩放加总、季节峰月、clip、短序列）

- [ ] **Step 2: Run FAIL → 实现 → PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(layered-forecast): add trend seasonal series helpers"
```

---

### Task 3: SKU draft_qty + reconcile（TDD）

**Files:**
- Create: `apps/web/server/lib/layered-forecast-draft.ts`
- Create: `apps/web/server/lib/layered-forecast-draft.test.ts`
- Create: `apps/web/server/lib/layered-forecast-reconcile.ts`
- Create: `apps/web/server/lib/layered-forecast-reconcile.test.ts`

**Interfaces:**
- `computeSkuDraftQty(input: { recent90Qty: number; period: string; seasonalityFactor: number }): number`  
  `= max(0, (recent90Qty/90) * daysInMonth(period) * clipFactor(seasonalityFactor))`
- `reconcileUnlocked(input: { parentQty: number; items: { id: string; draftQty: number; locked: boolean; qty: number; recent90Qty?: number }[] }): { id: string; qty: number; systemQty: number }[]`  
  - locked 保持 `qty`  
  - pool = max(parent - lockedSum, 0)  
  - 未锁定按 draft 份额；draft 全 0 用 recent90；仍全 0 均分  
  - 返回仅未锁定的更新（或全部含锁定原值）
- `scaleSubtreeByShares(parentQty: number, children: { id: string; shareKey: number; locked: boolean; qty: number }[]): ...`  
  cascade 用：锁定不动，其余按 shareKey 分 pool

- [ ] **Step 1–4: TDD 覆盖锁定池、draft 全 0、均分**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(layered-forecast): add draft qty and reconcile"
```

---

### Task 4: DB schema + 迁移 + 菜单

**Files:**
- Create: `packages/db/src/schema/layered-forecast.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0074_layered_forecast.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/seed.ts`

**Schema 要点:**
- Enum `layered_forecast_version_status`: draft/published/archived
- Enum `layered_forecast_level`: project_group/category/platform/sku
- `layered_forecast_versions` 按 spec §3.1；`algo_meta` jsonb
- `layered_forecast_nodes` 按 spec §3.2；`qty/system_qty/draft_qty` numeric；`sku_id` nullable FK → skus
- Unique：**partial**  
  - 上层：`UNIQUE (version_id, level, project_group, category, platform, period) WHERE sku_id IS NULL`  
  - SKU：`UNIQUE (version_id, level, project_group, category, platform, sku_id, period) WHERE sku_id IS NOT NULL`

**Migration SQL:** 建表 + 索引 + 菜单

```sql
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.layered_forecast', '分层销量预测', '/data/layered-forecast', p."id", 5, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
```

角色授权同 `data.sales_analytics` 五角色。`seed.ts` 在 `data.forecast` / `data.sales_analytics` 旁增加菜单与角色 code。

- [ ] **Step 1: 写 schema + SQL + journal + seed**
- [ ] **Step 2: 本地可 migrate 时执行迁移**（Docker 环境按项目 SOP）
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(layered-forecast): add db schema and menu"
```

---

### Task 5: 生成编排（读历史 → 节点 → 落库）

**Files:**
- Create: `apps/web/server/lib/layered-forecast-generate.ts`
- Create: `apps/web/server/lib/layered-forecast-generate.test.ts`

**Interfaces:**
- `export type LayeredGenerateInput = { startMonth: string; horizonMonths?: number; projectGroup?: string; category?: string; createdBy?: string | null }`
- `export async function generateLayeredForecastVersion(input): Promise<{ versionId: string; versionNo: string; nodeCount: number }>`

**算法步骤（同步实现于单函数/可拆私有函数）:**

1. `parseAndValidateForecastStartMonth(startMonth)`；`horizon = horizonMonths ?? 12`（限制 1–18）
2. 建 version：`version_no = LF-YYYYMMDD-HHmmss`（或同类唯一）；status draft；station ALL；algo_meta 含 `categoryRule:'leaf'`, `platforms: FORECAST_V41_PLATFORM_CODES`, `zeroDraftRule:'recent90_then_equal'`
3. 查询 SKU：`project_group`、`category`、`id`；可选 filter
4. 查询 `sales_history`：`sale_date < startMonth`（日期 &lt; asOf），聚合到  
   - SKU×平台×月 qty  
   - 以及 recent90 截止 asOf-1 天  
   平台用现有 `normalizeSalesPlatform` / 别名同步函数归一到 V41 集合（未知 → UNKNOWN）
5. 历史月序列：对每个 (project_group, category leaf, platform) 与更高汇总（品类 ALL、组别 ALL）建 history 向量（按 period 对齐，缺月 0）
6. 对组别层每个 period 外推 → 缩放品类 → 缩放平台（子独立外推再 `scaleChildrenToParent`）
7. 每 SKU×平台×月 `draft_qty`；`reconcileUnlocked` → sku nodes
8. batch insert nodes（分批 500）
9. **禁止** touch sales_forecast 表

**单测:** 对「从内存 history 构建节点」抽纯函数 `buildLayeredNodesFromAggregates(...)` 测加总一致与锁定无关路径；DB 集成可轻量 mock 或跳过若无测试 DB。

- [ ] **Step 1: 纯函数构建节点测试 FAIL → 实现 → PASS**
- [ ] **Step 2: 实现 `generateLayeredForecastVersion` 落库**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(layered-forecast): add generate orchestration"
```

---

### Task 6: 变更 / 发布服务（TDD 纯逻辑 + DB 封装）

**Files:**
- Create: `apps/web/server/lib/layered-forecast-mutate.ts`
- Create: `apps/web/server/lib/layered-forecast-mutate.test.ts`

**Interfaces:**
- `assertDraft(version)` — 非 draft 抛错
- `computeImbalance(nodes, parentNode): number` — parent.qty - sum(children.qty)
- `async patchNodeQty({ versionId, nodeId, qty, cascade })`
  - SKU + !cascade：只更新该行 manual_edited
  - 上层或 cascade：更新父 qty，按 level 向下调用 `scaleSubtreeByShares`（SKU 层用 draft_qty 作 share；中间层用当前 qty）
- `async setNodeLocked({ versionId, nodeId, locked })`
- `async reconcileVersion({ versionId, mode, nodeId })`
  - `from_parent`：对该平台节点重跑 SKU reconcile
  - `reset_parent_from_children`：父 qty = Σ 子；若父是平台则停；若是品类/组别可再一层（一次按钮只改直接父）
- `async publishVersion(versionId, userId)`  
  - 全量检查：任意 platform 节点 imbalance ≠ 0（容差 0.01）→ 400  
  - 任意 qty &lt; 0 → 400  
  - status → published

- [ ] **Step 1: 对 imbalance / cascade 份额纯函数 TDD**
- [ ] **Step 2: 实现 mutate 服务**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(layered-forecast): add mutate lock reconcile publish"
```

---

### Task 7: HTTP 路由

**Files:**
- Create: `apps/web/server/routes/layered-forecast.ts`
- Modify: `apps/web/server/index.ts`

对齐现有 `sales-forecast.ts` 鉴权中间件风格（`requireAuth` / 菜单权限若项目有则挂 `data.layered_forecast`）。

| Method | Path |
|--------|------|
| POST | `/layered-forecasts/generate` |
| GET | `/layered-forecasts/versions` |
| GET | `/layered-forecasts/versions/:id` |
| GET | `/layered-forecasts/versions/:id/nodes` |
| PATCH | `/layered-forecasts/versions/:id/nodes/:nodeId` |
| POST | `/layered-forecasts/versions/:id/nodes/:nodeId/lock` |
| POST | `/layered-forecasts/versions/:id/reconcile` |
| POST | `/layered-forecasts/versions/:id/publish` |

一期可不做 `/tasks/:taskId`：generate 同步执行；若超时再加 background（YAGNI：SKU 量大时再加）。若生成可能 &gt;30s，复制 `forecast-baseline-task` 最小后台壳，路径保留。

`nodes` 查询：filter `level, projectGroup, category, platform, period`；默认 limit 200。

- [ ] **Step 1: 实现路由并 mount `app.route('/api', layeredForecastRoutes)`**
- [ ] **Step 2: 手工或最小 smoke（可选）**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(layered-forecast): add API routes"
```

---

### Task 8: 前端 API + 列表页

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/LayeredForecastListPage.tsx`
- Modify: `apps/web/src/router.tsx`

**UI 要点（对齐 SalesForecastListPage 密度）：**
- 标题「分层销量预测」+ 说明条：独立模块，不进补货，非原销售预测
- 生成：开始月（复用 `buildForecastStartMonthOptions` 前端拷贝或从 api 元数据）、horizon、可选组别/品类
- 表格：versionNo、name、startMonth、status、createdAt、入口详情

- [ ] **Step 1: api 方法**
- [ ] **Step 2: 列表页 + 路由 `/data/layered-forecast`**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(layered-forecast): add list page"
```

---

### Task 9: 详情页（下钻 / 编辑 / 锁定 / reconcile / 发布）

**Files:**
- Create: `apps/web/src/pages/LayeredForecastDetailPage.tsx`
- Modify: `apps/web/src/router.tsx` — `/data/layered-forecast/:versionId`

**UI:**
- 面包屑：组别 → 品类 → 平台 → SKU
- 当前层节点表：period、qty（可编辑 draft 状态）、system_qty、seasonality_factor、peak_month、locked（SKU）
- 顶栏：peak 摘要（从 nodes 聚合）、差额警告（选中父节点时算 imbalance）
- 按钮：保存（PATCH cascade=true 上层）、锁定、按父层 reconcile、按子重设父、发布
- 只读 published

- [ ] **Step 1: 实现详情页**
- [ ] **Step 2: Commit**

```bash
git commit -m "feat(layered-forecast): add detail page with drilldown"
```

---

### Task 10: 验收与隔离断言

**Files:**
- Create or extend: `apps/web/server/lib/layered-forecast-generate.test.ts`（若可）加注释型 checklist；或脚本断言

- [ ] **Step 1: 跑全部 layered-forecast 单测**

```bash
cd apps/web && node --import tsx --test server/lib/layered-forecast*.test.ts
```

Expected: PASS

- [ ] **Step 2: 确认代码路径无对 `salesForecastMonthly` / `salesForecastVersions` 的 insert/update（rg 检查 layered-forecast* 文件）**

```bash
rg "salesForecast|sales_forecast_" apps/web/server/lib/layered-forecast*.ts apps/web/server/routes/layered-forecast.ts
```

Expected: 无写入匹配（允许注释说明）

- [ ] **Step 3: 更新 spec 状态为「实现中/已实现」可选**
- [ ] **Step 4: 最终 commit（若需要）**

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 独立表/版本 | 4 |
| 层级与组别口径 | 1, 5 |
| 趋势季节旺季 | 2, 5 |
| SKU draft + reconcile | 3, 5 |
| 锁定 / cascade / 双 reconcile | 3, 6, 9 |
| 发布差额校验 | 6, 7 |
| API | 7 |
| 页面 | 8, 9 |
| 不进补货/不写旧预测 | Global + 10 |
| startMonth 回测 | 5（复用 forecast-start-month） |

## Out of scope（勿做）

- 补货、准确率、同步旧预测、看板同屏、后台 task（除非生成超时必须）、Dify
