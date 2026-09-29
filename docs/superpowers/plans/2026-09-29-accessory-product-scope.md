# 配件商品范围 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 销量、库存、预测、备货查询默认不含配件 SKU，可切到只看配件；需求计划一律不含配件，并在操作旁写明原因。

**Architecture:** 查询参数 `productScope=goods|accessory`（缺省 `goods`）在读接口过滤，判定复用 `isAccessorySku`。SQL 与内存过滤共用 `planning-accessory-filter.ts`。预测版本增加 `exclude_accessories`（历史行默认 true），用来决定「只看配件」空状态文案。销量分析立方在同一次扫描里拆成成品与配件两套 payload。

**Tech Stack:** React、Hono、Drizzle、Postgres、node:test + tsx。

**Spec:** `docs/superpowers/specs/2026-09-29-accessory-product-scope-design.md`

## Global Constraints

- `productScope` 只接受 `goods` 与 `accessory`；省略或其它值按 `goods`。没有「全部」。
- 判定与现有 `isAccessorySku` 一致：`skuKind=accessory`，或编码解析为配件，或变化段含 `P`。退货（末尾 `R`）、多箱留在 `goods`。
- 需求计划生成与列表继续硬排除，不提供范围开关。
- 预测「不含配件」默认勾选。取消勾选只影响这一次计算。
- 按 SKU id 打开的规划页、总览明细不套 `productScope`。飞书入库、销量导入、库存快照写入不按此参数丢行。
- 说明是页面正文，文案以规格 §6 为准，不写函数名。
- 成本核算 BOM「配件与包装」不改。

## File Structure

- `apps/web/server/lib/planning-accessory-filter.ts` — `ProductScope`、`parseProductScope`、`matchesProductScope`、`productScopeSql`、`productScopeOnSkuAlias`。
- `apps/web/server/lib/planning-accessory-filter.test.ts` — 判定与补集。
- `apps/web/src/lib/product-scope.ts` — 前端同名类型与 `parseProductScope`。
- `apps/web/src/lib/product-scope-copy.ts` — 规格 §6 的固定文案。
- `apps/web/src/components/ProductScopeSwitch.tsx` — 两段开关 + 短说明，读写地址栏 `productScope`。
- 各列表 route / service — 增加 `productScope`，缺省 `goods`。导出文件名加 `-goods` 或 `-accessory`。
- `packages/db/src/schema/sales-forecast.ts` + `packages/db/drizzle/0107_accessory_product_scope.sql` — `sales_forecast_versions.exclude_accessories boolean not null default true`。
- `packages/db/src/schema/sales-analytics.ts` — `sales_analytics_cube_snapshots.payload_accessory jsonb`。
- 需求计划与预测页面 — 只加说明或生成选项，需求计划不过滤开关。

---

### Task 1: 范围判定

**Files:**
- Modify: `apps/web/server/lib/planning-accessory-filter.ts`
- Create: `apps/web/server/lib/planning-accessory-filter.test.ts`

**Interfaces:**
- Consumes: `isAccessorySku` from `apps/web/server/lib/sku-encoding.ts`
- Produces:
  - `export type ProductScope = 'goods' | 'accessory'`
  - `export function parseProductScope(value: string | null | undefined): ProductScope`
  - `export function matchesProductScope(scope: ProductScope, sku: { code?: string | null; skuKind?: string | null }): boolean`
  - `export function productScopeSql(scope?: ProductScope): SQL` — 给 `skus` drizzle 列用；`accessory` 为 `NOT (goods 条件)`
  - `export function productScopeOnSkuAlias(scope: ProductScope, alias: 's'): SQL` — 返回以 `AND` 开头的片段，给总览原始 SQL 的别名 `s` 用

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesProductScope, parseProductScope } from './planning-accessory-filter.js';

