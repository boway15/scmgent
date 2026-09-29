# SKU 健康灯筛选与整 SKU 供应舱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 规划入口用最差仓健康灯巡检并多选筛选；规划详情升级为整 SKU 供应舱（头寸 + 分仓灯 + 批次/跟单/发运）。

**Architecture:** 一期在 `inventory-light` 抽出最差灯聚合，overview API 挂最新健康快照并支持 `healthStatuses`；入口改展示与芯片。二期给网络分仓摘要补 `healthStatus`，规划详情默认网络并分区挂载既有 pools / purchase / shipments 查询。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `node:test` via `pnpm --filter @scm/web exec tsx --test`

**Spec:** `docs/superpowers/specs/2026-09-29-sku-health-cockpit-design.md`

## Global Constraints

- 最差仓优先级：`红 > 黄 > 绿 > 蓝 > 灰`（`red:5 … gray:1`）
- 不改 `skus.replenish_light` 语义；库存总览补货灯列不动
- 不改健康计算公式；只读 `inventory_health_snapshots`
- 无快照 → `healthStatus: null`（未评估）；不进五色筛选
- 舱内只读；不写目的仓分配
- 一期可独立上线；二期不阻塞一期
- 测试：`pnpm --filter @scm/web exec tsx --test <file>`；Expected: `fail 0`
- Git：仅在用户明确要求时 commit（计划中的 commit 步骤视为「待用户授权」）

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/inventory-light.ts` | 导出 `HEALTH_PRIORITY`、`pickWorstInventoryHealth` |
| `apps/web/server/lib/inventory-light.test.ts` | 最差灯单测 |
| `apps/web/server/lib/sku-health-aggregate.ts` | 按 SKU 批量加载最新仓灯并聚合最差灯 |
| `apps/web/server/lib/sku-health-aggregate.test.ts` | parse/filter 纯函数测 |
| `apps/web/server/lib/inventory-overview-service.ts` | 挂 `healthStatus`、筛 `healthStatuses`（快照路径 + 当前态） |
| `apps/web/server/routes/inventory.ts` | 解析 `healthStatuses` query |
| `apps/web/src/lib/api.ts` | overview 参数/类型；`InventoryOverview.healthStatus` |
| `apps/web/src/components/InventoryHealthBadge.tsx` | 业务四档 title；未评估展示 |
| `apps/web/src/pages/SkuPlanningEntryPage.tsx` | 健康灯列 + 多选芯片 |
| `apps/web/server/lib/inventory-planning-service.ts` | `NetworkWarehouseSummary.healthStatus` |
| `apps/web/server/lib/inventory-planning-service.test.ts` | 分仓灯字段 |
| `apps/web/src/pages/SkuInventoryPlanningPage.tsx` | 供应舱布局 + 三路只读列表 |

---

## Phase 1 — 入口健康灯 + 筛选

### Task 1: 最差灯纯函数

**Files:**
- Modify: `apps/web/server/lib/inventory-light.ts`
- Create: `apps/web/server/lib/inventory-light.test.ts`（若已存在则追加）

**Interfaces:**
- Produces: `HEALTH_PRIORITY: Record<InventoryHealth, number>`
- Produces: `pickWorstInventoryHealth(statuses: readonly InventoryHealth[]): InventoryHealth | null`

- [ ] **Step 1: Write the failing test**

在 `apps/web/server/lib/inventory-light.test.ts` 新增（或创建）:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickWorstInventoryHealth } from './inventory-light.js';

describe('pickWorstInventoryHealth', () => {
  it('returns null for empty', () => {
    assert.equal(pickWorstInventoryHealth([]), null);
  });

  it('picks red over yellow over green over blue over gray', () => {
    assert.equal(pickWorstInventoryHealth(['gray', 'blue', 'green']), 'green');
    assert.equal(pickWorstInventoryHealth(['blue', 'yellow', 'gray']), 'yellow');
    assert.equal(pickWorstInventoryHealth(['green', 'red', 'yellow']), 'red');
    assert.equal(pickWorstInventoryHealth(['gray']), 'gray');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-light.test.ts`  
Expected: FAIL（`pickWorstInventoryHealth` 未导出）

- [ ] **Step 3: Implement**

