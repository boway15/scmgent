# 库存规划边界锁定 + P0（库存位置 & 预计可售日）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 锁定双引擎产品边界，并实现统一 `resolveInventoryPosition`（健康/补货同源）与跟单 `eta_available`（预计可售日）语义，使建议 metrics 可解释位置构成。

**Architecture:** 纯函数完成跟单状态→桶映射与 `drafts_fill_gap` 合并；DB 服务聚合 `inventory_records` + 跟单开放量；`inventory-health-service` / 补货任务改为消费 position 的 `effectiveQty`。跟单表新增 `eta_available`，API/UI 以可售日为主并同步旧字段。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、Node `tsx --test`

**Spec:** `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` §1.2、§4、§8、§16.1

## Global Constraints

- 默认去重模式：`drafts_fill_gap`（快照权威，跟单只补快照为 0 的桶）。
- 物理仓 position **不得**把 SKU 级 `IN-PRODUCTION` 全量计入每一个目的仓。
- `exception` 开放量计入 `confirmedOpen`，sources 打标 `atRisk: true`。
- 跟单仓：`plan_item.warehouse_code` → 否则 `plan.target_warehouse_code`；皆空不进物理仓 position。
- `eta_available` 为主字段；写入时同步 `confirmed_delivery_date`。
- P0 **不做**：lead_time_profiles、SKU 规划页、shipments、断货修正、Z 值、驾驶舱、SAP、正式 PO、BOM、FOB 改动。
- 扩展现表/服务，禁止平行 `inventory_balance` / `purchase_order` 主路径。
- 中文 UI 文案；标识符英文 snake_case / camelCase 依现网。

---

## File map

| 文件 | 职责 |
|------|------|
| `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` | 边界与 P0 决策（已写 §16.1；本 plan Task 1 核对） |
| `apps/web/server/lib/inventory-position.ts` | 纯合并 + `resolveInventoryPosition` |
| `apps/web/server/lib/inventory-position.test.ts` | 单测 |
| `apps/web/server/lib/inventory-health-service.ts` | 改用 position.effectiveQty + metrics |
| `apps/web/server/tasks/replenishmentForecast.ts` | 仓级/区域池改用 position |
| `apps/web/server/lib/inventory-snapshot.ts` | 区域池委托 position（避免双口径） |
| `packages/db/src/schema/procurement.ts` | `etaAvailable` 列 |
| `packages/db/drizzle/0052_purchase_draft_eta_available.sql` | 迁移 |
| `packages/db/drizzle/meta/_journal.json` | journal |
| `apps/web/server/routes/procurement.ts` | PATCH/GET 暴露 eta |
| `apps/web/src/lib/api.ts` | 类型 |
| `apps/web/src/pages/PurchaseTrackingPage.tsx` | 可售日编辑与展示 |

---

### Task 1: 边界文档核对（无代码行为变更）

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md`（确认 §1.2、§14、§16.1 与本 plan Global Constraints 一致）
- Optional note in: `docs/prd/mvp-overview.md`（仅当需要一句「规划/PMC 演进见 2026-07-29 spec」；不要改「明确不做」列表）

**Interfaces:**
- Produces: 文档层锁定的双引擎边界与 P0 非目标（无运行时 API）

- [ ] **Step 1: 通读设计 §1.2 / §16.1 / §14**

确认以下句子存在且无矛盾：

- 库存规划引擎 vs 供应商 PMC 引擎职责表
- P0 默认 `drafts_fill_gap`
- P0 不做 lead_time_profiles / shipments / 规划页

若 §16.1 缺失，按 Global Constraints 补全（与当前仓库已写内容对齐即可）。

- [ ] **Step 2:（可选）在 mvp-overview「后续 Phase」加一行引用**

```markdown
15. 库存规划与 PMC 演进（见 docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md）
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md docs/prd/mvp-overview.md
git commit -m "$(cat <<'EOF'
docs: lock inventory planning / PMC boundary for P0

EOF
)"
```

---

### Task 2: 库存位置纯函数（桶映射 + fill_gap）

**Files:**
- Create: `apps/web/server/lib/inventory-position.ts`
- Create: `apps/web/server/lib/inventory-position.test.ts`

**Interfaces:**
- Produces:

```ts
export type InventoryDedupeMode = 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';

