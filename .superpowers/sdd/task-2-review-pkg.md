# Review Package Task 2
BASE: 61aad74d07a52169cb6fbf8d84273762b1129888
HEAD: fd222982e0ae7e7324972e2a7dbe19075ae88a78

## Commits
fd22298 feat: add inventory position merge helpers for P0


## Stat
 apps/web/server/lib/inventory-position.test.ts |  82 +++++++++++++++++++
 apps/web/server/lib/inventory-position.ts      | 108 +++++++++++++++++++++++++
 2 files changed, 190 insertions(+)


## Diff
diff --git a/apps/web/server/lib/inventory-position.test.ts b/apps/web/server/lib/inventory-position.test.ts
new file mode 100644
index 0000000..6bde641
--- /dev/null
+++ b/apps/web/server/lib/inventory-position.test.ts
@@ -0,0 +1,82 @@
+import assert from 'node:assert/strict';
+import { describe, it } from 'node:test';
+import {
+  mapDraftStatusToBucket,
+  mergeInventoryPosition,
+  openDraftQty,
+} from './inventory-position.js';
+
+describe('inventory-position pure', () => {
+  it('maps draft statuses to buckets', () => {
+    assert.equal(mapDraftStatusToBucket('draft'), 'confirmedOpen');
+    assert.equal(mapDraftStatusToBucket('confirmed'), 'confirmedOpen');
+    assert.equal(mapDraftStatusToBucket('in_production'), 'inProduction');
+    assert.equal(mapDraftStatusToBucket('ready_to_ship'), 'inProduction');
+    assert.equal(mapDraftStatusToBucket('in_transit'), 'inTransit');
+    assert.equal(mapDraftStatusToBucket('partial_received'), 'inTransit');
+    assert.equal(mapDraftStatusToBucket('exception'), 'confirmedOpen');
+    assert.equal(mapDraftStatusToBucket('received'), null);
+    assert.equal(mapDraftStatusToBucket('cancelled'), null);
+  });
+
+  it('computes open qty', () => {
+    assert.equal(openDraftQty(100, 30), 70);
+    assert.equal(openDraftQty(10, 15), 0);
+  });
+
+  it('drafts_fill_gap only fills zero snapshot buckets', () => {
+    const result = mergeInventoryPosition({
+      dedupeMode: 'drafts_fill_gap',
+      snapshot: {
+        qtyAvailable: 2400,
+        qtyInTransit: 1000,
+        qtyInProduction: 0,
+        qtyReserved: 100,
+      },
+      draftBuckets: {
+        inProduction: 500,
+        inTransit: 2000,
+        confirmedOpen: 300,
+      },
+    });
+    assert.equal(result.qtyAvailable, 2400);
+    assert.equal(result.qtyInTransit, 1000); // snapshot wins
+    assert.equal(result.qtyInProduction, 500); // fill gap
+    assert.equal(result.qtyConfirmedOpen, 300);
+    assert.equal(result.qtyReserved, 100);
+    assert.equal(result.effectiveQty, 2400 + 1000 + 500 + 300 - 100);
+    assert.equal(result.dedupeMode, 'drafts_fill_gap');
+  });
+
+  it('snapshot_only ignores drafts', () => {
+    const result = mergeInventoryPosition({
+      dedupeMode: 'snapshot_only',
+      snapshot: {
+        qtyAvailable: 100,
+        qtyInTransit: 0,
+        qtyInProduction: 0,
+        qtyReserved: 0,
+      },
+      draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
+    });
+    assert.equal(result.effectiveQty, 100);
+    assert.equal(result.qtyConfirmedOpen, 0);
+  });
+
+  it('sum_both adds drafts on top of snapshot', () => {
+    const result = mergeInventoryPosition({
+      dedupeMode: 'sum_both',
+      snapshot: {
+        qtyAvailable: 100,
+        qtyInTransit: 10,
+        qtyInProduction: 5,
+        qtyReserved: 0,
+      },
+      draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
+    });
+    assert.equal(result.qtyInProduction, 55);
+    assert.equal(result.qtyInTransit, 30);
+    assert.equal(result.qtyConfirmedOpen, 10);
+    assert.equal(result.effectiveQty, 100 + 55 + 30 + 10);
+  });
+});
diff --git a/apps/web/server/lib/inventory-position.ts b/apps/web/server/lib/inventory-position.ts
new file mode 100644
index 0000000..f7b1b19
--- /dev/null
+++ b/apps/web/server/lib/inventory-position.ts
@@ -0,0 +1,108 @@
+export type InventoryDedupeMode = 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';
+
+export type InventoryPositionBucket =
+  | 'available'
+  | 'inProduction'
+  | 'inTransit'
+  | 'confirmedOpen'
+  | 'reserved'
+  | 'backorder';
+
+export type InventoryPositionSource = {
+  source: 'snapshot' | 'purchase_draft';
+  bucket: InventoryPositionBucket;
+  qty: number;
+  draftId?: string;
+  atRisk?: boolean;
+};
+
+export type InventoryPositionBreakdown = {
+  qtyAvailable: number;
+  qtyInProduction: number;
+  qtyInTransit: number;
+  qtyConfirmedOpen: number;
+  qtyReserved: number;
+  qtyBackorder: number;
+  effectiveQty: number;
+  sources: InventoryPositionSource[];
+  dedupeMode: InventoryDedupeMode;
+  unassignedOpenQty: number;
+};
+
+export function openDraftQty(qty: number, receivedQty: number): number {
+  return Math.max(0, (qty ?? 0) - (receivedQty ?? 0));
+}
+
+export function mapDraftStatusToBucket(status: string): InventoryPositionBucket | null {
+  switch (status) {
+    case 'draft':
+    case 'confirmed':
+    case 'exception':
+      return 'confirmedOpen';
+    case 'in_production':
+    case 'ready_to_ship':
+      return 'inProduction';
+    case 'in_transit':
+    case 'partial_received':
+      return 'inTransit';
+    default:
+      return null;
+  }
+}
+
+export function mergeInventoryPosition(input: {
+  dedupeMode?: InventoryDedupeMode;
+  snapshot: {
+    qtyAvailable: number;
+    qtyInTransit: number;
+    qtyInProduction: number;
+    qtyReserved: number;
+  };
+  draftBuckets: {
+    inProduction: number;
+    inTransit: number;
+    confirmedOpen: number;
+  };
+  sources?: InventoryPositionSource[];
+  unassignedOpenQty?: number;
+}): InventoryPositionBreakdown {
+  const dedupeMode = input.dedupeMode ?? 'drafts_fill_gap';
+  const s = input.snapshot;
+  const d = input.draftBuckets;
+
+  let qtyInProduction = s.qtyInProduction;
+  let qtyInTransit = s.qtyInTransit;
+  let qtyConfirmedOpen = 0;
+
+  if (dedupeMode === 'snapshot_only') {
+    // drafts ignored for bucket totals
+  } else if (dedupeMode === 'sum_both') {
+    qtyInProduction += d.inProduction;
+    qtyInTransit += d.inTransit;
+    qtyConfirmedOpen = d.confirmedOpen;
+  } else {
+    // drafts_fill_gap
+    if (qtyInProduction <= 0) qtyInProduction = d.inProduction;
+    if (qtyInTransit <= 0) qtyInTransit = d.inTransit;
+    qtyConfirmedOpen = d.confirmedOpen;
+  }
+
+  const qtyAvailable = s.qtyAvailable;
+  const qtyReserved = s.qtyReserved;
+  const qtyBackorder = 0;
+  const effectiveQty =
+    qtyAvailable + qtyInProduction + qtyInTransit + qtyConfirmedOpen - qtyReserved - qtyBackorder;
+
+  return {
+    qtyAvailable,
+    qtyInProduction,
+    qtyInTransit,
+    qtyConfirmedOpen,
+    qtyReserved,
+    qtyBackorder,
+    effectiveQty,
+    sources: input.sources ?? [],
+    dedupeMode,
+    unassignedOpenQty: input.unassignedOpenQty ?? 0,
+  };
+}

