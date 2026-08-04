# Final Branch Review Package — inventory-planning-boundary-p0
MERGE_BASE: 77bcde51e80f3ac0c2b92ad9091f332437419f42
HEAD: aab76135cde34fa3a2cf793eedc2fdb7db75687a

## Commits
aab7613 feat: capture sellable ETA on purchase tracking UI
62d273e feat: expose eta_available on purchase draft API
5631020 feat(db): add purchase_drafts.eta_available for sellable ETA
b97c26c feat: drive health and replenishment from inventory position
661d882 fix: zero physical-warehouse in-production in inventory position
7a290d3 feat: resolve inventory position from snapshot and purchase drafts
fd22298 feat: add inventory position merge helpers for P0
61aad74 docs: align exception bucket mapping with P0 lock
fd9a829 docs: lock inventory planning / PMC boundary for P0


## Stat
 .superpowers/sdd/task-1-report.md                  | 103 ++++
 .superpowers/sdd/task-3-report.md                  |  11 +
 .../server/lib/inventory-health-service.test.ts    |  45 ++
 apps/web/server/lib/inventory-health-service.ts    |  15 +-
 apps/web/server/lib/inventory-position.test.ts     | 149 ++++++
 apps/web/server/lib/inventory-position.ts          | 316 ++++++++++++
 apps/web/server/lib/inventory-snapshot.ts          |  32 +-
 apps/web/server/lib/purchase-draft-eta.test.ts     |  12 +
 apps/web/server/lib/purchase-draft-eta.ts          |   6 +
 apps/web/server/routes/procurement.ts              |  14 +-
 apps/web/server/tasks/replenishmentForecast.ts     |  15 +-
 apps/web/src/lib/api.ts                            |   2 +
 apps/web/src/pages/PurchaseTrackingPage.tsx        |  86 +++-
 docs/prd/mvp-overview.md                           |   1 +
 ...7-29-inventory-planning-pmc-evolution-design.md | 570 +++++++++++++++++++++
 .../drizzle/0052_purchase_draft_eta_available.sql  |   4 +
 packages/db/drizzle/meta/_journal.json             |  14 +
 packages/db/src/schema/procurement.ts              |   2 +
 18 files changed, 1366 insertions(+), 31 deletions(-)


## Diff
diff --git a/apps/web/server/lib/inventory-health-service.test.ts b/apps/web/server/lib/inventory-health-service.test.ts
index e7e2a64..ddbe66e 100644
--- a/apps/web/server/lib/inventory-health-service.test.ts
+++ b/apps/web/server/lib/inventory-health-service.test.ts
@@ -2,10 +2,55 @@ import assert from 'node:assert/strict';
 import {
   healthToAlertType,
   healthToExceptionType,
   recommendedActionForException,
 } from './inventory-health-service.js';
+import { buildInventoryPositionMetrics } from './inventory-position.js';
+
+assert.deepEqual(
+  buildInventoryPositionMetrics({
+    effectiveQty: 135,
+    qtyAvailable: 100,
+    qtyInProduction: 20,
+    qtyInTransit: 30,
+    qtyConfirmedOpen: 5,
+    qtyReserved: 20,
+    qtyBackorder: 0,
+    dedupeMode: 'drafts_fill_gap',
+    unassignedOpenQty: 7,
+    sources: [
+      { source: 'snapshot', bucket: 'available', qty: 100 },
+      {
+        source: 'purchase_draft',
+        bucket: 'confirmedOpen',
+        qty: 5,
+        draftId: 'draft-1',
+      },
+    ],
+  }),
+  {
+    inventoryPosition: {
+      effectiveQty: 135,
+      qtyAvailable: 100,
+      qtyInProduction: 20,
+      qtyInTransit: 30,
+      qtyConfirmedOpen: 5,
+      qtyReserved: 20,
+      dedupeMode: 'drafts_fill_gap',
+      unassignedOpenQty: 7,
+      sources: [
+        { source: 'snapshot', bucket: 'available', qty: 100 },
+        {
+          source: 'purchase_draft',
+          bucket: 'confirmedOpen',
+          qty: 5,
+          draftId: 'draft-1',
+        },
+      ],
+    },
+  },
+);
 
 assert.equal(healthToAlertType('red', 0), 'stockout');
 assert.equal(healthToAlertType('red', 5), 'below_rop');
 assert.equal(healthToAlertType('yellow', 10), 'below_safety');
 assert.equal(healthToAlertType('green', 10), null);
diff --git a/apps/web/server/lib/inventory-health-service.ts b/apps/web/server/lib/inventory-health-service.ts
index ce18ec9..a443d18 100644
--- a/apps/web/server/lib/inventory-health-service.ts
+++ b/apps/web/server/lib/inventory-health-service.ts
@@ -13,11 +13,14 @@ import { calcReplenishment } from './replenishment.js';
 import {
   calcCoverageReplenishmentFromForecast,
   calcForwardAvgDaily,
 } from './forecast-demand.js';
 import { resolveLeadTimeForSkuWarehouse } from './lead-time-resolver.js';
-import { getLatestInventorySnapshot } from './inventory-snapshot.js';
+import {
+  buildInventoryPositionMetrics,
+  resolveInventoryPosition,
+} from './inventory-position.js';
 import { isGrayLifecycle, type InventoryHealth } from './inventory-light.js';
 import type { CoverageReplenishmentResult } from './replenishment-coverage.js';
 import { loadDailySalesBySkuIds } from './sales-history-query.js';
 import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
 import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';
@@ -85,11 +88,14 @@ export async function computeSkuWarehouseHealth(params: {
     leadTimeDays: leadTime.totalLeadDays,
     unitCost: params.sku.unitCost ? Number(params.sku.unitCost) : 1,
   });
 
   const policy = params.policyMap.get(params.warehouse.code) ?? params.policyMap.get('ALL');