export type InventoryPositionBucket =
  | 'available'
  | 'inProduction'
  | 'inTransit'
  | 'confirmedOpen'
  | 'reserved'
  | 'backorder';

export type InventoryPositionSource = {
  source: 'snapshot' | 'purchase_draft';
  bucket: InventoryPositionBucket;
  qty: number;
  draftId?: string;
  atRisk?: boolean;
};

export type InventoryPositionBreakdown = {
  qtyAvailable: number;
  qtyInProduction: number;
  qtyInTransit: number;
  qtyConfirmedOpen: number;
  qtyReserved: number;
  qtyBackorder: number;
  effectiveQty: number;
  sources: InventoryPositionSource[];
  dedupeMode: InventoryDedupeMode;
  unassignedOpenQty: number;
};

export function mapDraftStatusToBucket(
  status: string,
): InventoryPositionBucket | null;

export function openDraftQty(qty: number, receivedQty: number): number;

export function mergeInventoryPosition(input: {
  dedupeMode?: InventoryDedupeMode;
  snapshot: {
    qtyAvailable: number;
    qtyInTransit: number;
    qtyInProduction: number;
    qtyReserved: number;
  };
  draftBuckets: {
    inProduction: number;
    inTransit: number;
    confirmedOpen: number;
  };
  sources?: InventoryPositionSource[];
  unassignedOpenQty?: number;
}): InventoryPositionBreakdown;
```

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapDraftStatusToBucket,
  mergeInventoryPosition,
  openDraftQty,
} from './inventory-position.js';

describe('inventory-position pure', () => {
  it('maps draft statuses to buckets', () => {
    assert.equal(mapDraftStatusToBucket('draft'), 'confirmedOpen');
    assert.equal(mapDraftStatusToBucket('confirmed'), 'confirmedOpen');
    assert.equal(mapDraftStatusToBucket('in_production'), 'inProduction');
    assert.equal(mapDraftStatusToBucket('ready_to_ship'), 'inProduction');
    assert.equal(mapDraftStatusToBucket('in_transit'), 'inTransit');
    assert.equal(mapDraftStatusToBucket('partial_received'), 'inTransit');
    assert.equal(mapDraftStatusToBucket('exception'), 'confirmedOpen');
    assert.equal(mapDraftStatusToBucket('received'), null);
    assert.equal(mapDraftStatusToBucket('cancelled'), null);
  });

  it('computes open qty', () => {
    assert.equal(openDraftQty(100, 30), 70);
    assert.equal(openDraftQty(10, 15), 0);
  });

  it('drafts_fill_gap only fills zero snapshot buckets', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'drafts_fill_gap',
      snapshot: {
        qtyAvailable: 2400,
        qtyInTransit: 1000,
        qtyInProduction: 0,
        qtyReserved: 100,
      },
      draftBuckets: {
        inProduction: 500,
        inTransit: 2000,
        confirmedOpen: 300,
      },
    });
    assert.equal(result.qtyAvailable, 2400);
    assert.equal(result.qtyInTransit, 1000); // snapshot wins
    assert.equal(result.qtyInProduction, 500); // fill gap
    assert.equal(result.qtyConfirmedOpen, 300);
    assert.equal(result.qtyReserved, 100);
    assert.equal(result.effectiveQty, 2400 + 1000 + 500 + 300 - 100);
    assert.equal(result.dedupeMode, 'drafts_fill_gap');
  });

  it('snapshot_only ignores drafts', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'snapshot_only',
      snapshot: {
        qtyAvailable: 100,
        qtyInTransit: 0,
        qtyInProduction: 0,
        qtyReserved: 0,
      },
      draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
    });
    assert.equal(result.effectiveQty, 100);
    assert.equal(result.qtyConfirmedOpen, 0);
  });

  it('sum_both adds drafts on top of snapshot', () => {
    const result = mergeInventoryPosition({
      dedupeMode: 'sum_both',
      snapshot: {
        qtyAvailable: 100,
        qtyInTransit: 10,
        qtyInProduction: 5,
        qtyReserved: 0,
      },
      draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
    });
    assert.equal(result.qtyInProduction, 55);
    assert.equal(result.qtyInTransit, 30);
    assert.equal(result.qtyConfirmedOpen, 10);
    assert.equal(result.effectiveQty, 100 + 55 + 30 + 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement pure functions in `inventory-position.ts`**

```ts
export type InventoryDedupeMode = 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';
// ... types as in Interfaces ...

