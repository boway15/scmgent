# Review Package Task 3 re-review
BASE: fd222982e0ae7e7324972e2a7dbe19075ae88a78
HEAD: 661d882271e0e2bebbfc40c863639090fb71d303

## Commits
661d882 fix: zero physical-warehouse in-production in inventory position
7a290d3 feat: resolve inventory position from snapshot and purchase drafts


## Stat
 .superpowers/sdd/task-3-report.md              |  11 ++
 apps/web/server/lib/inventory-position.test.ts |  43 ++++++
 apps/web/server/lib/inventory-position.ts      | 178 +++++++++++++++++++++++++
 3 files changed, 232 insertions(+)


## Diff
diff --git a/.superpowers/sdd/task-3-report.md b/.superpowers/sdd/task-3-report.md
new file mode 100644
index 0000000..a100d81
--- /dev/null
+++ b/.superpowers/sdd/task-3-report.md
@@ -0,0 +1,11 @@
+# Task 3 Report
+
+- Status: implemented `DraftOpenLine`, warehouse draft aggregation, and real Drizzle-backed `resolveInventoryPosition`.
+- Behavior: legacy `submitted` normalizes to `confirmed`; exceptions are marked `atRisk`; draft warehouse falls back from plan item to plan target; unassigned open quantity is tracked separately.
+- Boundary: `IN-PRODUCTION` reads only its snapshot and skips drafts; physical warehouses never receive the SKU-level production snapshot.
+- Tests: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts` 鈥?6 passed, 0 failed.
+- Lints: no diagnostics in the two modified inventory-position files.
+- Type check: repository server type check still fails on unrelated pre-existing errors; no `inventory-position` errors remain.
+- Important review fix: physical warehouse snapshots now force `qtyInProduction` to `0` before merge; only `IN-PRODUCTION` retains the snapshot production quantity.
+- Focused regression test: a physical warehouse loader snapshot containing `qtyInProduction: 75` normalizes to `0`.
+- Re-run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts` 鈥?7 passed, 0 failed.
diff --git a/apps/web/server/lib/inventory-position.test.ts b/apps/web/server/lib/inventory-position.test.ts
index 6bde641..fcd9416 100644
--- a/apps/web/server/lib/inventory-position.test.ts
+++ b/apps/web/server/lib/inventory-position.test.ts
@@ -1,15 +1,17 @@
 import assert from 'node:assert/strict';
 import { describe, it } from 'node:test';
 import {
+  aggregateDraftBucketsForWarehouse,
   mapDraftStatusToBucket,
   mergeInventoryPosition,
+  normalizeSnapshotForWarehouse,
   openDraftQty,
 } from './inventory-position.js';
 
 describe('inventory-position pure', () => {
   it('maps draft statuses to buckets', () => {
     assert.equal(mapDraftStatusToBucket('draft'), 'confirmedOpen');
     assert.equal(mapDraftStatusToBucket('confirmed'), 'confirmedOpen');
     assert.equal(mapDraftStatusToBucket('in_production'), 'inProduction');
     assert.equal(mapDraftStatusToBucket('ready_to_ship'), 'inProduction');
     assert.equal(mapDraftStatusToBucket('in_transit'), 'inTransit');
@@ -17,20 +19,61 @@ describe('inventory-position pure', () => {
     assert.equal(mapDraftStatusToBucket('exception'), 'confirmedOpen');
     assert.equal(mapDraftStatusToBucket('received'), null);
     assert.equal(mapDraftStatusToBucket('cancelled'), null);
   });
 
   it('computes open qty', () => {
     assert.equal(openDraftQty(100, 30), 70);
     assert.equal(openDraftQty(10, 15), 0);
   });
 
+  it('zeros in-production snapshot quantity for a physical warehouse', () => {
+    const snapshot = normalizeSnapshotForWarehouse(
+      {
+        qtyAvailable: 100,
+        qtyInTransit: 20,
+        qtyInProduction: 75,
+        qtyReserved: 10,
+      },
+      'US-WEST',
+    );
+
+    assert.deepEqual(snapshot, {
+      qtyAvailable: 100,
+      qtyInTransit: 20,
+      qtyInProduction: 0,
+      qtyReserved: 10,
+    });
+  });
+
+  it('aggregates draft lines for one warehouse and tracks unassigned', () => {
+    const { draftBuckets, sources, unassignedOpenQty } = aggregateDraftBucketsForWarehouse(
+      [
+        { draftId: 'a', status: 'submitted', openQty: 100, warehouseCode: 'US-WEST' },
+        { draftId: 'b', status: 'in_transit', openQty: 50, warehouseCode: 'US-WEST' },
+        { draftId: 'c', status: 'in_production', openQty: 20, warehouseCode: null },
+        { draftId: 'd', status: 'exception', openQty: 5, warehouseCode: 'US-WEST' },
+        { draftId: 'e', status: 'confirmed', openQty: 30, warehouseCode: 'US-EAST' },
+      ],
+      'US-WEST',
+    );
+
+    assert.deepEqual(draftBuckets, {
+      confirmedOpen: 105,
+      inTransit: 50,
+      inProduction: 0,
+    });
+    assert.equal(unassignedOpenQty, 20);
+    assert.equal(sources.length, 3);
+    assert.ok(sources.some((source) => source.draftId === 'd' && source.atRisk === true));
+  });
+
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
diff --git a/apps/web/server/lib/inventory-position.ts b/apps/web/server/lib/inventory-position.ts
index f7b1b19..29b285c 100644
--- a/apps/web/server/lib/inventory-position.ts
+++ b/apps/web/server/lib/inventory-position.ts
@@ -1,10 +1,21 @@
+import { and, desc, eq } from 'drizzle-orm';
+import {
+  db,
+  inventoryRecords,
+  pmcPlanItems,
+  pmcPlans,
+  purchaseDrafts,
+} from '@scm/db';
+import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
+import { normalizePurchaseDraftStatus } from './purchase-draft-lifecycle.js';
+
 export type InventoryDedupeMode = 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';
 
 export type InventoryPositionBucket =
   | 'available'
   | 'inProduction'
   | 'inTransit'
   | 'confirmedOpen'
   | 'reserved'
   | 'backorder';
 
@@ -22,20 +33,54 @@ export type InventoryPositionBreakdown = {
   qtyInTransit: number;
   qtyConfirmedOpen: number;
   qtyReserved: number;
   qtyBackorder: number;
   effectiveQty: number;
   sources: InventoryPositionSource[];
   dedupeMode: InventoryDedupeMode;
   unassignedOpenQty: number;
 };
 
+export type DraftOpenLine = {
+  draftId: string;
+  status: string;
+  openQty: number;
+  warehouseCode: string | null;
+  atRisk?: boolean;
+};
+
+type InventoryPositionSnapshot = {
+  qtyAvailable: number;
+  qtyInTransit: number;
+  qtyInProduction: number;
+  qtyReserved: number;
+};
+
+export function normalizeSnapshotForWarehouse(
+  snapshot: InventoryPositionSnapshot,
+  warehouseCode: string,
+): InventoryPositionSnapshot {
+  if (warehouseCode === IN_PRODUCTION_WAREHOUSE) {
+    return {
+      qtyAvailable: 0,
+      qtyInTransit: 0,
+      qtyInProduction: snapshot.qtyInProduction,
+      qtyReserved: 0,
+    };
+  }
+
+  return {
+    ...snapshot,
+    qtyInProduction: 0,
+  };
+}
+
 export function openDraftQty(qty: number, receivedQty: number): number {
   return Math.max(0, (qty ?? 0) - (receivedQty ?? 0));
 }
 
 export function mapDraftStatusToBucket(status: string): InventoryPositionBucket | null {
   switch (status) {
     case 'draft':
     case 'confirmed':
     case 'exception':
       return 'confirmedOpen';
@@ -43,20 +88,64 @@ export function mapDraftStatusToBucket(status: string): InventoryPositionBucket
     case 'ready_to_ship':
       return 'inProduction';
     case 'in_transit':
     case 'partial_received':
       return 'inTransit';
     default:
       return null;
   }
 }
 
+export function aggregateDraftBucketsForWarehouse(
+  lines: DraftOpenLine[],
+  warehouseCode: string,
+): {
+  draftBuckets: { inProduction: number; inTransit: number; confirmedOpen: number };
+  sources: InventoryPositionSource[];
+  unassignedOpenQty: number;
+} {
+  const draftBuckets = { inProduction: 0, inTransit: 0, confirmedOpen: 0 };
+  const sources: InventoryPositionSource[] = [];
+  let unassignedOpenQty = 0;
+
+  for (const line of lines) {
+    if (line.openQty <= 0) continue;
+    const status = normalizePurchaseDraftStatus(line.status);
+    const bucket = mapDraftStatusToBucket(status);
+    if (!bucket) continue;
+
+    if (line.warehouseCode == null) {
+      unassignedOpenQty += line.openQty;
+      continue;
+    }
+    if (line.warehouseCode !== warehouseCode) continue;
+    if (
+      bucket !== 'inProduction' &&
+      bucket !== 'inTransit' &&
+      bucket !== 'confirmedOpen'
+    ) {
+      continue;
+    }
+
+    draftBuckets[bucket] += line.openQty;
+    sources.push({
+      source: 'purchase_draft',
+      bucket,
+      qty: line.openQty,
+      draftId: line.draftId,
+      atRisk: status === 'exception' ? true : line.atRisk,
+    });
+  }
+
+  return { draftBuckets, sources, unassignedOpenQty };
+}
+
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
@@ -99,10 +188,99 @@ export function mergeInventoryPosition(input: {
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
+
+function snapshotSources(snapshot: {
+  qtyAvailable: number;
+  qtyInTransit: number;
+  qtyInProduction: number;
+  qtyReserved: number;
+}): InventoryPositionSource[] {
+  const entries: Array<[InventoryPositionBucket, number]> = [
+    ['available', snapshot.qtyAvailable],
+    ['inTransit', snapshot.qtyInTransit],
+    ['inProduction', snapshot.qtyInProduction],
+    ['reserved', snapshot.qtyReserved],
+  ];
+  return entries
+    .filter(([, qty]) => qty !== 0)
+    .map(([bucket, qty]) => ({ source: 'snapshot', bucket, qty }));
+}
+
+export async function resolveInventoryPosition(params: {
+  skuId: string;
+  warehouseCode: string;
+  dedupeMode?: InventoryDedupeMode;
+}): Promise<InventoryPositionBreakdown> {
+  const [record] = await db
+    .select({
+      qtyAvailable: inventoryRecords.qtyAvailable,
+      qtyInTransit: inventoryRecords.qtyInTransit,
+      qtyInProduction: inventoryRecords.qtyInProduction,
+      qtyReserved: inventoryRecords.qtyReserved,
+    })
+    .from(inventoryRecords)
+    .where(
+      and(
+        eq(inventoryRecords.skuId, params.skuId),
+        eq(inventoryRecords.warehouse, params.warehouseCode),
+      ),
+    )
+    .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
+    .limit(1);
+
+  const snapshot = normalizeSnapshotForWarehouse(
+    {
+      qtyAvailable: record?.qtyAvailable ?? 0,
+      qtyInTransit: record?.qtyInTransit ?? 0,
+      qtyInProduction: record?.qtyInProduction ?? 0,
+      qtyReserved: record?.qtyReserved ?? 0,
+    },
+    params.warehouseCode,
+  );
+
+  if (params.warehouseCode === IN_PRODUCTION_WAREHOUSE) {
+    return mergeInventoryPosition({
+      dedupeMode: params.dedupeMode,
+      snapshot,
+      draftBuckets: { inProduction: 0, inTransit: 0, confirmedOpen: 0 },
+      sources: snapshotSources(snapshot),
+    });
+  }
+
+  const draftRows = await db
+    .select({
+      id: purchaseDrafts.id,
+      status: purchaseDrafts.status,
+      qty: purchaseDrafts.qty,
+      receivedQty: purchaseDrafts.receivedQty,
+      itemWarehouseCode: pmcPlanItems.warehouseCode,
+      planWarehouseCode: pmcPlans.targetWarehouseCode,
+    })
+    .from(purchaseDrafts)
+    .leftJoin(pmcPlanItems, eq(purchaseDrafts.planItemId, pmcPlanItems.id))
+    .leftJoin(pmcPlans, eq(pmcPlanItems.planId, pmcPlans.id))
+    .where(eq(purchaseDrafts.skuId, params.skuId));
+
+  const draftLines: DraftOpenLine[] = draftRows.map((row) => ({
+    draftId: row.id,
+    status: row.status,
+    openQty: openDraftQty(row.qty, row.receivedQty),
+    warehouseCode: row.itemWarehouseCode ?? row.planWarehouseCode,
+  }));
+  const aggregated = aggregateDraftBucketsForWarehouse(draftLines, params.warehouseCode);
+
+  return mergeInventoryPosition({
+    dedupeMode: params.dedupeMode,
+    snapshot,
+    draftBuckets: aggregated.draftBuckets,
+    sources: [...snapshotSources(snapshot), ...aggregated.sources],
+    unassignedOpenQty: aggregated.unassignedOpenQty,
+  });
+}