-  const snapshot = await getLatestInventorySnapshot(params.sku.id, params.warehouse.code);
+  const position = await resolveInventoryPosition({
+    skuId: params.sku.id,
+    warehouseCode: params.warehouse.code,
+  });
 
   if (!params.forecastEntry) {
     if (!params.forecastByStation.has(FORECAST_GLOBAL_STATION)) {
       const merged = await loadMergedPublishedForecastBySkuIds([params.sku.id]);
       const resolved = merged.get(params.sku.id) ?? {
@@ -106,11 +112,11 @@ export async function computeSkuWarehouseHealth(params: {
   const forecastEntry =
     params.forecastEntry ??
     params.forecastByStation.get(FORECAST_GLOBAL_STATION) ?? { map: new Map(), lifecycle: undefined };
 
   const coverage = calcCoverageReplenishmentFromForecast({
-    effectiveQty: snapshot.effectiveQty,
+    effectiveQty: position.effectiveQty,
     forecasts: forecastEntry.map,
     historicalAvgDaily: eoqCalc.avgDaily,
     productionDays: leadTime.productionDays,
     shippingDays: leadTime.shippingDays,
     inboundBufferDays: leadTime.inboundBufferDays,
@@ -132,11 +138,11 @@ export async function computeSkuWarehouseHealth(params: {
     spuId: params.sku.spuId,
     merchantCode: params.sku.merchantCode,
     warehouseCode: params.warehouse.code,
     regionGroup: params.warehouse.regionGroup,
     countryCode: params.warehouse.countryCode,
-    effectiveQty: snapshot.effectiveQty,
+    effectiveQty: position.effectiveQty,
     avgDaily,
     demandSource: coverage.demandSource,
     healthStatus: coverage.healthStatus,
     coverageDays: coverage.coverageDays,
     totalLeadDays: coverage.leadTime.totalLeadDays,
@@ -152,10 +158,11 @@ export async function computeSkuWarehouseHealth(params: {
       safetyStockDays: coverage.safetyStockDays,
       targetCoverageDays: coverage.targetCoverageDays,
       overstockThresholdDays: coverage.overstockThresholdDays,
       reorderPoint: eoqCalc.reorderPoint,
       safetyStockQty: eoqCalc.safetyStockQty,
+      ...buildInventoryPositionMetrics(position),
     },
     coverage,
   };
 }
 
diff --git a/apps/web/server/lib/inventory-position.test.ts b/apps/web/server/lib/inventory-position.test.ts
new file mode 100644
index 0000000..a11de6a
--- /dev/null
+++ b/apps/web/server/lib/inventory-position.test.ts
@@ -0,0 +1,149 @@
+import assert from 'node:assert/strict';
+import { describe, it } from 'node:test';
+import {
+  aggregateDraftBucketsForWarehouse,
+  effectiveQtyWithProductionFallback,
+  mapDraftStatusToBucket,
+  mergeInventoryPosition,
+  normalizeSnapshotForWarehouse,
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
+
+  it('fills region production once only when warehouse positions contain none', () => {
+    assert.equal(
+      effectiveQtyWithProductionFallback(
+        [
+          { effectiveQty: 100, qtyInProduction: 0 },
+          { effectiveQty: 50, qtyInProduction: 0 },
+        ],
+        25,
+      ),
+      175,
+    );
+    assert.equal(
+      effectiveQtyWithProductionFallback(
+        [
+          { effectiveQty: 120, qtyInProduction: 20 },
+          { effectiveQty: 50, qtyInProduction: 0 },
+        ],
+        25,
+      ),
+      170,
+    );
+  });
+});
diff --git a/apps/web/server/lib/inventory-position.ts b/apps/web/server/lib/inventory-position.ts
new file mode 100644
index 0000000..34079eb
--- /dev/null
+++ b/apps/web/server/lib/inventory-position.ts
@@ -0,0 +1,316 @@
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
+export type DraftOpenLine = {
+  draftId: string;
+  status: string;
+  openQty: number;
+  warehouseCode: string | null;
+  atRisk?: boolean;
+};
+
+export function buildInventoryPositionMetrics(position: InventoryPositionBreakdown) {
+  return {
+    inventoryPosition: {
+      effectiveQty: position.effectiveQty,
+      qtyAvailable: position.qtyAvailable,
+      qtyInProduction: position.qtyInProduction,
+      qtyInTransit: position.qtyInTransit,
+      qtyConfirmedOpen: position.qtyConfirmedOpen,
+      qtyReserved: position.qtyReserved,
+      dedupeMode: position.dedupeMode,
+      unassignedOpenQty: position.unassignedOpenQty,
+      sources: position.sources,
+    },
+  };
+}
+
+export function effectiveQtyWithProductionFallback(
+  positions: Array<Pick<InventoryPositionBreakdown, 'effectiveQty' | 'qtyInProduction'>>,
+  fallbackInProductionQty: number,
+): number {
+  const total = positions.reduce((sum, position) => sum + position.effectiveQty, 0);
+  const productionFromWarehouses = positions.reduce(
+    (sum, position) => sum + position.qtyInProduction,
+    0,
+  );
+  return productionFromWarehouses <= 0 && fallbackInProductionQty > 0
+    ? total + fallbackInProductionQty
+    : total;
+}
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
diff --git a/apps/web/server/lib/inventory-snapshot.ts b/apps/web/server/lib/inventory-snapshot.ts
index 6bf27cc..3124f24 100644
--- a/apps/web/server/lib/inventory-snapshot.ts
+++ b/apps/web/server/lib/inventory-snapshot.ts
@@ -1,8 +1,13 @@
 import { eq, desc, and } from 'drizzle-orm';
 import { db, inventoryRecords, warehouses } from '@scm/db';
 import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
+import {
+  effectiveQtyWithProductionFallback,
+  resolveInventoryPosition,
+  type InventoryPositionBreakdown,
+} from './inventory-position.js';
 
 export type InventorySnapshot = {
   warehouseCode: string;
   qtyAvailable: number;
   qtyInTransit: number;
@@ -68,40 +73,43 @@ export async function getLatestInventorySnapshot(
 }
 
 export async function getRegionPoolSnapshot(
   skuId: string,
   regionGroup: string,
-): Promise<{ effectiveQty: number; warehouseCodes: string[]; byWarehouse: InventorySnapshot[] }> {
+): Promise<{
+  effectiveQty: number;
+  warehouseCodes: string[];
+  byWarehouse: Array<InventoryPositionBreakdown & { warehouseCode: string }>;
+}> {
   const whRows = await db
     .select({ code: warehouses.code })
     .from(warehouses)
     .where(and(eq(warehouses.regionGroup, regionGroup), eq(warehouses.isActive, true)));
 
   const warehouseCodes = whRows.map((w) => w.code);
-  const byWarehouse: InventorySnapshot[] = [];
-  let effectiveQty = 0;
+  const byWarehouse: Array<InventoryPositionBreakdown & { warehouseCode: string }> = [];
 
   for (const code of warehouseCodes) {
-    const snap = await getLatestInventorySnapshot(skuId, code);
-    byWarehouse.push(snap);
-    effectiveQty += snap.localEffectiveQty;
+    const position = await resolveInventoryPosition({ skuId, warehouseCode: code });
+    byWarehouse.push({ warehouseCode: code, ...position });
   }
 
-  effectiveQty += await getLatestInProductionQty(skuId);
+  const effectiveQty = effectiveQtyWithProductionFallback(
+    byWarehouse,
+    await getLatestInProductionQty(skuId),
+  );
 
   return { effectiveQty, warehouseCodes, byWarehouse };
 }
 
 export async function sumEffectiveQtyForWarehouses(skuId: string, codes: string[]): Promise<number> {
   if (!codes.length) return 0;
-  let total = 0;
+  const positions: InventoryPositionBreakdown[] = [];
   for (const code of codes) {
-    const snap = await getLatestInventorySnapshot(skuId, code);
-    total += snap.localEffectiveQty;
+    positions.push(await resolveInventoryPosition({ skuId, warehouseCode: code }));
   }
-  total += await getLatestInProductionQty(skuId);
-  return total;
+  return effectiveQtyWithProductionFallback(positions, await getLatestInProductionQty(skuId));
 }
 
 /** 姹囨€?SKU 鍦ㄦ墍鏈夊惎鐢ㄤ粨鐨勬渶鏂版湁鏁堜緵缁欙紙鍚?SKU 绾у湪浜ф睜锛?*/
 export async function getSkuTotalEffectiveQty(skuId: string): Promise<number> {
   const whRows = await db
diff --git a/apps/web/server/lib/purchase-draft-eta.test.ts b/apps/web/server/lib/purchase-draft-eta.test.ts
new file mode 100644
index 0000000..02e0957
--- /dev/null
+++ b/apps/web/server/lib/purchase-draft-eta.test.ts
@@ -0,0 +1,12 @@
+import assert from 'node:assert/strict';
+import { describe, it } from 'node:test';
+import { buildEtaPatch } from './purchase-draft-eta.js';
+
+describe('buildEtaPatch', () => {
+  it('sets both etaAvailable and confirmedDeliveryDate', () => {
+    assert.deepEqual(buildEtaPatch('2026-08-15'), {
+      etaAvailable: '2026-08-15',
+      confirmedDeliveryDate: '2026-08-15',
+    });
+  });
+});
diff --git a/apps/web/server/lib/purchase-draft-eta.ts b/apps/web/server/lib/purchase-draft-eta.ts
new file mode 100644
index 0000000..aba4e69
--- /dev/null
+++ b/apps/web/server/lib/purchase-draft-eta.ts
@@ -0,0 +1,6 @@
+export function buildEtaPatch(etaAvailable: string) {
+  return {
+    etaAvailable,
+    confirmedDeliveryDate: etaAvailable,
+  };
+}
diff --git a/apps/web/server/routes/procurement.ts b/apps/web/server/routes/procurement.ts
index eceefff..3fa87bd 100644
--- a/apps/web/server/routes/procurement.ts
+++ b/apps/web/server/routes/procurement.ts
@@ -8,10 +8,11 @@ import {
   normalizePurchaseDraftStatus,
   PURCHASE_DRAFT_STATUS_LABEL,
   type PurchaseDraftStatus,
 } from '../lib/purchase-draft-lifecycle.js';
 import { receivePurchaseDraft } from '../lib/purchase-draft-receipt.js';
+import { buildEtaPatch } from '../lib/purchase-draft-eta.js';
 
 function draftNo(): string {
   const d = new Date();
   const pad = (n: number) => String(n).padStart(2, '0');
   return `PO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Date.now().toString().slice(-6)}`;
@@ -75,10 +76,11 @@ function mapDraftRow(row: {
   planNo: string | null;
   merchantCode: string | null;
   merchantName: string | null;
   status: string;
   supplierConfirmedAt: Date | null;
+  etaAvailable: string | null;
   confirmedDeliveryDate: string | null;
   actualShipDate: string | null;
   actualReceivedDate: string | null;
   receivedQty: number;
   exceptionReason: string | null;
@@ -114,10 +116,11 @@ procurementRoutes.get('/purchase-drafts', async (c) => {
       planNo: pmcPlans.planNo,
       merchantCode: pmcPlans.merchantCode,
       merchantName: pmcPlans.merchantName,
       status: purchaseDrafts.status,
       supplierConfirmedAt: purchaseDrafts.supplierConfirmedAt,
+      etaAvailable: purchaseDrafts.etaAvailable,
       confirmedDeliveryDate: purchaseDrafts.confirmedDeliveryDate,
       actualShipDate: purchaseDrafts.actualShipDate,
       actualReceivedDate: purchaseDrafts.actualReceivedDate,
       receivedQty: purchaseDrafts.receivedQty,
       exceptionReason: purchaseDrafts.exceptionReason,
@@ -157,10 +160,11 @@ procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), asy
   const user = await getCurrentUser(c);
   const draftId = c.req.param('id');
   const body = await c.req.json<{
     status?: PurchaseDraftStatus;
     remark?: string;
+    etaAvailable?: string;
     confirmedDeliveryDate?: string;
     actualShipDate?: string;
     exceptionReason?: string;
     ownerUserId?: string;
   }>();
@@ -183,19 +187,23 @@ procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), asy
     updatedAt: new Date(),
   };
 
   if (nextStatus) patch.status = nextStatus;
   if (body.remark != null) patch.remark = body.remark;
-  if (body.confirmedDeliveryDate) patch.confirmedDeliveryDate = body.confirmedDeliveryDate;
+  if (body.etaAvailable) {
+    Object.assign(patch, buildEtaPatch(body.etaAvailable));
+  } else if (body.confirmedDeliveryDate) {
+    Object.assign(patch, buildEtaPatch(body.confirmedDeliveryDate));
+  }
   if (body.actualShipDate) patch.actualShipDate = body.actualShipDate;
   if (body.exceptionReason != null) patch.exceptionReason = body.exceptionReason;
   if (body.ownerUserId) patch.ownerUserId = body.ownerUserId;
 
   if (nextStatus === 'confirmed' && !existing.supplierConfirmedAt) {
     patch.supplierConfirmedAt = new Date();
-    if (!body.confirmedDeliveryDate && existing.expectedDate) {
-      patch.confirmedDeliveryDate = existing.expectedDate;
+    if (!body.etaAvailable && !body.confirmedDeliveryDate && existing.expectedDate) {
+      Object.assign(patch, buildEtaPatch(existing.expectedDate));
     }
   }
 
   if (!existing.ownerUserId) {
     patch.ownerUserId = user.id;
diff --git a/apps/web/server/tasks/replenishmentForecast.ts b/apps/web/server/tasks/replenishmentForecast.ts
index d4c1c93..960565a 100644
--- a/apps/web/server/tasks/replenishmentForecast.ts
+++ b/apps/web/server/tasks/replenishmentForecast.ts
@@ -7,14 +7,12 @@ import {
   warehouses,
   spus,
 } from '@scm/db';
 import { applyMoq, calcReplenishment, resolveEffectiveMoq } from '../lib/replenishment.js';
 import { formatCoverageReason, type InventoryHealth } from '../lib/replenishment-coverage.js';
-import {
-  getLatestInventorySnapshot,
-  getRegionPoolSnapshot,
-} from '../lib/inventory-snapshot.js';
+import { getRegionPoolSnapshot } from '../lib/inventory-snapshot.js';
+import { resolveInventoryPosition } from '../lib/inventory-position.js';
 import {
   shouldDeferReplenishment,
   splitQtyByDailyShare,
   US_WAREHOUSE_CODES,
 } from '../lib/warehouse-domain.js';
@@ -198,16 +196,19 @@ export async function runReplenishmentForecast() {
         (h) => h.skuId === sku.id && h.warehouseCode === wh.code,
       )!;
       const coverage = coverageByWh[wh.code];
       if (!coverage.needsReplenishment) continue;
 
-      const snapshot = await getLatestInventorySnapshot(sku.id, wh.code);
+      const position = await resolveInventoryPosition({
+        skuId: sku.id,
+        warehouseCode: wh.code,
+      });
       const eoqRop = (health.metrics.reorderPoint as number) ?? 0;
 
       if (wh.regionGroup === 'US') {
         const defer = shouldDeferReplenishment({
-          warehouseEffective: snapshot.effectiveQty,
+          warehouseEffective: position.effectiveQty,
           warehouseRop: eoqRop,
           networkEffective: usPool.effectiveQty,
           networkRop: usNetworkRop,
         });
         if (defer && usNetworkCoverage >= coverage.targetCoverageDays) continue;
@@ -231,11 +232,11 @@ export async function runReplenishmentForecast() {
           : undefined;
       const moqNote =
         effectiveMoq > 0 && suggestedQty > rawQty ? `MOQ ${effectiveMoq}` : undefined;
       const reasonBase = formatCoverageReason({
         warehouseCode: wh.code,
-        effectiveQty: snapshot.effectiveQty,
+        effectiveQty: position.effectiveQty,
         avgDaily: dailyByWh[wh.code] ?? 0,
         result: coverage,
         poolNote,
         moqNote,
       });
diff --git a/apps/web/src/lib/api.ts b/apps/web/src/lib/api.ts
index 3094272..3acce6e 100644
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -1457,10 +1457,11 @@ export const api = {
         skuName: string;
         qty: number;
         receivedQty: number;
         remainingQty: number;
         expectedDate?: string | null;
+        etaAvailable?: string | null;
         confirmedDeliveryDate?: string | null;
         actualShipDate?: string | null;
         actualReceivedDate?: string | null;
         source: string;
         planId?: string | null;
@@ -1477,10 +1478,11 @@ export const api = {
   updatePurchaseTracking: (
     id: string,
     data: {
       status?: PurchaseDraftStatus;
       remark?: string;
+      etaAvailable?: string;
       confirmedDeliveryDate?: string;
       actualShipDate?: string;
       exceptionReason?: string;
     },
   ) => request(`/api/purchase-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
diff --git a/apps/web/src/pages/PurchaseTrackingPage.tsx b/apps/web/src/pages/PurchaseTrackingPage.tsx
index 9b66be8..6b7fa19 100644
--- a/apps/web/src/pages/PurchaseTrackingPage.tsx
+++ b/apps/web/src/pages/PurchaseTrackingPage.tsx
@@ -17,14 +17,21 @@ const STATUS_LABEL: Record<PurchaseDraftStatus, string> = {
   received: '宸叉敹璐?,
   exception: '寮傚父',
   cancelled: '宸插彇娑?,
 };
 
+function displaySellableDate(d: {
+  etaAvailable?: string | null;
+  confirmedDeliveryDate?: string | null;
+  expectedDate?: string | null;
+}) {
+  return d.etaAvailable ?? d.confirmedDeliveryDate ?? d.expectedDate ?? '-';
+}
+
 const NEXT_ACTION: Partial<
   Record<PurchaseDraftStatus, { label: string; status: PurchaseDraftStatus }[]>
 > = {
-  draft: [{ label: '纭浜ゆ湡', status: 'confirmed' }],
   confirmed: [{ label: '鏍囪鐢熶骇涓?, status: 'in_production' }],
   in_production: [{ label: '鏍囪寰呭彂璐?, status: 'ready_to_ship' }],
   ready_to_ship: [{ label: '鏍囪鍦ㄩ€?, status: 'in_transit' }],
   in_transit: [],
   partial_received: [],
@@ -35,32 +42,37 @@ export function PurchaseTrackingPage() {
   const [searchParams] = useSearchParams();
   const statusFilter = (searchParams.get('status') as PurchaseDraftStatus | null) ?? undefined;
   const qc = useQueryClient();
   const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
   const [exceptionReason, setExceptionReason] = useState<Record<string, string>>({});
+  const [confirmEtaDate, setConfirmEtaDate] = useState<Record<string, string>>({});
+  const [updateEtaDate, setUpdateEtaDate] = useState<Record<string, string>>({});
 
   const { data: records = [], isLoading } = useQuery({
     queryKey: ['purchase-tracking', statusFilter],
     queryFn: () => api.getPurchaseTracking(statusFilter),
   });
 
   const updateStatus = useMutation({
     mutationFn: ({
       id,
       status,
+      etaAvailable,
       confirmedDeliveryDate,
       actualShipDate,
       exceptionReason: reason,
     }: {
       id: string;
-      status: PurchaseDraftStatus;
+      status?: PurchaseDraftStatus;
+      etaAvailable?: string;
       confirmedDeliveryDate?: string;
       actualShipDate?: string;
       exceptionReason?: string;
     }) =>
       api.updatePurchaseTracking(id, {
-        status,
+        ...(status ? { status } : {}),
+        etaAvailable,
         confirmedDeliveryDate,
         actualShipDate,
         exceptionReason: reason,
       }),
     onSuccess: () => {
@@ -89,10 +101,11 @@ export function PurchaseTrackingPage() {
       <Card>
         <CardHeader>
           <CardTitle>璺熷崟鍒楄〃</CardTitle>
           <p className="text-sm text-text-sub">
             鍐呴儴灞ョ害鍙拌处锛岄潪姝ｅ紡閲囪喘鍗曘€傜‘璁や氦鏈?鈫?鐢熶骇 鈫?鍙戣揣 鈫?鍦ㄩ€?鈫?鐧昏鍒拌揣鍥炲啓搴撳瓨銆?+            浜ゆ湡/鏃ユ湡琛ㄧず棰勮鍙敭鏃ワ紙鍒颁粨涓婃灦鍚庡彲鍞級锛屼笉鏄埌娓棩銆?             鏁版嵁鏉ヨ嚜{' '}
             <Link to="/pmc/list" className="text-primary hover:underline">
               璁″垝鍒楄〃
             </Link>
             涓凡纭鐨勮鍒掋€?@@ -105,11 +118,11 @@ export function PurchaseTrackingPage() {
                 <th className="p-2 font-normal">璺熷崟鍗曞彿</th>
                 <th className="p-2 font-normal">鏉ユ簮璁″垝</th>
                 <th className="p-2 font-normal">鍟嗗</th>
                 <th className="p-2 font-normal">SKU</th>
                 <th className="p-2 font-normal">璁″垝/宸叉敹</th>
-                <th className="p-2 font-normal">鎵胯浜ゆ湡</th>
+                <th className="p-2 font-normal">棰勮鍙敭鏃?/th>
                 <th className="p-2 font-normal">鐘舵€?/th>
                 <th className="p-2 font-normal">鎿嶄綔</th>
               </tr>
             </thead>
             <tbody>
@@ -136,19 +149,82 @@ export function PurchaseTrackingPage() {
                       {d.qty} / {d.receivedQty ?? 0}
                       {d.remainingQty > 0 && (
                         <span className="ml-1 text-text-sub">锛堝墿 {d.remainingQty}锛?/span>
                       )}
                     </td>
-                    <td className="p-2">{d.confirmedDeliveryDate ?? d.expectedDate ?? '-'}</td>
+                    <td className="p-2">{displaySellableDate(d)}</td>
                     <td className="p-2">
                       {d.statusLabel ?? STATUS_LABEL[d.status] ?? d.status}
                       {d.exceptionReason && (
                         <p className="mt-0.5 text-xs text-destructive">{d.exceptionReason}</p>
                       )}
                     </td>
                     <td className="space-y-1 p-2">
                       <div className="flex flex-wrap gap-1">
+                        {d.status === 'draft' && (
+                          <>
+                            <Input
+                              type="date"
+                              className="h-8 w-36"
+                              value={confirmEtaDate[d.id] ?? ''}
+                              onChange={(e) =>
+                                setConfirmEtaDate((prev) => ({ ...prev, [d.id]: e.target.value }))
+                              }
+                            />
+                            <Button
+                              size="sm"
+                              variant="outline"
+                              disabled={updateStatus.isPending || !confirmEtaDate[d.id]}
+                              onClick={() =>
+                                updateStatus.mutate({
+                                  id: d.id,
+                                  status: 'confirmed',
+                                  etaAvailable: confirmEtaDate[d.id],
+                                })
+                              }
+                            >
+                              纭浜ゆ湡
+                            </Button>
+                          </>
+                        )}
+                        {d.status === 'confirmed' && (
+                          <>
+                            <Input
+                              type="date"
+                              className="h-8 w-36"
+                              value={
+                                updateEtaDate[d.id] ??
+                                d.etaAvailable ??
+                                d.confirmedDeliveryDate ??
+                                ''
+                              }
+                              onChange={(e) =>
+                                setUpdateEtaDate((prev) => ({ ...prev, [d.id]: e.target.value }))
+                              }
+                            />
+                            <Button
+                              size="sm"
+                              variant="outline"
+                              disabled={
+                                updateStatus.isPending ||
+                                !(updateEtaDate[d.id] ?? d.etaAvailable ?? d.confirmedDeliveryDate)
+                              }
+                              onClick={() =>
+                                updateStatus.mutate({
+                                  id: d.id,
+                                  etaAvailable:
+                                    updateEtaDate[d.id] ??
+                                    d.etaAvailable ??
+                                    d.confirmedDeliveryDate ??
+                                    undefined,
+                                })
+                              }
+                            >
+                              鏇存柊鍙敭鏃?+                            </Button>
+                          </>
+                        )}
                         {actions.map((a) => (
                           <Button
                             key={a.status}
                             size="sm"
                             variant="outline"
diff --git a/docs/prd/mvp-overview.md b/docs/prd/mvp-overview.md
index 40624cc..3f8e674 100644
--- a/docs/prd/mvp-overview.md
+++ b/docs/prd/mvp-overview.md
@@ -58,6 +58,7 @@
 
 鍚庣画 Phase
   12. 鍚敤 Dify RAG + Workflow
   13. 鍚堣瑙勫垯搴?+ Agent
   14. 鐗╂祦鍦ㄩ€旇拷韪?+  15. 搴撳瓨瑙勫垝涓?PMC 婕旇繘锛堣 docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md锛? ```
diff --git a/docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md b/docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md
new file mode 100644
index 0000000..b5ebd16
--- /dev/null
+++ b/docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md
@@ -0,0 +1,570 @@
+# 璺ㄥ鐢靛晢搴撳瓨瑙勫垝涓庝緵搴斿晢 PMC 婕旇繘璁捐
+
+**鐗堟湰**锛歷1.0锛?026-07-29锛? 
+**瀹氫綅**锛氬湪鐜版湁銆岄娴?鈫?琛ヨ揣 鈫?PMC 鈫?璺熷崟 鈫?鍒拌揣銆嶉棴鐜箣涓婏紝婕旇繘涓哄彲鍥炵瓟銆岃涓嶈琛ャ€佽ˉ澶氬皯銆佷綍鏃朵笅鍗曘€佷細鍚︽柇璐?绉帇銆嶇殑瑙勫垝骞冲彴锛涗笉鍙﹁捣绯荤粺銆?+
+**鍏宠仈鏂囨。**锛?+
+- `docs/prd/mvp-business-loop.md` 鈥?鐜版湁鏈夐檺涓氬姟闂幆
+- `docs/prd/mvp-pmc.md` 鈥?PMC 璁″垝锛堥潪姝ｅ紡 PO锛?+- `docs/prd/mvp-inventory-replenishment.md` 鈥?瀹夊叏搴撳瓨涓庤ˉ璐?+- `docs/prd/mvp-overview.md` 鈥?鏄庣‘涓嶅仛鑼冨洿
+- `docs/superpowers/specs/2026-06-29-sales-forecast-collaboration-design.md` 鈥?棰勬祴鍗忎綔
+
+---
+
+## 1. 鑳屾櫙涓庣洰鏍?+
+### 1.1 瑕佸洖绛旂殑 4 涓棶棰?+
+1. 浠€涔堟椂鍊欓渶瑕佽ˉ璐э紵
+2. 搴旇琛ュ灏戯紵
+3. 浠€涔堟椂鍊欏繀椤讳笅鍗曪紝鎵嶈兘瑕嗙洊鐢熶骇鍜屾捣杩愬懆鏈燂紵
+4. 褰撳墠搴撳瓨銆佸湪閫斻€佺敓浜у拰闇€姹傚彉鍖栵紝鏄惁浼氶€犳垚鏂揣鎴栧簱瀛樼Н鍘嬶紵
+
+### 1.2 浜у搧杈圭晫
+
+绯荤粺鍚嶇О鍙〃杩颁负锛?*璺ㄥ鐢靛晢搴撳瓨瑙勫垝涓庝緵搴斿晢 PMC 骞冲彴**銆?+
+鐢变袱涓浉浜掕繛鎺ョ殑鏍稿績寮曟搸缁勬垚锛?+
+```text
+搴撳瓨瑙勫垝寮曟搸锛?+闇€姹傞娴?+ 搴撳瓨浣嶇疆 + 鍒嗘鎻愬墠鏈?+ 瀹夊叏搴撳瓨/瑕嗙洊澶╂暟 + 琛ヨ揣寤鸿
+
+渚涘簲鍟?PMC 寮曟搸锛?+閲囪喘璁″垝 + 浜ゆ湡鎵胯 + 鐘舵€佽窡鍗?+ 鍙戣繍閲岀▼纰?+ 鍒拌揣鍥炲啓
+```
+
+| 寮曟搸 | 璐熻矗 | 涓嶈礋璐?|
+|------|------|--------|
+| 搴撳瓨瑙勫垝 | 璇ヤ笉璇ヨˉ銆佽ˉ澶氬皯銆佷綍鏃朵笅鍗曘€佸彲瑙ｉ噴渚濇嵁 | 宸ュ巶鎺掍骇 MES銆佹寮忚储鍔?PO |
+| 渚涘簲鍟?PMC | 渚涘簲鍟嗚兘鍚︽寜璁″垝鐢熶骇涓庝氦浠樸€侀璁″彲鍞棩 | 鑸瑰徃 API銆丗OB 璐圭敤缁撶畻锛堝凡鏈夌嫭绔嬫ā鍧楋級 |
+
+### 1.3 涓庣幇鐘剁殑鍏崇郴
+
+| 鑳藉姏 | 鐜扮姸 | 鏈璁?|
+|------|------|--------|
+| 棰勬祴鍗忎綔锛堢増鏈?瀹℃牳/瀛ｈ妭/鍑嗙‘鐜囷級 | 宸插疄鐜?| **澶嶇敤**锛屼粎琛ユ柇璐т慨姝?|
+| 瑕嗙洊澶╂暟琛ヨ揣 + 鍋ュ悍鐏?| 宸插疄鐜?| **缁熶竴搴撳瓨浣嶇疆鍙ｅ緞**鍚庣户缁负涓荤瓥鐣?|
+| 鎬绘彁鍓嶆湡 = 鐢熶骇 + 娴疯繍 + 鍏ヤ粨缂撳啿 | 宸插疄鐜帮紙3 娈碉級 | **婕旇繘涓鸿矾绾跨骇 profile**锛岃绠椾粛姹囨€讳负 `totalLeadDays` |
+| PMC 璁″垝 + `purchase_drafts` 璺熷崟 | 宸插疄鐜?| **寮哄寲閲岀▼纰戜笌棰勮鍙敭鏃?* |
+| 姝ｅ紡 PO / BOM / 渚涘簲鍟嗛棬鎴?/ 鑸瑰徃 API | PRD 鏄庣‘涓嶅仛 | **缁х画涓嶅仛** |
+| FOB 缁撶畻 | 宸插疄鐜?| **涓庡彂杩愯窡韪В鑰?* |
+| SAP | 鏃?| **浠呴鐣欏閮ㄦ爣璇嗗瓧娈?*锛屼笉寮€鍙戠湡瀹炴帴鍙?|
+
+**鍘熷垯**锛氭墿灞曠幇鏈夎〃涓庢湇鍔★紝绂佹骞宠鍐嶅缓涓€濂?`inventory_balance` / `demand_forecast` / `purchase_order` 涓昏矾寰勩€?+
+### 1.4 鎴愬姛鏍囧噯
+
+- 鍋ュ悍鐏€佽ˉ璐у缓璁€丼KU 瑙勫垝椤点€佹€昏瀵瑰悓涓€ SKU+浠撲娇鐢?*鍚屼竴搴撳瓨浣嶇疆**瀹氫箟銆?+- 琛ヨ揣寤鸿鍙В閲婏細鑳藉睍绀鸿Е鍙戝師鍥犮€佸簱瀛樹綅缃瀯鎴愩€佹彁鍓嶆湡鎷嗚В銆侀娴嬬増鏈€佸缓璁笅鍗曟棩涓庡缓璁噺銆?+- 璺熷崟鑷冲皯鑳界淮鎶ゅ苟椹卞姩銆岄璁″彲鍞棩銆嶏紝琛ヨ揣瑕嗙洊璁＄畻浼樺厛浣跨敤璇ユ棩鏈熻涔夛紙鑰岄潪鍒版腐鏃ワ級銆?+- 鎻愬墠鏈熷彲鎸夈€屼緵搴斿晢 脳 鐩殑浠?脳 杩愯緭鏂瑰紡銆嶉厤缃紝缂虹渷鍥為€€鍒扮幇鏈?3 娈佃В鏋愩€?+
+---
+
+## 2. 鍐崇瓥鎽樿
+
+| 椤?| 閫夋嫨 |
+|----|------|
+| 婕旇繘鏂瑰紡 | 鍦ㄧ幇闂幆涓婂姞娣憋紝涓嶉噸閫犺鍒掔郴缁?|
+| 榛樿琛ヨ揣绛栫暐 | 瑕嗙洊澶╂暟 + 鍋ュ悍鐏紙鐜扮綉锛夛紱Z 鍊兼湇鍔℃按骞充负鍙€夐珮绾х瓥鐣ワ紝瀛楁鍏堥鐣?|
+| 搴撳瓨浣嶇疆 | 鍗曚竴鏈嶅姟 `resolveInventoryPosition`锛涘叏閾捐矾寮哄埗鍚屾簮 |
+| 鎻愬墠鏈?| 鏂板缓 `lead_time_profiles`锛涚畻娉曞澶栦粛鐢?`totalLeadDays` + `breakdown` |
+| 姝ｅ紡 PO | 缁х画鐢?`purchase_drafts`锛涗笉寮曞叆瀹℃壒娴?PO |
+| 鍙戣繍璺熻釜 | 杞婚噺 `shipments` / `shipment_milestones`锛屼笌 FOB 瑙ｈ€︼紱MVP 浜哄伐缁存姢 |
+| 棰勬祴 | 涓嶉噸寤洪娴嬪伐浣滃彴锛涜ˉ銆屾湁搴撳瓨澶╂暟銆嶆湁鏁堟棩闇€姹?|
+| SAP | `source_system` / `external_id` 绛夐鐣欙紱瑙勫垝閫昏緫鐣欏湪鏈郴缁?|
+| 璁＄畻杩芥函 | 鍏堝己鍖栧缓璁?鍋ュ悍 `metrics` 蹇収锛涗簤璁鍚庡啀鎶?`planning_runs` 琛?|
+
+---
+
+## 3. 鐩爣闂幆
+
+```text
+閿€鍞鍗?棰勬祴锛堝凡鏈夛級
+    鈫?+搴撳瓨浣嶇疆鏍哥畻锛堟湰璁捐 P0锛?+    鈫?+瀹夊叏搴撳瓨 / 瑕嗙洊澶╂暟锛堝凡鏈夛紝鍙ｅ緞瀵归綈锛?+    鈫?+鑷姩閲嶈璐?/ 琛ヨ揣寤鸿锛堝凡鏈夛紝鍙В閲婂寮猴級
+    鈫?+PMC 璁″垝 + 閲囪喘璺熷崟锛堝凡鏈夛級
+    鈫?+鐢熶骇/鍙戣繍閲岀▼纰?+ 棰勮鍙敭鏃ワ紙鏈璁?P0鈥揚2锛?+    鈫?+鍒拌揣鍏ュ簱鍥炲啓锛堝凡鏈夛級
+    鈫?+鍙敭搴撳瓨涓庡仴搴风伅鏇存柊
+```
+
+瑙﹀彂鍒ゆ柇锛堜繚鎸佸苟寮哄寲锛夛細
+
+```text
+渚涘簲瑕嗙洊澶╂暟 = 搴撳瓨浣嶇疆 / 棰勮鏃ラ渶姹?+
+鑻?渚涘簲瑕嗙洊澶╂暟 < 鎬绘彁鍓嶆湡 + 瀹夊叏搴撳瓨瑕嗙洊鏈?+鎴?搴撳瓨浣嶇疆 <= 閲嶈璐х偣
+鈫?鐢熸垚琛ヨ揣寤鸿
+```
+
+**绂佹**浠呯敤銆岀幇璐у簱瀛?<= 閲嶈璐х偣銆嶄綔涓哄敮涓€瑙﹀彂鏉′欢銆?+
+---
+
+## 4. 搴撳瓨浣嶇疆锛圥0锛?+
+### 4.1 瀹氫箟
+
+```text
+搴撳瓨浣嶇疆 =
+  鍙敭搴撳瓨锛坬tyAvailable锛?++ 鐢熶骇涓紙qtyInProduction + 璺熷崟 mapped production锛?++ 鍦ㄩ€旓紙qtyInTransit + 璺熷崟 mapped transit锛?++ 宸茬‘璁ゆ湭鐢熶骇锛堣窡鍗?confirmed/draft 鏈敹璐ч噺锛屾寜绛栫暐璁″叆锛?+- 宸插垎閰嶏紙qtyReserved锛?+- 鏈氦浠樻瑺鍗曪紙鍙€夛紝棣栫増鍙负 0锛?+```
+
+棰勪笅鍗曠瓑涓氬姟閲忥細寤剁画鐜版湁瀵煎叆绾﹀畾锛堝鍐欏叆 `qtyReserved` / 鎬昏 `qtyPreOrder` 灞曠ず锛夛紝鍦?position 鏋勬垚涓?*鏄惧紡鏍囨敞鏉ユ簮**锛岄伩鍏嶉噸澶嶅姞鍑忋€?+
+### 4.2 璺熷崟鐘舵€?鈫?浣嶇疆妗舵槧灏?+
+| `purchase_drafts.status` | 璁″叆妗?| 鏁伴噺鍙ｅ緞 |
+|--------------------------|--------|----------|
+| `draft` / `confirmed` | `confirmedOpen`锛堝凡纭鏈敓浜э級 | `qty - receivedQty` |
+| `in_production` / `ready_to_ship` | `inProduction` | 鍚屼笂 |
+| `in_transit` / `partial_received` | `inTransit` | 鏈敹璐ч儴鍒?|
+| `received` / `cancelled` | 涓嶈鍏ュ紑鏀鹃噺 | 鈥?|
+| `exception` | `confirmedOpen` | `qty - receivedQty`锛沗sources` 鎵撴爣 `atRisk: true` |
+
+涓庨涔?瀵煎叆蹇収鐨?`qtyInProduction` / `qtyInTransit` **鍘婚噸瑙勫垯**锛堝繀椤诲啓姝伙級锛?+
+1. **浼樺厛蹇収**锛氳嫢褰撴棩蹇収宸插惈銆屼緵搴斿晢璁㈠崟 / 璋冩嫧鍦ㄩ€斻€嶇瓑鍚堣锛岃窡鍗曞紑鏀鹃噺浠呭湪銆屽揩鐓ф湭瑕嗙洊璇?SKU+浠撱€嶆垨銆屾樉寮忓惎鐢ㄨ窡鍗曞彔鍔犲紑鍏炽€嶆椂鍙犲姞銆?+2. 棣栫増榛樿锛?*蹇収鏉冨▉ + 璺熷崟浠呰ˉ榻愬揩鐓т负 0 鐨勭己鍙?*锛圥0 閿佸畾 `drafts_fill_gap`锛涘彲閰嶇疆涓?`snapshot_only` | `drafts_fill_gap` | `sum_both`锛夈€?+3. 鏋勬垚鏄庣粏鍐欏叆 metrics锛屼究浜庡璁°€屼负浠€涔堜綅缃槸 5800銆嶃€?+
+### 4.3 鏈嶅姟濂戠害
+
+鏂板缓锛堝缓璁矾寰勶級`apps/web/server/lib/inventory-position.ts`锛?+
+```ts
+type InventoryPositionBreakdown = {
+  qtyAvailable: number;
+  qtyInProduction: number;
+  qtyInTransit: number;
+  qtyConfirmedOpen: number;
+  qtyReserved: number;
+  qtyBackorder: number; // 棣栫増 0
+  effectiveQty: number; // = 浣嶇疆鍚堣
+  sources: Array<{ source: string; bucket: string; qty: number }>;
+  dedupeMode: 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';
+};
+
+function resolveInventoryPosition(params: {
+  skuId: string;
+  warehouseCode: string;
+  asOf?: Date;
+}): Promise<InventoryPositionBreakdown>;
+```
+
+**寮哄埗璋冪敤鏂?*锛歚inventory-health-service`銆佽ˉ璐т换鍔°€乣reorder` 寤鸿鐢熸垚銆佹湭鏉?SKU 瑙勫垝 API銆傜姝㈠悇妯″潡鑷 `available + transit`銆?+
+### 4.4 鏁版嵁妯″瀷
+
+棣栫増**涓嶆柊寤?* `inventory_balance` / `inventory_transaction`銆傜户缁細
+
+- `inventory_records` + 椋炰功鏃ュ揩鐓?+- `purchase_drafts` 寮€鏀鹃噺
+- 璁＄畻缁撴灉杩?`reorder_suggestions.metrics` / `inventory_health_snapshots`
+
+寰呯湡瀹?WMS 娴佹按鎺ュ叆鍚庡啀璇勪及娴佹按琛ㄣ€?+
+---
+
+## 5. 鎻愬墠鏈燂紙P1锛?+
+### 5.1 瀹屾暣閾捐矾锛堜笟鍔¤涔夛級
+
+```text
+閲囪喘涓嬪崟 鈫?鎺ュ崟 鈫?澶囨枡 鈫?鐢熶骇 鈫?璐ㄦ/鍖呰 鈫?鍥藉唴闆嗚揣
+鈫?璁㈣埍 鈫?娴疯繍 鈫?娓呭叧 鈫?鍒颁粨 鈫?涓婃灦 鈫?鍙敭
+```
+
+### 5.2 閰嶇疆缁村害
+
+鎻愬墠鏈?*涓?*鍙寕鍦ㄤ緵搴斿晢涓绘暟鎹笂銆傜淮搴︼細
+
+```text
+supplier/merchant + origin_location + destination_warehouse + transport_mode
+```
+
+### 5.3 瀛樺偍锛歚lead_time_profiles`
+
+| 瀛楁 | 璇存槑 |
+|------|------|
+| id | uuid |
+| merchant_code | 鍟嗗/渚涘簲鍟嗙紪鐮侊紝鍙┖琛ㄧず浠撻粯璁?|
+| origin_location | 璧疯繍鍦帮紙鑷敱鏂囨湰鎴栫爜琛級锛屽彲绌?|
+| destination_warehouse_code | 鐩殑浠擄紝蹇呭～鎴栦笌 region 浜岄€変竴 |
+| transport_mode | `fcl` / `lcl` / `air` / `express` / `rail` / `truck_air` / `direct` |
+| production_days | 澶囨枡+鐢熶骇+璐ㄦ锛堝彲鍐嶆媶瀛愬瓧娈碉紝棣栫増鍚堝苟锛?|
+| booking_days | 璁㈣埍绛夊緟 |
+| transit_days | 骞茬嚎杩愯緭 |
+| customs_days | 娓呭叧 |
+| inbound_days | 鍒颁粨+涓婃灦锛堝搴旂幇 `inboundBufferDays`锛?|
+| domestic_days | 鍥藉唴闆嗚揣/杩愯緭锛岄粯璁?0 |
+| lead_time_std_dev | 鍙€夛紝楂樼骇瀹夊叏搴撳瓨鐢?|
+| is_default | 鍚岀淮搴﹂粯璁ゆ。 |
+| version / effective_from | 鍙€夌増鏈?|
+| source_system / external_id | SAP 棰勭暀 |
+| created_at / updated_at | |
+
+**瑙ｆ瀽浼樺厛绾?*锛堟浛鎹?鎵╁睍鐜?`lead-time-resolver`锛夛細
+
+1. 绮剧‘鍖归厤 profile锛堝晢瀹?+ 浠?+ 杩愯緭鏂瑰紡锛?+2. 浠撶骇榛樿 profile / `warehouses.shipping_lead_days` + `inbound_buffer_days`
+3. 鍟嗗 `production_lead_days` / `sku_suppliers.lead_time_days` / SKU `lead_time_days`
+4. 浠ｇ爜甯搁噺锛堝鐜?`DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE`锛?+
+### 5.4 璁＄畻杈撳嚭
+
+淇濇寔骞舵墿灞?`LeadTimeBreakdown`锛?+
+```text
+totalLeadDays =
+  production_days + domestic_days + booking_days
+  + transit_days + customs_days + inbound_days
+```
+
+灞曠ず灞傚彲鏄剧ず 6 娈碉紱鍐呴儴琛ヨ揣鍙緷璧?`totalLeadDays`銆? 
+**琛ヨ揣涓?ETA 涓€寰嬩娇鐢ㄣ€岄璁″彲鍞棩銆嶈涔?*锛屼笉绛変簬鍒版腐鏃ャ€?+
+---
+
+## 6. 瀹夊叏搴撳瓨涓庤ˉ璐ч噺锛堝榻愮幇缃戯級
+
+### 6.1 榛樿锛氳鐩栧ぉ鏁?+
+娌跨敤 `replenishment-coverage`锛?+
+```text
+瑕嗙洊澶╂暟 = 搴撳瓨浣嶇疆 / 棰勮鏃ラ渶姹?+鏈€鏅氫笅鍗曞墿浣欏ぉ鏁?= 瑕嗙洊澶╂暟 - 鎬绘彁鍓嶆湡 - 瀹夊叏搴撳瓨澶╂暟
+寤鸿閲?= max(0, 鐩爣瑕嗙洊澶╂暟 脳 鏃ラ渶姹?- 搴撳瓨浣嶇疆)锛屽啀鎸?MOQ 鎶崌
+```
+
+鐩爣瑕嗙洊澶╂暟榛樿锛歚鎬绘彁鍓嶆湡 + 2 脳 瀹夊叏搴撳瓨澶╂暟`锛堜笌鐜板疄鐜颁竴鑷达紝鍙厤缃級銆?+
+### 6.2 缁忓吀 ROP锛堝苟瀛橈級
+
+```text
+閲嶈璐х偣 = 鎻愬墠鏈熼渶姹?+ 瀹夊叏搴撳瓨
+鎻愬墠鏈熼渶姹?= 棰勮鏃ラ渶姹?脳 鎬绘彁鍓嶆湡
+```
+
+`safety_stock_config` 缁х画鎵胯浇 ROP/EOQ/瑕嗙洊鍙傛暟锛涜ˉ璐т换鍔′互瑕嗙洊鍋ュ悍鐏负涓伙紝ROP 浣滃苟鍒楀睍绀轰笌棰勮绫诲瀷銆?+
+### 6.3 楂樼骇锛氭湇鍔℃按骞筹紙P3锛屽瓧娈甸鐣欙級
+
+```text
+safety_stock = Z 脳 蟽_demand 脳 鈭歀
+# 鎴栧惈鎻愬墠鏈熸尝鍔細
+Z 脳 鈭?L路蟽_d虏 + 渭_d虏 路 蟽_L虏)
+```
+
+鍦?`safety_stock_config`锛堟垨 planning 鍙傛暟锛夐鐣欙細
+
+- `demand_std_dev`
+- `lead_time_std_dev`
+- `service_level`
+- `safety_stock_method`锛歚coverage_days` | `z_demand` | `z_demand_leadtime`
+
+**棣栫増涓嶉粯璁ゅ惎鐢?Z 鍊煎叕寮忋€?*
+
+### 6.4 閲囪喘绾︽潫
+
+寤鸿閲忎慨姝ｉ『搴忥細
+
+1. 鐩爣搴撳瓨 鈭?搴撳瓨浣嶇疆  
+2. `max(缁撴灉, MOQ, 鏈€灏忕敓浜ф壒閲?`  
+3. 鍚戜笂鍙栨暣鍒板寘瑁呭€嶆暟锛堟湁鏁版嵁鏃讹級  
+4. 鏁存煖/鎵樼洏锛堟湁鏁版嵁鏃讹紝鍙悗缃級  
+5. 渚涘簲鍟嗕骇鑳?/ 棰勭畻 / 浠撳 鈥?**棣栫増浠呭娉ㄦ垨浜哄伐鏀归噺锛屼笉鍋氳嚜鍔ㄧ‖绾︽潫寮曟搸**
+
+---
+
+## 7. 闇€姹傞娴嬶紙澧為噺锛?+
+### 7.1 澶嶇敤
+
+缁х画浣跨敤 `sales_forecast_*` 鍗忎綔浣撶郴锛涜ˉ璐т紭鍏堝凡鍙戝竷鐗堟湰锛堢幇鏈?`forecast-published-resolve`锛夈€?+
+### 7.2 鏂揣淇锛圥2锛?+
+鍘嗗彶鍥為€€鏃ラ渶姹傛敼涓烘湁鏁堥攢鍞€熷害锛?+
+```text
+鏈夋晥鏃ラ渶姹?= 鏈夊簱瀛樻湡闂撮攢閲?/ 鏈夊簱瀛橀攢鍞ぉ鏁?+```
+
+瀹炵幇瑕佺偣锛?+
+- 杈撳叆锛歚sales_history` + 鍚屾湡鍙敭搴撳瓨锛堝揩鐓ф垨銆屽彲鍞?> 0銆嶈繎浼硷級
+- 杈撳嚭锛氫緵 `historicalAvgDaily` 鍥為€€锛沵etrics 璁板綍 `stockoutAdjusted: true` 涓庡ぉ鏁?+- 鏃犲彲闈犲簱瀛樺巻鍙叉椂鍥為€€涓恒€屽疄闄呴攢閲?/ 鏃ュ巻澶╂暟銆嶏紝骞舵爣璁版湭淇
+
+### 7.3 涓嶅仛
+
+- 涓嶆柊寤哄钩琛?`demand_forecast` 琛? 
+- 涓嶆妸銆屼粎鏀寔绉诲姩骞冲潎涓夌鏂规硶銆嶅綋浣滄柊椤圭洰锛涚幇鏈夊熀绾?鍗忓悓宸茶鐩栧苟鏇村己
+
+---
+
+## 8. 渚涘簲鍟?PMC 涓庨璁″彲鍞棩锛圥0鈥揚1锛?+
+### 8.1 寤剁画
+
+- `pmc_plans` / `pmc_plan_items`锛氶渶姹傝鍒掍笅鍙? 
+- `purchase_drafts`锛氬唴閮ㄨ窡鍗曠湡鐩? 
+- 鍒拌揣 鈫?`pmc_receipts` 鈫?搴撳瓨鍥炲啓  
+
+### 8.2 璺熷崟瀛楁鎵╁睍
+
+鍦?`purchase_drafts`锛堟垨 1:1 鎵╁睍琛級澧炲姞锛?+
+| 瀛楁 | 璇存槑 |
+|------|------|
+| planned_production_done_date | 璁″垝鐢熶骇瀹屾垚 |
+| actual_production_done_date | 瀹為檯鐢熶骇瀹屾垚 |
+| planned_pickup_date | 棰勮鎻愯揣 |
+| etd | 棰勮寮€鑸?|
+| eta_port | 棰勮鍒版腐 |
+| customs_done_date | 棰勮/瀹為檯娓呭叧瀹屾垚 |
+| eta_warehouse | 棰勮鍏ヤ粨 |
+| eta_available | **棰勮鍙敭鏃?*锛堣ˉ璐т笌寤惰璁＄畻涓诲瓧娈碉級 |
+| delay_days | 鐩稿鍘熸壙璇虹殑寤惰锛堝彲璁＄畻锛?|
+| transport_mode | 杩愯緭鏂瑰紡锛岃В鏋?lead time 鐢?|
+
+鐜版湁 `confirmed_delivery_date`锛?*璇箟杩佺Щ涓烘壙璇哄彲鍞棩**锛涜嫢鍘嗗彶鏁版嵁娣风敤鍒版腐鏃ワ紝杩佺Щ璇存槑鍐欏叆 metrics/澶囨敞锛孶I 鏍囨槑銆屾壙璇哄彲鍞€嶃€?+
+### 8.3 閲岀▼纰戞彁閱?+
+鎵╁睍 `purchase_follow_up_reminders.milestone` 鏋氫妇/绾﹀畾鍊硷紝渚嬪锛歚confirm` / `production` / `etd` / `eta_port` / `eta_available`銆?+
+### 8.4 鏄庣‘涓嶅仛锛堣繎鏈燂級
+
+- 姣忔棩宸ュ巶浜ч噺褰曞叆銆佺己鏂欍€丅OM/`material_requirements` UI  
+- 渚涘簲鍟嗛棬鎴? 
+- 姝ｅ紡 PO 瀹℃壒  
+
+---
+
+## 9. 鍙戣繍涓庢捣杩愯妭鐐癸紙P2锛?+
+### 9.1 涓?FOB 瑙ｈ€?+
+`/logistics/fob-*` 淇濇寔璐圭敤鍒嗘憡缁撶畻銆備緵搴旈摼鑺傜偣璺熻釜浣跨敤鏂拌交妯″瀷銆?+
+### 9.2 琛細`shipments` / `shipment_milestones`
+
+**shipments**
+
+| 瀛楁 | 璇存槑 |
+|------|------|
+| id / shipment_no | |
+| draft_id / plan_item_id | 鍏宠仈璺熷崟鎴栬鍒掕锛堝彲绌猴級 |
+| sku_id / qty | 鍙琛屾椂鍚庣画鍐嶆媶鏄庣粏琛紱棣栫増涓€绁ㄤ竴 SKU 鎴?JSON lines |
+| container_no / booking_ref / tracking_no | |
+| transport_mode | |
+| status | 涓庨噷绋嬬鏈€鍚庡畬鎴愯妭鐐逛竴鑷?|
+| eta_available | 鍐椾綑渚夸簬鍒楄〃 |
+| source_system / external_id | 棰勭暀 |
+| created_at / updated_at | |
+
+**shipment_milestones**
+
+| 瀛楁 | 璇存槑 |
+|------|------|
+| shipment_id | |
+| milestone | `booked` / `loaded` / `departed` / `arrived_port` / `customs` / `received_wh` / `available` |
+| planned_at / actual_at | |
+| remark | |
+
+MVP锛氫汉宸ョ淮鎶よ妭鐐癸紱寤惰澶╂暟 = `actual/ today - planned`銆?+
+### 9.3 鍒楄〃椤?+
+銆屽湪閫斿拰娴疯繍绠＄悊銆嶉鐗堝彲浠ユ槸璺熷崟绛涢€夊寮?+ shipments 鍒楄〃锛屼笉蹇呭厛鍋氬ぇ椹鹃┒鑸便€?+
+---
+
+## 10. 椤甸潰婕旇繘
+
+### 10.1 浼樺厛
+
+| 椤甸潰 | 璇存槑 |
+|------|------|
+| SKU 搴撳瓨瑙勫垝椤?| 鍗?SKU锛氫綅缃媶鍒嗐€佹棩闇€姹傘€佸畨鍏ㄥ簱瀛樸€丷OP銆佹€绘彁鍓嶆湡銆佽鐩栧ぉ鏁般€侀璁℃柇璐ф棩銆佸缓璁笅鍗曟棩/閲忋€佺畝鏄撳簱瀛樻洸绾?|
+| 琛ヨ揣寤鸿鍙В閲?| 鍦ㄧ幇 `/pmc/suggestions` 灞曠ず鏋勬垚涓庤Е鍙戝師鍥狅紙浣犳枃妗ｄ腑鐨勫瓧娈垫竻鍗曪級 |
+| 璺熷崟閲岀▼纰?| `/pmc/tracking` 澧炲姞鍙敭鏃ヤ笌鍏抽敭鏃ユ湡 |
+
+### 10.2 鍏跺悗
+
+| 椤甸潰 | 璇存槑 |
+|------|------|
+| 鍙戣繍鑺傜偣鐪嬫澘 | 鍩轰簬 shipments |
+| 瑙勫垝椹鹃┒鑸?| 鑱氬悎鍋ュ悍蹇収銆佸缓璁緟瀹°€佸欢璇壒娆°€佹柇璐х巼绛夛紱渚濊禆 P0 鍙ｅ緞绋冲畾 |
+| 棰勬祴绠＄悊 | **宸叉湁**锛屼粎鍔犳柇璐т慨姝ｈ鏄?鎸囨爣 |
+
+### 10.3 SKU 瑙勫垝椤垫渶灏忔寚鏍?+
+```text
+褰撳墠鍙敭 / 宸插垎閰?/ 鐢熶骇涓?/ 鍦ㄩ€?/ 宸茬‘璁ゆ湭鐢熶骇
+棰勮鏃ラ渶姹?/ 瀹夊叏搴撳瓨 / 閲嶈璐х偣 / 鎬绘彁鍓嶆湡
+渚涘簲瑕嗙洊澶╂暟 / 棰勮鏂揣鏃?/ 寤鸿涓嬪崟鏃?/ 寤鸿閲囪喘閲?/ 棰勮鍙敭鍒拌揣
+```
+
+搴撳瓨鏇茬嚎锛氱畝鍖栦负銆屾寜鏃ラ渶姹傛秷鑰?+ 宸茬煡 `eta_available` 琛ョ粰闃惰穬銆嶏紱涓嶅仛澶嶆潅浠跨湡寮曟搸銆?+
+### 10.4 琛ヨ揣寤鸿鍙В閲婄ず渚嬶紙浜у搧鏂囨锛?+
+```text
+瑙﹀彂鍘熷洜锛氬簱瀛樹綅缃綆浜庨噸璁㈣揣鐐癸紙鎴栬鐩栧ぉ鏁颁笉瓒筹級
+搴撳瓨浣嶇疆锛?,800 = 鍙敭 2,400 + 鐢熶骇涓?鈥?+ 鍦ㄩ€?鈥?鈭?宸插垎閰?鈥?+鏃ュ潎闇€姹傦細120锛堟潵婧愶細宸插彂甯冮娴?version=鈥?/ 鎴栨柇璐т慨姝ｅ巻鍙诧級
+鎬绘彁鍓嶆湡锛?5 = 鐢熶骇 25 + 鈥?
+瀹夊叏搴撳瓨锛?,800锛堟柟娉曪細coverage_days / 14 澶╋級
+閲嶈璐х偣锛?,600
+寤鸿琛ヨ揣閲忥細12,000锛堝凡鎸?MOQ 璋冩暣锛?+棰勮缂鸿揣鏃ユ湡 / 寤鸿涓嬪崟鏃ユ湡 / 棰勮鍙敭鍒拌揣
+```
+
+鐢ㄦ埛鍔ㄤ綔淇濇寔锛氭帴鍙椼€佹敼閲忋€佹敼渚涘簲鍟嗐€佸悎骞惰繘 PMC銆佸拷鐣?鍘熷洜銆?+
+---
+
+## 11. 璁＄畻杩芥函
+
+姣忔琛ヨ揣/鍋ュ悍璁＄畻鍐欏叆锛堝缓璁?metrics JSON锛夛細
+
+```text
+planning_calculated_at
+forecast_version_id / demand_source
+lead_time_breakdown + profile_id
+inventory_position breakdown + dedupe_mode
+safety_stock_method + parameters
+suggested_qty / suggested_date / health_status
+```
+
+鐙珛 `planning_runs` 琛細**寤舵湡鍒?*鍑虹幇澶ч噺銆屽綋鏃朵负浣曞缓璁?12000銆嶅璁￠渶姹傛椂鍐嶆娊銆?+
+---
+
+## 12. SAP / 澶栭儴绯荤粺鍏煎
+
+鍦?SKU銆佸晢瀹躲€佽窡鍗曘€佸彂杩愩€佹彁鍓嶆湡 profile 涓婃寜闇€棰勭暀锛?+
+```text
+source_system
+external_id
+external_line_id
+external_version
+sync_status
+last_sync_time
+```
+
+鎺ュ叆椤哄簭锛堜粎瑙勫垝锛屾湰璁捐涓嶅疄鏂斤級锛?+
+1. 渚涘簲鍟嗕笌鐗╂枡涓绘暟鎹? 
+2. 閲囪喘璁㈠崟闀滃儚  
+3. 搴撳瓨涓庡叆搴? 
+4. PO 鍙樻洿  
+5. 鍙戣揣閫氱煡涓庣墿娴? 
+
+**鏈郴缁熺户缁淮鎶?*锛氶娴嬨€佸畨鍏ㄥ簱瀛?瑕嗙洊绛栫暐銆佽ˉ璐у缓璁€佷緵搴斿晢鎵胯涓庣敓浜?鍙戣繍璺熻繘銆佹捣杩?娓呭叧鎻愬墠鏈熴€佸紓甯镐笌缁╂晥鐩稿叧杩愯惀鏁版嵁銆?+
+---
+
+## 13. 鍒嗘湡
+
+| 闃舵 | 鍐呭 | 楠屾敹 |
+|------|------|------|
+| **P0** | `resolveInventoryPosition` 鍚屾簮锛涜窡鍗?`eta_available` 璇箟锛涘缓璁?metrics 鏋勬垚 | 鍚?SKU 鍋ュ悍涓庡缓璁?effectiveQty 涓€鑷达紱UI 鍙浣嶇疆鎷嗗垎 |
+| **P1** | `lead_time_profiles` + resolver锛汼KU 瑙勫垝椤碉紱寤鸿鍙В閲?UI锛涜窡鍗曢噷绋嬬鏃ユ湡 | 鎹?profile 鍚庡缓璁噺/鏃ユ湡鍙樺寲鍙祴锛涘崟 SKU 椤靛彲鐢?|
+| **P2** | 鏂揣淇鏈夋晥鏃ラ渶姹傦紱`shipments` 杞绘ā鍨?+ 浜哄伐鑺傜偣锛涘欢璇垪琛?| 鏈夋柇璐у彶 SKU 鍥為€€闇€姹傚崌楂橈紱鑺傜偣鍙淮鎶?|
+| **P3** | Z 鍊煎彲閫夌瓥鐣ワ紱瑙勫垝椹鹃┒鑸?KPI锛沞xternal_id 閾洪綈 | 鏂规硶鍒囨崲鏈夐厤缃笌鍗曟祴锛涢┚椹惰埍鍙鑱氬悎 |
+| **P4+** | SAP 闀滃儚閫傞厤锛堝彟寮€璁捐锛?| 鈥?|
+
+宸ョ▼鏃佽矾锛堜笉闃诲鏈富绾匡紝鍙苟琛岋級锛氬簱瀛樻煡璇㈤〉/绯荤粺浠诲姟椤佃矾鐢辨帴閫氥€?+
+---
+
+## 14. 闈炶寖鍥达紙鏈璁℃槑纭笉鍋氾級
+
+- 姝ｅ紡閲囪喘鍗曞鎵规祦銆佷緵搴斿晢闂ㄦ埛  
+- BOM / MRP / `material_requirements` 涓氬姟鍖? 
+- 鑸瑰徃/鎵胯繍鍟嗗疄鏃惰建杩?API  
+- 涓?FOB 缁撶畻妯″潡鍚堝苟  
+- 閲嶅缓棰勬祴宸ヤ綔鍙版垨骞宠瑙勫垝涓绘暟鎹? 
+- 瀹屾暣搴撳瓨娴佹按璐?/ WMS  
+- 鐜伴噾娴併€佷粨瀹广€佷繚璐ㄦ湡鑷姩纭害鏉熷紩鎿? 
+- 鐪熷疄 SAP 鎺ュ彛寮€鍙? 
+
+---
+
+## 15. 涓昏浠ｇ爜钀界偣锛堝疄鏂芥椂鍙傝€冿級
+
+| 鍖哄煙 | 璺緞 |
+|------|------|
+| 鎻愬墠鏈?| `apps/web/server/lib/lead-time-resolver.ts`銆乣replenishment-coverage.ts` |
+| 鍋ュ悍/琛ヨ揣 | `apps/web/server/lib/inventory-health-service.ts`銆乣tasks/replenishmentForecast.ts` |
+| 搴撳瓨浣嶇疆锛堟柊锛?| `apps/web/server/lib/inventory-position.ts`锛? 鍗曟祴锛?|
+| Schema | `packages/db/src/schema/procurement.ts`銆乣warehouses.ts`锛涙柊 `lead-time-profiles` / `shipments` |
+| 璺熷崟 UI | `PurchaseTrackingPage`銆丳MC 璇︽儏 |
+| 寤鸿 UI | `ReorderSuggestionsPage` |
+| 瑙勫垝椤碉紙鏂帮級 | 寤鸿璺敱 `/inventory/planning/:skuId` 鎴?`/pmc/sku/:skuId` |
+| 棰勬祴鍥為€€ | historical avg 璁＄畻澶?+ 鏂揣淇宸ュ叿鍑芥暟 |
+
+---
+
+## 16. 椋庨櫓涓庡紑鏀鹃棶棰?+
+| 椋庨櫓 | 缂撹В |
+|------|------|
+| 椋炰功蹇収涓庤窡鍗曟暟閲忓弻璁?| 榛樿 `drafts_fill_gap`锛沵etrics 鏆撮湶 mode |
+| 鍘嗗彶 `confirmed_delivery_date` 璇箟涓嶆竻 | UI 鏍囨敞锛涙柊瀛楁 `eta_available` 涓轰富 |
+| 鎻愬墠鏈熷垎娈佃繃澶氬鑷存棤浜虹淮鎶?| 閰嶇疆鐢?6 娈碉紝褰曞叆鍙敤 3 娈垫眹鎬绘ā鏉?|
+| 椹鹃┒鑸辫繃鏃╁缓璁惧鑷村彛寰勫啀鏀?| 椹鹃┒鑸辨斁 P3锛孭0 鍏堥攣 position |
+| 鍦ㄤ骇蹇収涓?SKU 绾ч€昏緫浠?| 鐗╃悊浠?position **涓?*鎶?`IN-PRODUCTION` 鍏ㄩ噺鎽婅繘姣忎釜鐩殑浠擄紱鍖哄煙姹犲崟鐙姞涓€娆?fill_gap |
+
+### 16.1 P0 宸查攣瀹氬喅绛?+
+| 椤?| 鍐冲畾 |
+|----|------|
+| 鍘婚噸妯″紡榛樿 | `drafts_fill_gap` |
+| 鐗╃悊浠?`effectiveQty` | `available + transit + production(draft/fill) + confirmedOpen 鈭?reserved`锛堜笉鍚妸鍏ㄥ眬鍦ㄤ骇閲嶅璁″叆姣忎釜浠擄級 |
+| `exception` 寮€鏀鹃噺 | 璁″叆 `confirmedOpen`锛宍sources` 鎵撴爣 `atRisk: true` |
+| 璺熷崟浠撳綊灞?| `pmc_plan_items.warehouse_code` 鈫?鍚﹀垯 `pmc_plans.target_warehouse_code`锛涚殕绌哄垯涓嶈繘鐗╃悊浠?position锛堣鍏?`unassignedOpen` 浠?metrics锛?|
+| `eta_available` | 鏂板垪锛涘啓鍏ユ椂鍚屾 `confirmed_delivery_date`锛涘垪琛ㄥ睍绀轰互 `eta_available` 浼樺厛 |
+| SKU 瑙勫垝椤佃彍鍗?| **P1** 鍐嶅畾锛堝€欓€夛細`/inventory/planning/:skuId`锛?|
+| 鎻愬墠鏈熻繍杈撴柟寮忕淮 | **P1**锛氬彲鍏堝晢瀹?鐩殑浠擄紝杩愯緭鏂瑰紡鍙┖ |
+
+### 16.2 鏈樁娈甸潪鐩爣锛堣竟鐣岋級
+
+P0 **涓嶅寘鍚?*锛歚lead_time_profiles`銆丼KU 瑙勫垝椤?UI銆佸彂杩?`shipments` 琛ㄣ€佹柇璐т慨姝ｃ€乑 鍊煎畨鍏ㄥ簱瀛樸€佽鍒掗┚椹惰埍銆丼AP 鎺ュ彛銆佹寮?PO銆丅OM銆丗OB 鏀归€犮€?+
+---
+
+## 17. Self-review
+
+- 鏃犮€孴BD 绠楁硶鍙﹁銆嶇┖娲烇細P0鈥揚2 琛屼负涓庤〃瀛楁宸插啓娓? 
+- 涓?`mvp-overview`銆屼笉鍋氭寮?PO/BOM銆嶆棤鍐茬獊  
+- 涓嶈姹備竴娆℃€у疄鐜扮敤鎴峰師绋垮叏閮ㄩ〉闈笌 Z 鍊兼ā鍨? 
+- 棰勬祴銆丗OB銆侀涔﹀悓姝ヨ亴璐ｈ竟鐣屽凡鍒掓竻  
+
+---
+
+**瀹炵幇璁″垝**锛歚docs/superpowers/plans/2026-07-29-inventory-planning-boundary-p0.md`锛堣竟鐣岄攣瀹?+ P0锛夈€侾1/P2 鍙﹀紑 plan銆?diff --git a/packages/db/drizzle/0052_purchase_draft_eta_available.sql b/packages/db/drizzle/0052_purchase_draft_eta_available.sql
new file mode 100644
index 0000000..2a213ad
--- /dev/null
+++ b/packages/db/drizzle/0052_purchase_draft_eta_available.sql
@@ -0,0 +1,4 @@
+ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "eta_available" date;
+UPDATE "purchase_drafts"
+SET "eta_available" = "confirmed_delivery_date"
+WHERE "eta_available" IS NULL AND "confirmed_delivery_date" IS NOT NULL;
diff --git a/packages/db/drizzle/meta/_journal.json b/packages/db/drizzle/meta/_journal.json
index ce7f17a..ee6dd78 100644
--- a/packages/db/drizzle/meta/_journal.json
+++ b/packages/db/drizzle/meta/_journal.json
@@ -314,8 +314,22 @@
       "idx": 45,
       "version": "6",
       "when": 1780717058185,
       "tag": "0046_news_intel_menu",
       "breakpoints": true
+    },
+    {
+      "idx": 46,
+      "version": "6",
+      "when": 1785216000000,
+      "tag": "0047_drop_creator_ops_menu",
+      "breakpoints": true
+    },
+    {
+      "idx": 47,
+      "version": "6",
+      "when": 1785216000001,
+      "tag": "0052_purchase_draft_eta_available",
+      "breakpoints": true
     }
   ]
 }
diff --git a/packages/db/src/schema/procurement.ts b/packages/db/src/schema/procurement.ts
index 8fa6ae2..76e8e4c 100644
--- a/packages/db/src/schema/procurement.ts
+++ b/packages/db/src/schema/procurement.ts
@@ -48,10 +48,12 @@ export const purchaseDrafts = pgTable(
     sourceRefId: uuid('source_ref_id'),
     planItemId: uuid('plan_item_id').references(() => pmcPlanItems.id),
     status: purchaseDraftStatusEnum('status').notNull().default('draft'),
     supplierConfirmedAt: timestamp('supplier_confirmed_at', { withTimezone: true }),
     confirmedDeliveryDate: date('confirmed_delivery_date'),
+    /** 棰勮鍙敭鏃ワ紙琛ヨ揣/寤惰涓诲瓧娈碉紱鍐欏叆鏃跺悓姝?confirmedDeliveryDate锛?*/
+    etaAvailable: date('eta_available'),
     actualShipDate: date('actual_ship_date'),
     actualReceivedDate: date('actual_received_date'),
     receivedQty: integer('received_qty').notNull().default(0),
     exceptionReason: text('exception_reason'),
     ownerUserId: uuid('owner_user_id').references(() => users.id),