export function openDraftQty(qty: number, receivedQty: number): number {
  return Math.max(0, (qty ?? 0) - (receivedQty ?? 0));
}

export function mapDraftStatusToBucket(status: string): InventoryPositionBucket | null {
  switch (status) {
    case 'draft':
    case 'confirmed':
    case 'exception':
      return 'confirmedOpen';
    case 'in_production':
    case 'ready_to_ship':
      return 'inProduction';
    case 'in_transit':
    case 'partial_received':
      return 'inTransit';
    default:
      return null;
  }
}

export function mergeInventoryPosition(input: {
  dedupeMode?: InventoryDedupeMode;
  snapshot: {
    qtyAvailable: number;
    qtyInTransit: number;
    qtyInProduction: number;
    qtyReserved: number;
  };
  draftBuckets: {
    inProduction: number;
    inTransit: number;
    confirmedOpen: number;
  };
  sources?: InventoryPositionSource[];
  unassignedOpenQty?: number;
}): InventoryPositionBreakdown {
  const dedupeMode = input.dedupeMode ?? 'drafts_fill_gap';
  const s = input.snapshot;
  const d = input.draftBuckets;

  let qtyInProduction = s.qtyInProduction;
  let qtyInTransit = s.qtyInTransit;
  let qtyConfirmedOpen = 0;

  if (dedupeMode === 'snapshot_only') {
    // drafts ignored for bucket totals
  } else if (dedupeMode === 'sum_both') {
    qtyInProduction += d.inProduction;
    qtyInTransit += d.inTransit;
    qtyConfirmedOpen = d.confirmedOpen;
  } else {
    // drafts_fill_gap
    if (qtyInProduction <= 0) qtyInProduction = d.inProduction;
    if (qtyInTransit <= 0) qtyInTransit = d.inTransit;
    qtyConfirmedOpen = d.confirmedOpen;
  }

  const qtyAvailable = s.qtyAvailable;
  const qtyReserved = s.qtyReserved;
  const qtyBackorder = 0;
  const effectiveQty =
    qtyAvailable + qtyInProduction + qtyInTransit + qtyConfirmedOpen - qtyReserved - qtyBackorder;

  return {
    qtyAvailable,
    qtyInProduction,
    qtyInTransit,
    qtyConfirmedOpen,
    qtyReserved,
    qtyBackorder,
    effectiveQty,
    sources: input.sources ?? [],
    dedupeMode,
    unassignedOpenQty: input.unassignedOpenQty ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-position.ts apps/web/server/lib/inventory-position.test.ts
git commit -m "$(cat <<'EOF'
feat: add inventory position merge helpers for P0

EOF
)"
```

---

### Task 3: `resolveInventoryPosition`（读库）

**Files:**
- Modify: `apps/web/server/lib/inventory-position.ts`
- Modify: `apps/web/server/lib/inventory-position.test.ts`（可继续纯函数；DB 路径用可注入 loader 做单测，避免强依赖真实 PG）

**Interfaces:**
- Consumes: `mapDraftStatusToBucket`, `openDraftQty`, `mergeInventoryPosition`
- Consumes: `inventoryRecords`, `purchaseDrafts`, `pmcPlanItems`, `pmcPlans`（或注入）
- Produces:

```ts
export type DraftOpenLine = {
  draftId: string;
  status: string;
  openQty: number;
  warehouseCode: string | null;
  atRisk?: boolean;
};

export function aggregateDraftBucketsForWarehouse(
  lines: DraftOpenLine[],
  warehouseCode: string,
): {
  draftBuckets: { inProduction: number; inTransit: number; confirmedOpen: number };
  sources: InventoryPositionSource[];
  unassignedOpenQty: number;
};

export async function resolveInventoryPosition(params: {
  skuId: string;
  warehouseCode: string;
  dedupeMode?: InventoryDedupeMode;
}): Promise<InventoryPositionBreakdown>;
```

- [ ] **Step 1: Write failing tests for aggregate + warehouse filter**

```ts
it('aggregates draft lines for one warehouse and tracks unassigned', () => {
  const { draftBuckets, sources, unassignedOpenQty } = aggregateDraftBucketsForWarehouse(
    [
      { draftId: 'a', status: 'confirmed', openQty: 100, warehouseCode: 'US-WEST' },
      { draftId: 'b', status: 'in_transit', openQty: 50, warehouseCode: 'US-WEST' },
      { draftId: 'c', status: 'in_production', openQty: 20, warehouseCode: null },
      { draftId: 'd', status: 'exception', openQty: 5, warehouseCode: 'US-WEST', atRisk: true },
    ],
    'US-WEST',
  );
  assert.equal(draftBuckets.confirmedOpen, 105);
  assert.equal(draftBuckets.inTransit, 50);
  assert.equal(draftBuckets.inProduction, 0);
  assert.equal(unassignedOpenQty, 20);
  assert.ok(sources.some((s) => s.draftId === 'd' && s.atRisk === true));
});
```

- [ ] **Step 2: Run test — RED**

- [ ] **Step 3: Implement aggregate + resolve**

`aggregateDraftBucketsForWarehouse`：对 `warehouseCode` 匹配的行按 bucket 累加；`warehouseCode == null` 累加到 `unassignedOpenQty`（不进该仓 buckets）。

`resolveInventoryPosition`：

1. 若 `warehouseCode === 'IN-PRODUCTION'`：只读在产仓 snapshot（`getLatestInProductionQty` / records），drafts 不计；`effectiveQty = qtyInProduction`。
2. 否则读该仓最新 `inventory_records`（available / transit / reserved；生产字段通常 0）。
3. 查询该 SKU 开放跟单：`status not in (received, cancelled)`，`openQty = qty - receivedQty > 0`，join `planItem` / `plan` 解析仓。
4. `aggregateDraftBucketsForWarehouse` → `mergeInventoryPosition`。
5. 物理仓 **不要** 把 `IN-PRODUCTION` snapshot 加进结果（区域池在 Task 4 处理）。

查询示意：

```ts
const rows = await db
  .select({
    id: purchaseDrafts.id,
    status: purchaseDrafts.status,
    qty: purchaseDrafts.qty,
    receivedQty: purchaseDrafts.receivedQty,
    itemWh: pmcPlanItems.warehouseCode,
    planWh: pmcPlans.targetWarehouseCode,
  })
  .from(purchaseDrafts)
  .leftJoin(pmcPlanItems, eq(purchaseDrafts.planItemId, pmcPlanItems.id))
  .leftJoin(pmcPlans, eq(pmcPlanItems.planId, pmcPlans.id))
  .where(eq(purchaseDrafts.skuId, params.skuId));
```

- [ ] **Step 4: Run tests — GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-position.ts apps/web/server/lib/inventory-position.test.ts
git commit -m "$(cat <<'EOF'
feat: resolve inventory position from snapshot and purchase drafts

EOF
)"
```

---

### Task 4: 健康计算与补货任务改用 position

**Files:**
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Modify: `apps/web/server/lib/inventory-snapshot.ts`（`getRegionPoolSnapshot` / `sumEffectiveQtyForWarehouses`）
- Modify: `apps/web/server/lib/inventory-health-service.test.ts`（若有相关断言则更新；可新增 position metrics 断言）

**Interfaces:**
- Consumes: `resolveInventoryPosition`
- Produces: `SkuHealthRow.effectiveQty` 来自 position；`metrics.inventoryPosition` 含 breakdown

- [ ] **Step 1: Write / extend failing test**

在 `inventory-health-service.test.ts` 或新建轻量测试：验证 metrics 形状助手（若 compute 难 mock DB，则抽）：

```ts
export function buildInventoryPositionMetrics(pos: InventoryPositionBreakdown) {
  return {
    inventoryPosition: {
      effectiveQty: pos.effectiveQty,
      qtyAvailable: pos.qtyAvailable,
      qtyInProduction: pos.qtyInProduction,
      qtyInTransit: pos.qtyInTransit,
      qtyConfirmedOpen: pos.qtyConfirmedOpen,
      qtyReserved: pos.qtyReserved,
      dedupeMode: pos.dedupeMode,
      unassignedOpenQty: pos.unassignedOpenQty,
      sources: pos.sources,
    },
  };
}
```

单测断言该对象字段齐全。

- [ ] **Step 2: Run — RED**（若函数尚未导出）

- [ ] **Step 3: Wire `computeSkuWarehouseHealth`**

替换：

```ts
const snapshot = await getLatestInventorySnapshot(...);
// effectiveQty: snapshot.effectiveQty
```

为：

```ts
const position = await resolveInventoryPosition({
  skuId: params.sku.id,
  warehouseCode: params.warehouse.code,
});
// coverage / return 使用 position.effectiveQty
// metrics 合并 buildInventoryPositionMetrics(position) 与原 lead/safety 字段
```

`replenishmentForecast.ts` 中仓级 `getLatestInventorySnapshot` 改为 `resolveInventoryPosition`；US 区域池：

```ts
async function resolveRegionPoolEffectiveQty(skuId: string, regionGroup: string): Promise<number> {
  const whRows = await db.select(...).from(warehouses).where(region...);
  let total = 0;
  for (const code of whRows) {
    const pos = await resolveInventoryPosition({ skuId, warehouseCode: code });
    total += pos.effectiveQty;
  }
  // SKU 级在产：仅当各仓 production 之和为 0 时 fill_gap 一次
  const inProd = await getLatestInProductionQty(skuId);
  const productionFromWarehouses = /* sum of qtyInProduction from each pos — track while looping */;
  if (productionFromWarehouses <= 0 && inProd > 0) total += inProd;
  return total;
}
```

把同等逻辑放进 `getRegionPoolSnapshot`，避免任务与快照模块分叉。

- [ ] **Step 4: Run targeted tests**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-health-service.ts apps/web/server/lib/inventory-snapshot.ts apps/web/server/tasks/replenishmentForecast.ts apps/web/server/lib/inventory-position.ts apps/web/server/lib/inventory-health-service.test.ts
git commit -m "$(cat <<'EOF'
feat: drive health and replenishment from inventory position

EOF
)"
```

---

### Task 5: Schema — `eta_available`

**Files:**
- Modify: `packages/db/src/schema/procurement.ts`
- Create: `packages/db/drizzle/0052_purchase_draft_eta_available.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`（追加 idx，tag `0052_purchase_draft_eta_available`；若本地 journal 与磁盘 migration 编号不一致，以**磁盘最大编号 + 1**为准并同步 journal）

**Interfaces:**
- Produces: `purchaseDrafts.etaAvailable: date | null`

- [ ] **Step 1: Add column to schema**

```ts
/** 预计可售日（补货/延误主字段；写入时同步 confirmedDeliveryDate） */
etaAvailable: date('eta_available'),
```

放在 `confirmedDeliveryDate` 旁。

- [ ] **Step 2: SQL migration**

```sql
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "eta_available" date;
UPDATE "purchase_drafts"
SET "eta_available" = "confirmed_delivery_date"
WHERE "eta_available" IS NULL AND "confirmed_delivery_date" IS NOT NULL;
```

- [ ] **Step 3: Journal entry**

按仓库现有 journal 格式追加一条 `0052_purchase_draft_eta_available`。

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/procurement.ts packages/db/drizzle/0052_purchase_draft_eta_available.sql packages/db/drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
feat(db): add purchase_drafts.eta_available for sellable ETA

EOF
)"
```