在 `inventory-light.ts` 增加并导出：

```ts
export const HEALTH_PRIORITY: Record<InventoryHealth, number> = {
  red: 5,
  yellow: 4,
  green: 3,
  blue: 2,
  gray: 1,
};

export function pickWorstInventoryHealth(
  statuses: readonly InventoryHealth[],
): InventoryHealth | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, cur) =>
    HEALTH_PRIORITY[cur] > HEALTH_PRIORITY[worst] ? cur : worst,
  );
}
```

可选：让 `network-replenishment.ts` 改为从 `inventory-light.js` 导入 `HEALTH_PRIORITY` / 复用 `pickWorstInventoryHealth`，避免两套优先级（本期允许复制常量，但优先 DRY）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-light.test.ts`  
Expected: `fail 0`

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/web/server/lib/inventory-light.ts apps/web/server/lib/inventory-light.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): add pickWorstInventoryHealth for SKU-level lights

EOF
)"
```

---

### Task 2: SKU 健康聚合 + query 解析

**Files:**
- Create: `apps/web/server/lib/sku-health-aggregate.ts`
- Create: `apps/web/server/lib/sku-health-aggregate.test.ts`

**Interfaces:**
- Consumes: `pickWorstInventoryHealth`, `normalizeInventoryHealth`, `InventoryHealth`
- Produces: `parseHealthStatusesParam(raw: string | undefined): InventoryHealth[]`
- Produces: `async loadWorstHealthBySkuIds(skuIds: string[]): Promise<Map<string, InventoryHealth>>`
- Produces: `filterItemsByHealthStatuses<T extends { healthStatus?: InventoryHealth | null }>(items: T[], statuses: InventoryHealth[]): T[]`

- [ ] **Step 1: Write failing tests for parse + filter**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHealthStatusesParam,
  filterItemsByHealthStatuses,
} from './sku-health-aggregate.js';

describe('parseHealthStatusesParam', () => {
  it('parses csv and drops invalid', () => {
    assert.deepEqual(parseHealthStatusesParam('red,yellow,nope'), ['red', 'yellow']);
    assert.deepEqual(parseHealthStatusesParam(''), []);
    assert.deepEqual(parseHealthStatusesParam(undefined), []);
  });

  it('dedupes', () => {
    assert.deepEqual(parseHealthStatusesParam('red,red,green'), ['red', 'green']);
  });
});