describe('product scope', () => {
  it('defaults missing and unknown values to goods', () => {
    assert.equal(parseProductScope(undefined), 'goods');
    assert.equal(parseProductScope(''), 'goods');
    assert.equal(parseProductScope('all'), 'goods');
    assert.equal(parseProductScope('accessory'), 'accessory');
  });

  it('treats goods and accessory as complements', () => {
    const samples = [
      { code: 'DJ478585_2P02', skuKind: 'standard' },
      { code: 'DJ485882P01', skuKind: null },
      { code: '704576101P01', skuKind: null },
      { code: 'CUSTOM_2P', skuKind: null },
      { code: 'DJ502313_34', skuKind: 'standard' },
      { code: '704576101R', skuKind: 'return' },
      { code: '704576101B1', skuKind: 'multi_box' },
      { code: 'PLAIN', skuKind: 'accessory' },
    ];
    for (const sku of samples) {
      assert.equal(
        matchesProductScope('goods', sku),
        !matchesProductScope('accessory', sku),
      );
    }
    assert.equal(matchesProductScope('accessory', { code: 'DJ478585_2P02' }), true);
    assert.equal(matchesProductScope('goods', { code: '704576101R', skuKind: 'return' }), true);
    assert.equal(matchesProductScope('accessory', { code: 'PLAIN', skuKind: 'accessory' }), true);
    assert.equal(matchesProductScope('goods', { code: 'DJ502313_34', skuKind: 'standard' }), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/planning-accessory-filter.test.ts`

Expected: FAIL，`matchesProductScope` 未导出。

- [ ] **Step 3: Write minimal implementation**

在 `planning-accessory-filter.ts` 保留 `excludeAccessorySkuSql`，并追加：

```ts
import { isAccessorySku } from './sku-encoding.js';

export type ProductScope = 'goods' | 'accessory';

export function parseProductScope(value: string | null | undefined): ProductScope {
  return value === 'accessory' ? 'accessory' : 'goods';
}

export function matchesProductScope(
  scope: ProductScope,
  sku: { code?: string | null; skuKind?: string | null },
): boolean {
  const accessory = isAccessorySku(sku);
  return scope === 'accessory' ? accessory : !accessory;
}

export function productScopeSql(scope: ProductScope = 'goods'): SQL {
  const goods = excludeAccessorySkuSql();
  return scope === 'accessory' ? sql`NOT ${goods}` : goods;
}

export function productScopeOnSkuAlias(scope: ProductScope, alias: 's'): SQL {
  const goods = sql`(
    coalesce(${sql.raw(`${alias}.sku_kind`)}::text, '') <> 'accessory'
    AND ${sql.raw(`${alias}.code`)} !~* '_[^_]*P'
    AND ${sql.raw(`${alias}.code`)} !~* '^[A-Z]+[0-9]+P[0-9]+'
    AND ${sql.raw(`${alias}.code`)} !~* '^[0-9]{9}P[0-9]+'
  )`;
  const clause = scope === 'accessory' ? sql`NOT ${goods}` : goods;
  return sql`AND ${clause}`;
}
```

`excludeAccessorySkuSql` 的正则与上面四条保持一致，不要改判定。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/planning-accessory-filter.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/planning-accessory-filter.ts apps/web/server/lib/planning-accessory-filter.test.ts
git commit -m "feat(planning): add goods and accessory product scope"
```

---

### Task 2: 前端开关与文案

**Files:**
- Create: `apps/web/src/lib/product-scope.ts`
- Create: `apps/web/src/lib/product-scope-copy.ts`
- Create: `apps/web/src/components/ProductScopeSwitch.tsx`

**Interfaces:**
- Consumes: `ProductScope` 字面量与 Task 1 的 `parseProductScope` 规则（前端不 import server 文件，复制 4 行解析）
- Produces:
  - `useProductScope(): { productScope: ProductScope; setProductScope: (next: ProductScope) => void }`
  - `ProductScopeSwitch`：两段按钮「不含配件」「只看配件」，下方渲染 `PRODUCT_SCOPE_HINT`
  - 常量：`PRODUCT_SCOPE_HINT`、`DEMAND_PLAN_SCOPE_NOTICE`、`DEMAND_PLAN_GENERATE_HINT`、`FORECAST_EXCLUDE_ON`、`FORECAST_EXCLUDE_OFF`、`FORECAST_EMPTY_EXCLUDED`

- [ ] **Step 1: Add the copy module**

`apps/web/src/lib/product-scope-copy.ts`：

```ts
export const PRODUCT_SCOPE_HINT =
  '配件不参与销量、预测与备货，默认已排除。需要核对配件时，切换到「只看配件」。';

export const DEMAND_PLAN_SCOPE_NOTICE =
  '本页一律不含配件。配件（编码变化段含 P，或主数据标记为配件）不参与备货，需求计划不生成、不展示配件 SKU。要看配件库存或销量，请到库存查询或销量历史，切换到「只看配件」。';

export const DEMAND_PLAN_GENERATE_HINT = '生成时自动跳过配件 SKU，草稿里不会出现配件。';

export const FORECAST_EXCLUDE_ON =
  '默认不含配件。配件（编码变化段含 P，或主数据标记为配件）销量不作为备货依据，本次预测不会写入配件 SKU。取消勾选后，仅这一版会包含配件，结果页可用「只看配件」查看。';

export const FORECAST_EXCLUDE_OFF =
  '本次预测会包含配件 SKU。需求计划仍然不含配件，补货不会按这些配件行下单。';

export const FORECAST_EMPTY_EXCLUDED =
  '本版预测生成时已排除配件，所以这里没有配件行。若要单独看配件预测，请重新生成并取消「不含配件」。';
```

- [ ] **Step 2: Add the URL hook and switch**

`apps/web/src/lib/product-scope.ts`：

```ts
import { useSearchParams } from 'react-router-dom';

export type ProductScope = 'goods' | 'accessory';

export function parseProductScope(value: string | null | undefined): ProductScope {
  return value === 'accessory' ? 'accessory' : 'goods';
}

export function useProductScope() {
  const [searchParams, setSearchParams] = useSearchParams();
  const productScope = parseProductScope(searchParams.get('productScope'));
  const setProductScope = (next: ProductScope) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'goods') params.delete('productScope');
    else params.set('productScope', 'accessory');
    setSearchParams(params);
  };
  return { productScope, setProductScope };
}
```

`ProductScopeSwitch.tsx` 用现有 `Button`。当前范围 `variant="default"`，另一段 `variant="outline"`。按钮组下方：

```tsx
<p className="text-xs text-text-sub">{PRODUCT_SCOPE_HINT}</p>
```

可选 `extra` 属性，数据问题页用来接「另有 N 条配件问题」。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/product-scope.ts apps/web/src/lib/product-scope-copy.ts apps/web/src/components/ProductScopeSwitch.tsx
git commit -m "feat(web): add accessory scope switch and copy"
```

---

### Task 3: 库存查询

**Files:**
- Modify: `apps/web/server/lib/inventory-query-service.ts`
- Modify: `apps/web/server/lib/inventory-query-service.test.ts`
- Modify: `apps/web/server/routes/inventory.ts`（`parseQueryFilters`、`/inventory/query`、`/inventory/query/export`）
- Modify: `apps/web/src/lib/api.ts`（`getInventoryQuery` 与导出参数）
- Modify: `apps/web/src/pages/InventoryQueryPage.tsx`

**Interfaces:**
- Consumes: `matchesProductScope`、`parseProductScope`、`ProductScopeSwitch`
- Produces: 列表与导出都吃 `productScope`，缺省 `goods`

- [ ] **Step 1: Extend the failing filter test**

在 `inventory-query-service.test.ts` 增加一条：`skuCode: 'DJ478585_2P02'` 与 `skuCode: 'DJ502313_34'`。`productScope: 'goods'` 只留成品；`productScope: 'accessory'` 只留配件；不传 `productScope` 与 `goods` 相同。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-query-service.test.ts`

Expected: FAIL，过滤结果仍是 2 行。

- [ ] **Step 3: Filter in memory and thread the query**

`InventoryQueryListFilters` 增加 `productScope?: ProductScope`。`filterInventoryQueryItems` 在现有条件之后：

```ts
const scope = filters.productScope ?? 'goods';
if (!matchesProductScope(scope, { code: item.skuCode })) return false;
```

`listInventoryQueryRows` 与 `buildInventoryQueryExportRows` 把 `productScope` 传进 `filterInventoryQueryItems`。库存查询快照没有 `skuKind`，这里只按编码；`skuKind=accessory` 但编码不像配件的行要等主数据标记，查询快照无法带出 kind 时仍按编码。这与快照列能力一致，不回表。

`parseQueryFilters` 增加 `productScope: parseProductScope(c.req.query('productScope'))`。导出文件名：

```ts
`inventory-query-${date}-${filters.productScope}.csv`
```

页面用 `useProductScope()`，把 `productScope` 放进 `useQuery` key 和 `getInventoryQuery` / 导出请求。筛选条上方放 `<ProductScopeSwitch />`。切换范围时把页码重置为 1。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-query-service.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-query-service.ts apps/web/server/lib/inventory-query-service.test.ts apps/web/server/routes/inventory.ts apps/web/src/lib/api.ts apps/web/src/pages/InventoryQueryPage.tsx
git commit -m "feat(inventory): filter query rows by product scope"
```

---

### Task 4: 库存总览

**Files:**
- Modify: `apps/web/server/lib/inventory-overview-service.ts`（`InventoryOverviewQuery`、`buildSkuFilters`、`buildInventoryOverviewRows`、`countInventoryOverviewRows`、`buildInventoryOverviewExportItems`）
- Modify: `apps/web/server/routes/inventory.ts`（`parseOverviewFilters`、总览列表与导出）
- Modify: `apps/web/src/pages/InventoryOverviewPage.tsx`
- Modify: `apps/web/src/lib/api.ts` 总览请求参数

**Interfaces:**
- Consumes: `productScopeOnSkuAlias`、`parseProductScope`
- Produces: 列表、计数、导出同一 `productScope`。`buildInventoryOverviewItemBySkuId` 不加该条件。

- [ ] **Step 1: Add the SQL fragment**

`InventoryOverviewQuery` 增加 `productScope?: ProductScope`。`buildSkuFilters` 在返回前拼上：

```ts
parts.push(productScopeOnSkuAlias(query.productScope ?? 'goods', 's'));
```

`productScopeOnSkuAlias` 已带 `AND`。`buildSkuFilters` 今天在有条件时返回 `AND ...`，无条件时返回空 SQL。改为始终至少包含范围条件，避免默认不过滤：

```ts
const scope = productScopeOnSkuAlias(query.productScope ?? 'goods', 's');
if (!parts.length) return scope;
return sql`${scope} AND ${sql.join(parts, sql` AND `)}`;
```

注意 `productScopeOnSkuAlias` 开头已是 `AND`，`parts` 里的条件不要再重复 `AND` 前缀。按现有 `parts.push(sql\`s.category ILIKE ...\`)` 的写法，最终是 `AND (scope) AND cat AND ...`。

导出文件名加 `-${productScope}`。路由 `parseOverviewFilters` 解析 `productScope`。

`buildInventoryOverviewItemBySkuId` 保持只按 skuId 查。

- [ ] **Step 2: Wire the page**

`InventoryOverviewPage` 使用 `useProductScope()`，请求带上 `productScope`，筛选区放 `ProductScopeSwitch`。页面上「主数据全量」一类计数说明改为「不含配件」或「只看配件」，与当前开关一致。

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/lib/inventory-overview-service.ts apps/web/server/routes/inventory.ts apps/web/src/lib/api.ts apps/web/src/pages/InventoryOverviewPage.tsx
git commit -m "feat(inventory): default overview to goods scope"
```

---

### Task 5: 库存池、未分配供应、数据问题

**Files:**
- Modify: `apps/web/server/lib/inventory-supply-lot-summary.ts`（`parseSupplyLotSummaryFilters`、已有 `innerJoin(skus)` 的列表与 count）
- Modify: `apps/web/server/lib/inventory-supply-lot-sync.ts`（批次列表与导出）
- Modify: `apps/web/server/lib/inventory-dest-allocation-store.ts`（`listUnallocatedSupply`、`countOpenUnallocatedLots`、`sumOpenUnallocatedQtyFiltered`）
- Modify: `apps/web/server/routes/inventory-pools.ts`（把 query 传进 parse，导出文件名加后缀）
- Modify: `apps/web/server/routes/inventory-unallocated.ts`
- Modify: `apps/web/server/routes/inventory-data-issues.ts`
- Modify: `apps/web/src/pages/InventoryPoolsPage.tsx`
- Modify: `apps/web/src/pages/InventoryUnallocatedPage.tsx`
- Modify: `apps/web/src/pages/InventoryDataIssuesPage.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `productScopeSql`、`parseProductScope`、`ProductScopeSwitch`
- Produces: 三个列表缺省 `goods`。数据问题响应增加 `accessoryOpenCount: number`

池汇总、批次、未分配都在已有 `innerJoin(skus)` 的 where 末尾追加：

```ts
conditions.push(productScopeSql(filters.productScope ?? 'goods'));
```

`SupplyLotSummaryFilters` 与未分配 filters 增加 `productScope?: ProductScope`。路由用 `parseProductScope(c.req.query('productScope'))` 填入。按 `skuId` 打开未分配时仍保留 `skuId`，同时套范围。单 SKU 规划页不在本任务。

池导出与批次导出文件名在日期后加 `-${productScope}`，例如 `inventory-pools-2026-09-29-goods.csv`。

数据问题在同一组 status / type / q 条件下再查一次 `productScopeSql('accessory')` 的 `count(*)`，放到 `accessoryOpenCount`。列表本身用请求里的 `productScope`（缺省 goods）。

数据问题页：`<ProductScopeSwitch extra={<>另有 {accessoryOpenCount} 条配件问题</>} />`。`extra` 只在当前是 `goods` 时显示。

池页面、未分配页面同样放开关，并把 `productScope` 写入对应列表与汇总请求。汇总卡片用过滤后的结果，不另算全量。

- [ ] **Step 1: Add the SQL condition on each route**
- [ ] **Step 2: Add the switch on each page**
- [ ] **Step 3: Commit**

```bash
git add apps/web/server/lib/inventory-supply-lot-summary.ts apps/web/server/lib/inventory-supply-lot-sync.ts apps/web/server/lib/inventory-dest-allocation-store.ts apps/web/server/routes/inventory-pools.ts apps/web/server/routes/inventory-unallocated.ts apps/web/server/routes/inventory-data-issues.ts apps/web/src/pages/InventoryPoolsPage.tsx apps/web/src/pages/InventoryUnallocatedPage.tsx apps/web/src/pages/InventoryDataIssuesPage.tsx apps/web/src/lib/api.ts
git commit -m "feat(inventory): scope pools, unallocated supply, and data issues"
```

---

### Task 6: 安全库存、预警、补货、经营看板、规划入口

**Files:**
- Modify: `apps/web/server/routes/safety-stock.ts`
- Modify: `apps/web/server/routes/alerts.ts`
- Modify: `apps/web/server/routes/reorder.ts`
- Modify: `apps/web/server/lib/planning-dashboard.ts`
- Modify: `apps/web/src/pages/SafetyStockPage.tsx`
- Modify: `apps/web/src/pages/AlertsPage.tsx`
- Modify: `apps/web/src/pages/ReorderSuggestionsPage.tsx`
- Modify: `apps/web/src/pages/PlanningDashboardPage.tsx`
- Modify: `apps/web/src/pages/SkuPlanningEntryPage.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `productScopeSql`、`productScopeOnSkuAlias`、`ProductScopeSwitch`
- Produces: 上述列表与看板计数缺省 `goods`。`/inventory/planning/:skuId` 不改。

安全库存（`safetyStockConfig` join `skus`）、预警（`stockAlerts` join `skus`）、补货建议（`reorderSuggestions` join `skus`）的列表与 count 都追加 `productScopeSql(productScope)`。按单个 `skuId` 读写安全库存配置的接口不加范围，避免打开配件 SKU 时保存失败。

`getPlanningDashboard(today, productScope = 'goods')` 里每一段 `FROM ${skus} s WHERE s.is_active = true` 追加：

```ts
AND ${productScopeSql(productScope)}
```

`productScopeSql` 引用 drizzle 的 `skus` 列，生成带表名的 SQL，与别名 `s` 同时存在时仍指向同一张表。`active_skus` 与后面的 `operational_skus` 使用同一个 `productScope`。看板路由把 query 传进去，缺省 `goods`。

`SkuPlanningEntryPage` 的检索请求带 `productScope`，检索结果过滤配件。进入 `/inventory/planning/:skuId` 后不再过滤。入口页放开关。

各页放 `ProductScopeSwitch`，`useQuery` key 含 `productScope`。

- [ ] **Step 1: Thread productScope through the four list APIs and the dashboard SQL**
- [ ] **Step 2: Add the switch and dashboard hint「不含配件」**
- [ ] **Step 3: Commit**

```bash
git add apps/web/server/routes/safety-stock.ts apps/web/server/routes/alerts.ts apps/web/server/routes/reorder.ts apps/web/server/lib/planning-dashboard.ts apps/web/src/pages/SafetyStockPage.tsx apps/web/src/pages/AlertsPage.tsx apps/web/src/pages/ReorderSuggestionsPage.tsx apps/web/src/pages/PlanningDashboardPage.tsx apps/web/src/pages/SkuPlanningEntryPage.tsx apps/web/src/lib/api.ts
git commit -m "feat(planning): exclude accessories from stock and reorder views"
```

---

### Task 7: 销量历史与销量分析

**Files:**
- Modify: `apps/web/server/routes/sales.ts`（`parseSalesFilters`、`parseMonthlySalesFilters`）
- Modify: `apps/web/server/lib/sales-analytics-cube.ts`
- Modify: `apps/web/server/lib/sales-analytics-cube.test.ts`
- Modify: `packages/db/src/schema/sales-analytics.ts`
- Modify: `packages/db/drizzle/0107_accessory_product_scope.sql`（本任务先写立方列；预测列在 Task 8 补进同一文件，若 Task 8 已存在则合并，不要建 0108）
- Modify: `packages/db/drizzle/meta/_journal.json`（idx 88，tag `0107_accessory_product_scope`）
- Modify: `apps/web/server/routes/sales-analytics.ts`
- Modify: `apps/web/src/pages/SalesHistoryPage.tsx`
- Modify: `apps/web/src/pages/SalesAnalyticsPage.tsx`

**Interfaces:**
- Consumes: `productScopeSql`、`matchesProductScope`
- Produces:
  - 日销与月销列表、`summary.totalQty` 同一 scope
  - 立方 `payload` = goods，`payloadAccessory` = accessory
  - 读取接口按 `productScope` 返回对应 payload

- [ ] **Step 1: Filter sales history**

`parseSalesFilters` 与 `parseMonthlySalesFilters` 的 `conditions` 追加 `productScopeSql(parseProductScope(c.req.query('productScope')))`。日销与月销列表、汇总、`/sales/history/export`、`/sales/history/monthly/export` 都走这两个 parse。导出文件名改为 `sales-history-daily-${date}-${productScope}.csv` 与 `sales-history-monthly-${date}-${productScope}.csv`。`SalesHistoryPage` 放 `ProductScopeSwitch`，日表、月表和导出都带 `productScope`。

- [ ] **Step 2: Split the analytics cube**

`accumulateSalesHistoryPages` 的 select 增加 `skuCode: skus.code`、`skuKind: skus.skuKind`。分页时把行分成两页再分别 `accumulateCubeRowsInto`。没有 sku 的行（left join 为空）进入 goods。

`SalesAnalyticsCubePayload` 的写入：

```ts
payload: goodsPayload,
payloadAccessory: accessoryPayload,
```

schema 增加：

```ts
payloadAccessory: jsonb('payload_accessory').$type<SalesAnalyticsCubePayload>(),
```

SQL：

```sql
ALTER TABLE "sales_analytics_cube_snapshots"
  ADD COLUMN IF NOT EXISTS "payload_accessory" jsonb;
```

`getLatestReadyCube(scope)`：`goods` 返回 `payload`；`accessory` 返回 `payloadAccessory`。旧快照 `payload_accessory` 为空时，`accessory` 返回空立方，`meta.note = '当前快照尚未拆分配件，请重新生成销量分析'`。`goods` 在该字段为空时仍返回旧 `payload`，并在 meta 加 `scopePending: true`。页面在 `scopePending` 时于开关下额外显示：当前快照尚未按配件拆分，请重新生成分析立方；在此之前「不含配件」仍包含生成时的配件销量。

在 `sales-analytics-cube.test.ts` 增加纯函数测试：输入一行 `DJ502313_34` 与一行 `DJ478585_2P02`，goods 的 `totalSales` 只含成品数量，accessory 只含配件数量。把拆分抽成 `splitCubeSourceRows(rows)`，测试不连数据库。

- [ ] **Step 3: Run test**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/sales-analytics-cube.test.ts`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routes/sales.ts apps/web/server/lib/sales-analytics-cube.ts apps/web/server/lib/sales-analytics-cube.test.ts apps/web/server/routes/sales-analytics.ts apps/web/src/pages/SalesHistoryPage.tsx apps/web/src/pages/SalesAnalyticsPage.tsx packages/db/src/schema/sales-analytics.ts packages/db/drizzle/0107_accessory_product_scope.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(sales): split history and analytics by product scope"
```

---

### Task 8: 预测生成选项与结果范围

**Files:**
- Modify: `packages/db/src/schema/sales-forecast.ts`
- Modify: `packages/db/drizzle/0107_accessory_product_scope.sql`
- Modify: `apps/web/server/lib/forecast-collaboration.ts`（`generateBaselineForecastVersion` 入参与约 1034–1044 行过滤）
- Modify: `apps/web/server/lib/forecast-horizon.ts`（两处 `excludeAccessorySkuSql()`，`ForecastHorizonResult`）
- Modify: `apps/web/server/routes/sales-forecast.ts`（生成 body、horizon query）
- Modify: `apps/web/src/pages/SalesForecastListPage.tsx`（生成预测卡片）
- Modify: `apps/web/src/pages/SalesForecastVersionDetailPage.tsx`
- Modify: `apps/web/src/lib/forecast-methodology.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `productScopeSql`、`parseProductScope`、`FORECAST_EXCLUDE_ON`、`FORECAST_EXCLUDE_OFF`、`FORECAST_EMPTY_EXCLUDED`、`ProductScopeSwitch`
- Produces:
  - `sales_forecast_versions.exclude_accessories boolean not null default true`
  - 生成入参 `excludeAccessories?: boolean`，缺省 `true`
  - horizon 响应增加 `excludeAccessories: boolean` 与 `accessoryEmptyReason: 'excluded_at_generation' | null`

- [ ] **Step 1: Add the column**

schema：

```ts
excludeAccessories: boolean('exclude_accessories').notNull().default(true),
```

SQL 追加到 0107：

```sql
ALTER TABLE "sales_forecast_versions"
  ADD COLUMN IF NOT EXISTS "exclude_accessories" boolean NOT NULL DEFAULT true;
```

已有版本默认 true，与今天「生成时写死排除」一致。

- [ ] **Step 2: Honor the flag while generating**

`generateBaselineForecastVersion` 增加 `excludeAccessories?: boolean`。实际使用：

```ts
const excludeAccessories = input.excludeAccessories !== false;
```

写入版本行 `excludeAccessories`。在约 1044 行：

```ts
if (excludeAccessories) {
  if (skuCodeFilter && skuRows.every((sku) => isAccessorySku({ code: sku.code, skuKind: sku.skuKind }))) {
    throw new Error(`SKU ${input.skuCode?.trim()} 为配件（编码变化段含 P，或主数据标记为配件），不参与本次销售预测`);
  }
  skuRows = skuRows.filter((sku) => !isAccessorySku({ code: sku.code, skuKind: sku.skuKind }));
}
```

`excludeAccessories === false` 时不过滤、不抛配件错误。沿用已有版本且本次未传该字段时，读版本上的 `excludeAccessories`，避免单 SKU 重算把配件写进「不含配件」版本。

生成路由从 body 读 `excludeAccessories`，缺省 true。

- [ ] **Step 3: Filter horizon results**

`listForecastHorizon` 增加 `productScope?: ProductScope`。两处 `excludeAccessorySkuSql()`（聚合列表与 `listForecastHorizon` 内）改为 `productScopeSql(input.productScope ?? 'goods')`。`/sales-forecasts/horizon/export` 使用同一 `productScope`，文件名加 `-${productScope}`。

当 `productScope === 'accessory'` 且版本 `excludeAccessories === true` 且 `items.length === 0`：

```ts
accessoryEmptyReason: 'excluded_at_generation'
```

否则 `accessoryEmptyReason: null`。响应同时返回 `excludeAccessories`。

- [ ] **Step 4: Update the UI copy**

`SalesForecastListPage` 生成卡片增加复选框，默认勾选，label「不含配件」。勾选时段落用 `FORECAST_EXCLUDE_ON`，取消时用 `FORECAST_EXCLUDE_OFF`。提交 body 带 `excludeAccessories`。

`SalesForecastVersionDetailPage` 放 `ProductScopeSwitch`。`accessoryEmptyReason === 'excluded_at_generation'` 时空状态用 `FORECAST_EMPTY_EXCLUDED`，不用通用「没有符合筛选的 SKU」。

`forecast-methodology.ts` 准入段落后加一条：默认生成不含配件；需求计划始终不含配件。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/sales-forecast.ts packages/db/drizzle/0107_accessory_product_scope.sql apps/web/server/lib/forecast-collaboration.ts apps/web/server/lib/forecast-horizon.ts apps/web/server/routes/sales-forecast.ts apps/web/src/pages/SalesForecastListPage.tsx apps/web/src/pages/SalesForecastVersionDetailPage.tsx apps/web/src/lib/forecast-methodology.ts apps/web/src/lib/api.ts
git commit -m "feat(forecast): optional accessory exclusion with visible copy"
```

若 Task 7 已提交 0107，本任务只改 SQL 文件并再提交一次，journal 不重复加 tag。

---

### Task 9: 需求计划说明

**Files:**
- Modify: `apps/web/src/pages/DemandPlanPilotPage.tsx`
- Modify: `apps/web/src/pages/DemandPlanDetailPage.tsx`
- Modify: `apps/web/src/lib/demand-plan-utils.ts`

**Interfaces:**
- Consumes: `DEMAND_PLAN_SCOPE_NOTICE`、`DEMAND_PLAN_GENERATE_HINT`
- Produces: 两页常驻说明。不增加 `productScope`。服务端 `excludeAccessorySkuSql` / `isAccessorySku` 保持硬排除。

- [ ] **Step 1: Replace the short skip sentence**

`DemandPlanPilotPage` 流程卡 `CardContent` 末尾增加：

```tsx
<p className="text-sm text-text-main">{DEMAND_PLAN_SCOPE_NOTICE}</p>
```

生成草稿 `CardHeader` 里现有「配件 SKU（变化含 P）自动跳过。」换成 `DEMAND_PLAN_GENERATE_HINT`。

`DemandPlanDetailPage` 在 `PageHeader` 下方、现有说明卡内第一段之前放同一段 `DEMAND_PLAN_SCOPE_NOTICE`。不要加开关。

`DEMAND_PLAN_SKIP_REASON_LABEL.accessory` 改为 `配件 SKU 不参与备货预测`。

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/DemandPlanPilotPage.tsx apps/web/src/pages/DemandPlanDetailPage.tsx apps/web/src/lib/demand-plan-utils.ts
git commit -m "docs(demand-plan): explain that accessories stay out of planning"
```

---

### Task 10: 主数据配件标记

**Files:**
- Modify: `apps/web/server/routes/products.ts`（SKU 列表映射处已有 `skuKind`）
- Modify: `apps/web/src/lib/product-master-sku-columns.ts` 或 `ProductMasterSkuTable.tsx`
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`（标题旁标记）

**Interfaces:**
- Consumes: `isAccessorySku`
- Produces: 列表项 `isAccessory: boolean`。主数据默认仍返回全部 SKU，不套 `productScope`。

- [ ] **Step 1: Return the flag**

列表映射：

```ts
isAccessory: isAccessorySku({ code: row.code, skuKind: row.skuKind }),
```

表格在 SKU 编码旁，`isAccessory` 为真时显示小标签「配件」。不默认隐藏这些行。

`SkuInventoryPlanningPage` 若详情里已有 `skuKind` 与 `code`，同样显示「配件」。该页不读 `productScope`。

- [ ] **Step 2: Commit**

```bash
git add apps/web/server/routes/products.ts apps/web/src/components/ProductMasterSkuTable.tsx apps/web/src/pages/SkuInventoryPlanningPage.tsx
git commit -m "feat(products): mark accessory SKUs on the master list"
```

若标记实际写在 `product-master-sku-columns.ts`，把该文件换进 `git add`。

---

### Task 11: 验收核对

**Files:**
- 无新文件。跑已有单测并按规格 §8 对页面。

- [ ] **Step 1: Run the unit tests**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/planning-accessory-filter.test.ts server/lib/inventory-query-service.test.ts server/lib/sales-analytics-cube.test.ts
```

Expected: PASS。

- [ ] **Step 2: Check the spec acceptance list**

- 库存查询、库存总览、销量历史默认看不到 `DJ478585_2P02`；切到「只看配件」后只剩配件，汇总跟着变。
- 导出文件名带 `-goods` 或 `-accessory`，行与屏幕一致。
- 预测默认勾选时能读到「默认不含配件」；取消后文案改为本次会包含配件。不含配件的版本在结果页切到「只看配件」时出现 `FORECAST_EMPTY_EXCLUDED`。
- 需求计划列表与明细能读到「一律不含配件」，没有范围开关。
- 可切换页面开关旁有 `PRODUCT_SCOPE_HINT`。
- 按 SKU id 打开配件规划页仍能看到该 SKU，并有「配件」标记。
- 数据问题默认列表不含配件，同时能看到配件问题条数。
- 采购跟单、FOB、成本核算页面没有这段备货说明。