---

### Task 6: 跟单 API — 读写 `etaAvailable`

**Files:**
- Modify: `apps/web/server/routes/procurement.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create or modify: `apps/web/server/lib/purchase-draft-eta.ts`（可选小函数，便于测）

**Interfaces:**
- Produces: GET 列表含 `etaAvailable`；PATCH 接受 `etaAvailable`，写入时同步 `confirmedDeliveryDate`

- [ ] **Step 1: Failing unit test for sync helper**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEtaPatch } from './purchase-draft-eta.js';

describe('buildEtaPatch', () => {
  it('sets both etaAvailable and confirmedDeliveryDate', () => {
    assert.deepEqual(buildEtaPatch('2026-08-15'), {
      etaAvailable: '2026-08-15',
      confirmedDeliveryDate: '2026-08-15',
    });
  });
});
```

- [ ] **Step 2: Run — RED**

- [ ] **Step 3: Implement helper + route**

```ts
export function buildEtaPatch(etaAvailable: string) {
  return {
    etaAvailable,
    confirmedDeliveryDate: etaAvailable,
  };
}
```

在 `PATCH /purchase-drafts/:id`：

- body 增加 `etaAvailable?: string`
- 若 `body.etaAvailable` 有值 → `Object.assign(patch, buildEtaPatch(body.etaAvailable))`
- 若仅有 `confirmedDeliveryDate`（兼容旧客户端）→ 同时写入 `etaAvailable`
- 确认交期流转（`confirmed`）时：若无 body 日期且存在 `expectedDate`，写入两者