describe('filterItemsByHealthStatuses', () => {
  const items = [
    { id: '1', healthStatus: 'red' as const },
    { id: '2', healthStatus: 'green' as const },
    { id: '3', healthStatus: null },
  ];

  it('returns all when filter empty', () => {
    assert.equal(filterItemsByHealthStatuses(items, []).length, 3);
  });

  it('keeps matching only; null never matches', () => {
    assert.deepEqual(
      filterItemsByHealthStatuses(items, ['red']).map((i) => i.id),
      ['1'],
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

`pnpm --filter @scm/web exec tsx --test server/lib/sku-health-aggregate.test.ts`

- [ ] **Step 3: Implement `sku-health-aggregate.ts`**

```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@scm/db';
import { inventoryHealthSnapshots } from '@scm/db/schema'; // 按仓库实际 schema 导出路径调整
import {
  normalizeInventoryHealth,
  pickWorstInventoryHealth,
  type InventoryHealth,
} from './inventory-light.js';

const ALLOWED = new Set<InventoryHealth>(['red', 'yellow', 'green', 'blue', 'gray']);

export function parseHealthStatusesParam(raw: string | undefined): InventoryHealth[] {
  if (!raw?.trim()) return [];
  const out: InventoryHealth[] = [];
  const seen = new Set<InventoryHealth>();
  for (const part of raw.split(',')) {
    const n = normalizeInventoryHealth(part);
    if (!n || !ALLOWED.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function filterItemsByHealthStatuses<T extends { healthStatus?: InventoryHealth | null }>(
  items: T[],
  statuses: InventoryHealth[],
): T[] {
  if (statuses.length === 0) return items;
  const set = new Set(statuses);
  return items.filter((i) => i.healthStatus != null && set.has(i.healthStatus));
}

/** 各仓最新一条 → SKU 最差灯 */
export async function loadWorstHealthBySkuIds(
  skuIds: string[],
): Promise<Map<string, InventoryHealth>> {
  const result = new Map<string, InventoryHealth>();
  if (skuIds.length === 0) return result;

  // DISTINCT ON (sku_id, warehouse_code) … ORDER BY computed_at DESC, id DESC
  // 再用 Map<skuId, InventoryHealth[]> + pickWorstInventoryHealth
  // 实现时对照 planning-dashboard.ts latest_health CTE；优先 db.execute(sql`...`) 或 drizzle 等价写法
  // …
  return result;
}
```

实现 `loadWorstHealthBySkuIds` 时：先查最新仓行，内存按 sku 聚合。表名/列名以 `packages/db/src/schema` 中 `inventoryHealthSnapshots` 为准。

- [ ] **Step 4: Run — expect PASS**

`pnpm --filter @scm/web exec tsx --test server/lib/sku-health-aggregate.test.ts`

- [ ] **Step 5: Commit**（用户授权后）

---

### Task 3: overview API 挂健康灯并筛选

**Files:**
- Modify: `apps/web/server/lib/inventory-overview-service.ts`
- Modify: `apps/web/server/routes/inventory.ts`（`parseOverviewFilters`）
- Modify: `apps/web/src/lib/api.ts`（`InventoryOverview`、`getInventoryOverview`）

**Interfaces:**
- Consumes: `parseHealthStatusesParam`, `loadWorstHealthBySkuIds`, `filterItemsByHealthStatuses`
- Query: `healthStatuses?: InventoryHealth[]` on `InventoryOverviewQuery`
- Item field: `healthStatus: InventoryHealth | null`

- [ ] **Step 1: 扩展类型与路由解析**

`parseOverviewFilters` 增加：

```ts
healthStatuses: parseHealthStatusesParam(c.req.query('healthStatuses')),
```

`InventoryOverviewQuery` 增加 `healthStatuses?: InventoryHealth[]`。

`api.getInventoryOverview`：

```ts
if (params?.healthStatuses?.length) {
  qs.set('healthStatuses', params.healthStatuses.join(','));
}
```

`InventoryOverview` 增加 `healthStatus?: InventoryHealth | null`。

- [ ] **Step 2: 当前态路径（无归档快照）**

在 `buildInventoryOverviewRows` 当前态分支：

1. 若 `query.healthStatuses?.length`：不能先按 SKU 页再筛（会错页）。做法二选一（优先 A）：
   - **A（推荐）**：用 SQL/CTE 先得到「有最差灯且命中 statuses」的 `sku_id` 集合，再与现有 `fetchSkuRows` / `countInventoryOverviewRows` 的 where 叠加 `s.id IN (...)`；返回前再 `loadWorstHealthBySkuIds` 填 `healthStatus`。
   - **B**：拉满足其它过滤的全部 skuId → 聚合灯 → 内存筛 → 再 slice 分页（数据量大时慎用；仅当 A 工期不够）。

2. 若无 `healthStatuses`：保持现分页；对当前页 `skuIds` 调用 `loadWorstHealthBySkuIds`，写入 `healthStatus`（缺省 `null`）。

- [ ] **Step 3: 归档快照路径**

`filterSnapshotItems` 之后、`slice` 之前：

1. 对 `filtered` 全部 `skuId` 调 `loadWorstHealthBySkuIds`（或仅当需要展示/筛选时）
2. 写入 `healthStatus`
3. `filterItemsByHealthStatuses(..., query.healthStatuses ?? [])`
4. 再 `slice` 分页；`total` 用筛后长度

- [ ] **Step 4: 手动冒烟**（有本地 API 时）

```http
GET /api/inventory/overview?view=replenish&page=1&pageSize=20
GET /api/inventory/overview?view=replenish&healthStatuses=red,yellow
```

Expected: items 含 `healthStatus`；第二请求仅红/黄。

- [ ] **Step 5: Commit**（用户授权后）

---

### Task 4: 入口页健康灯 + 多选芯片

**Files:**
- Modify: `apps/web/src/pages/SkuPlanningEntryPage.tsx`
- Modify: `apps/web/src/components/InventoryHealthBadge.tsx`（title 对齐业务文案）

**Interfaces:**
- Consumes: `api.getInventoryOverview({ healthStatuses, ... })`
- Consumes: `InventoryHealthBadge`

- [ ] **Step 1: 更新 badge 文案（可选但推荐）**

```ts
blue: { label: '蓝灯', title: '库存超备：覆盖超过超备阈值' },
green: { label: '绿灯', title: '健康：覆盖处于安全区间' },
yellow: { label: '黄灯', title: '风险：进入补货计划窗口' },
red: { label: '红灯', title: '高风险：覆盖低于总交期，必须补货' },
gray: { label: '灰灯', title: '暂停补货：滞销或即将停售' },
```

未评估：调用方传 `null` 时 badge 已显示 `-`；入口改为：

```tsx
{item.healthStatus ? (
  <InventoryHealthBadge health={item.healthStatus} />
) : (
  <span className="text-text-hint">未评估</span>
)}
```

- [ ] **Step 2: 改入口页**

- `useState<InventoryHealth[]>([])` 存选中芯片
- 芯片列表：`[{v:'blue',l:'蓝（超备）'}, {v:'green',l:'绿（健康）'}, {v:'yellow',l:'黄（风险）'}, {v:'red',l:'红（高风险）'}, {v:'gray',l:'灰（暂停）'}]`
- 点击切换选中；变更时 `setPage(1)`
- `queryKey` / `getInventoryOverview` 传入 `healthStatuses: selected.length ? selected : undefined`
- 列头 `补货灯` → `健康灯`
- 去掉 `ReplenishLightBadge` / `?? 'red'`

芯片样式：选中用 `border-primary bg-primary/10`，未选中 `border-border`；与现有 Button/ProductScope 间距一致。

- [ ] **Step 3: 浏览器冒烟**

打开 `/inventory/planning`：列为人读健康灯；勾选红+黄后列表与分页变化；清空芯片恢复全部。

- [ ] **Step 4: Commit**（用户授权后）

---

## Phase 2 — 整 SKU 供应舱

### Task 5: 分仓摘要附健康灯

**Files:**
- Modify: `apps/web/server/lib/inventory-planning-service.ts`
- Modify: `apps/web/server/lib/inventory-planning-service.test.ts`
- Modify: `apps/web/src/lib/api.ts`（`NetworkWarehouseSummary` / `SkuPlanningView.warehouses`）

**Interfaces:**
- Consumes: `loadWorstHealthBySkuIds` 不够（要按仓）；新增或内联 `loadLatestHealthBySkuWarehouse(skuId): Promise<Map<string, InventoryHealth>>`
- Produces: `NetworkWarehouseSummary.healthStatus?: InventoryHealth | null`

- [ ] **Step 1: 加载单 SKU 各仓最新灯**

在 `sku-health-aggregate.ts` 增加：

```ts
export async function loadLatestHealthByWarehouseForSku(
  skuId: string,
): Promise<Map<string, InventoryHealth>>
```

DISTINCT ON `(warehouse_code)` 最新行 → Map。

- [ ] **Step 2: 写入 `summarizeNetworkWarehouses` 或网络 view 组装处**

在 `buildSkuNetworkPlanning`（或等价函数）得到 `warehouses` 后：

```ts
const byWh = await loadLatestHealthByWarehouseForSku(skuId);
warehouses = warehouses.map((w) => ({
  ...w,
  healthStatus: byWh.get(w.warehouseCode) ?? null,
}));
```

- [ ] **Step 3: 单测**

若现有 test mock 网络 view，断言 `warehouses[0].healthStatus` 被带出；无 DB 时测 map merge 纯函数即可。

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-planning-service.test.ts`

- [ ] **Step 4: Commit**（用户授权后）

---

### Task 6: 规划详情 — 决策条 + 分仓灯列

**Files:**
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`

- [ ] **Step 1: 确认默认网络**

`resolvePlanningScope` / 前端 `scopeParam`：无 warehouse 时已是 network。打开 `/inventory/planning/:skuId` 无 query 应显示「网络供应」。若默认落到某物理仓，改为默认 `scope=network`。

- [ ] **Step 2: 决策条收敛**

顶部 Card 明确为决策条，顺序：ScopeToggle → HealthBadge → 有效供给/覆盖/建议量/断货日（可用小 Metric 或 inline text）→ 需求口径。不必新建路由。

- [ ] **Step 3: 分仓表加健康灯列**

```tsx
<th>健康灯</th>
…
<td><InventoryHealthBadge health={row.healthStatus} /></td>
```

- [ ] **Step 4: 浏览器冒烟网络视图分仓灯**

---

### Task 7: 供应链路三块只读列表

**Files:**
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- 视需要：确认 `api.getInventoryPools` / `getPurchaseTracking` / `getShipments` 的 `q` 行为

- [ ] **Step 1: 并行查询**

在详情页（有 `item.skuCode` 后）：

```ts
const pools = useQuery({
  queryKey: ['sku-cockpit-pools', item.skuCode],
  queryFn: () => api.getInventoryPools({ q: item.skuCode, page: 1, pageSize: 20 }),
  enabled: Boolean(item.skuCode),
});
const purchases = useQuery({
  queryKey: ['sku-cockpit-purchases', item.skuCode],
  queryFn: () => api.getPurchaseTracking({ q: item.skuCode, page: 1, pageSize: 20 }),
  enabled: Boolean(item.skuCode),
});
const shipments = useQuery({
  queryKey: ['sku-cockpit-shipments', item.skuCode],
  queryFn: () => api.getShipments({ q: item.skuCode, page: 1, pageSize: 20 }),
  enabled: Boolean(item.skuCode),
});
```

核对 `api` 方法名与参数以 `apps/web/src/lib/api.ts` 为准（pools 可能是 `getInventoryPoolLots` 等）。

- [ ] **Step 2: UI 三块 Card**

放在「分仓一览」与「时间轴」之间（或分仓之后、交期之前，按 spec 第 4 块）：

1. 开放批次：池 / 仓 / 数量 / 可用日；链到 `/inventory/pools?q=`
2. 未结跟单：单号 / 数量 / ETA；链到采购跟单页
3. 发运：单号 / 状态 / ETA；链到发运页

空态：`暂无开放批次` 等。加载中短文案。

- [ ] **Step 3: 串 SKU 检查**

若 `q` 模糊匹配到其它编码，优先改为精确过滤（扩展 API `skuId=` 或前端再 filter `skuCode === item.skuCode`）。**本期最低要求：前端二次精确过滤 `skuCode`。**

- [ ] **Step 4: 冒烟**

有供应数据的 SKU：三块有行；无数据 SKU：空态不报错。

- [ ] **Step 5: Commit**（用户授权后）

---

### Task 8: 文档对齐 + 总验收

**Files:**
- Modify: `docs/business/scm-demand-supply-inventory-logic.md`（库存健康灯入口说明一小段，可选）
- Spec 验收清单勾选

- [ ] **Step 1: 一期验收**

- [ ] 入口列健康灯，非整表策略红
- [ ] 红 / 红+黄筛选与分页正确
- [ ] 未评估不进五色筛选
- [ ] productScope 可叠加

- [ ] **Step 2: 二期验收**

- [ ] 默认网络供应；决策条有灯与建议
- [ ] 分仓行有健康灯
- [ ] 批次/跟单/发运可见或空态
- [ ] 无写分配入口

- [ ] **Step 3: 跑相关单测**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/inventory-light.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/sku-health-aggregate.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-planning-service.test.ts
```

Expected: `fail 0`

---

## Spec coverage self-check

| Spec 要求 | Task |
|-----------|------|
| 入口健康灯替换补货灯列 | 4 |
| 最差仓红>黄>绿>蓝>灰 | 1 |
| 灰单独档 + 筛选芯片 | 2, 4 |
| 多选芯片、服务端分页 | 3, 4 |
| 未评估 / null | 3, 4 |
| overview `healthStatuses` | 3 |
| 详情默认网络 + 五块舱 | 6, 7 |
| 分仓健康灯 | 5, 6 |
| 批次/跟单/发运只读 | 7 |
| 不改策略灯/公式/写分配 | Global |

**Placeholder scan:** 无 TBD；`loadWorstHealthBySkuIds` 需实现者对照 schema 写 SQL（已指向 `planning-dashboard` CTE）。  
**Type consistency:** `InventoryHealth`、`healthStatuses`、`healthStatus` 命名全计划一致。