GET 列表 select 增加 `etaAvailable: purchaseDrafts.etaAvailable`，响应字段 `etaAvailable`。

`api.ts`：`getPurchaseTracking` 与 `updatePurchaseTracking` 增加 `etaAvailable`。

- [ ] **Step 4: Run tests — GREEN**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/purchase-draft-eta.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/purchase-draft-eta.ts apps/web/server/lib/purchase-draft-eta.test.ts apps/web/server/routes/procurement.ts apps/web/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat: expose eta_available on purchase draft API

EOF
)"
```

---

### Task 7: 跟单页 UI — 预计可售日

**Files:**
- Modify: `apps/web/src/pages/PurchaseTrackingPage.tsx`

**Interfaces:**
- Consumes: `api.updatePurchaseTracking(..., { etaAvailable })`
- Produces: 列表展示「预计可售日」；确认交期时可录入日期

- [ ] **Step 1: 更新文案与列**

- 页头说明增加：交期字段表示**预计可售日**（到仓上架后可售），不是到港日。
- 表格列：优先显示 `d.etaAvailable ?? d.confirmedDeliveryDate ?? d.expectedDate`
- 「确认交期」动作：用 `Input type="date"`（或现有模式）收集日期，调用：

```ts
api.updatePurchaseTracking(id, {
  status: 'confirmed',
  etaAvailable: dateStr,
});
```

- 已确认行允许单独保存可售日（小按钮「更新可售日」），只 PATCH `etaAvailable`。

- [ ] **Step 2: 手工验收清单**（无自动化 E2E 要求）

1. 打开 `/pmc/tracking`，文案含「预计可售日」
2. 确认交期写入后，列表显示该日；刷新后仍在
3. DB 中 `eta_available` 与 `confirmed_delivery_date` 一致

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PurchaseTrackingPage.tsx
git commit -m "$(cat <<'EOF'
feat: capture sellable ETA on purchase tracking UI

EOF
)"
```

---

### Task 8: P0 验收回归

**Files:** 无新文件（跑测 + 对照 spec）

- [ ] **Step 1: 跑相关单测**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/purchase-draft-eta.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-light.test.ts
```

Expected: all PASS

- [ ] **Step 2: 对照 spec §1.4 / §16.1 验收清单**

| 验收项 | 判定 |
|--------|------|
| 健康与补货使用同一 `resolveInventoryPosition` | 代码无直接用 `snapshot.effectiveQty` 作为仓级主口径 |
| metrics 含 position breakdown | `metrics.inventoryPosition` 存在 |
| 默认 `drafts_fill_gap` | merge 默认值 |
| 物理仓不重复摊全球在产 | resolve 物理仓路径无 `getLatestInProductionQty` 计入 |
| `eta_available` 可读写且同步旧字段 | API + UI |
| 未做 P1+ 范围 | 无 lead_time_profiles / shipments 表 |

- [ ] **Step 3: 若有缺口，修完再提交；无代码则跳过 commit**

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| §1.2 双引擎边界 | Task 1 |
| §4 库存位置定义 / fill_gap / exception | Task 2–3 |
| §4 强制健康/补货同源 | Task 4 |
| §8.2 `eta_available` + 承诺可售语义 | Task 5–7 |
| §16.1 锁定决策 | Task 1 + Global Constraints |
| §14 / P0 非范围 | Global Constraints；Task 8 检查未越界 |
| P1 lead_time / 规划页 / P2 shipments | **不在本 plan** |

## Placeholder scan

无 TBD/「类似 Task N」；迁移号若冲突以磁盘最大 +1 为准（已写明）。

## Type consistency

- `InventoryPositionBreakdown.effectiveQty` 贯穿 Task 2–4
- `etaAvailable` camelCase 贯穿 schema / API / UI；DB 列 `eta_available`

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-29-inventory-planning-boundary-p0.md`.**

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间评审  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

选哪一种？
