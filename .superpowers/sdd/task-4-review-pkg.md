# Review Package Task 4
BASE: 661d882271e0e2bebbfc40c863639090fb71d303
HEAD: b97c26cd54f6cabe004fcf6ad03a28f55a14894e

## Commits
b97c26c feat: drive health and replenishment from inventory position


## Stat
 .../server/lib/inventory-health-service.test.ts    | 45 ++++++++++++++++++++++
 apps/web/server/lib/inventory-health-service.ts    | 15 ++++++--
 apps/web/server/lib/inventory-position.test.ts     | 24 ++++++++++++
 apps/web/server/lib/inventory-position.ts          | 30 +++++++++++++++
 apps/web/server/lib/inventory-snapshot.ts          | 32 +++++++++------
 apps/web/server/tasks/replenishmentForecast.ts     | 15 ++++----
 6 files changed, 138 insertions(+), 23 deletions(-)


## Diff
diff --git a/apps/web/server/lib/inventory-health-service.test.ts b/apps/web/server/lib/inventory-health-service.test.ts
index e7e2a64..ddbe66e 100644
--- a/apps/web/server/lib/inventory-health-service.test.ts
+++ b/apps/web/server/lib/inventory-health-service.test.ts
@@ -1,14 +1,59 @@
 import assert from 'node:assert/strict';
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
 
 assert.equal(healthToExceptionType('blue', null), 'overstock');
 assert.equal(healthToExceptionType('gray', '鍋滃敭'), 'lifecycle_eol');
diff --git a/apps/web/server/lib/inventory-health-service.ts b/apps/web/server/lib/inventory-health-service.ts
index ce18ec9..a443d18 100644
--- a/apps/web/server/lib/inventory-health-service.ts
+++ b/apps/web/server/lib/inventory-health-service.ts
@@ -10,17 +10,20 @@ import {
   spus,
 } from '@scm/db';
 import { calcReplenishment } from './replenishment.js';
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
 
 export type SkuHealthRow = {
   skuId: string;
@@ -82,17 +85,20 @@ export async function computeSkuWarehouseHealth(params: {
 
   const eoqCalc = calcReplenishment({
     sales: whSales,
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
         map: new Map<string, number>(),
         lifecycle: undefined,
         versionId: null,
@@ -103,17 +109,17 @@ export async function computeSkuWarehouseHealth(params: {
       });
     }
   }
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
     safetyStockDays: policy?.safetyStockDays ?? undefined,
     targetCoverageDays: policy?.targetCoverageDays ?? undefined,
     overstockThresholdDays: policy?.overstockThresholdDays ?? undefined,
@@ -129,17 +135,17 @@ export async function computeSkuWarehouseHealth(params: {
   return {
     skuId: params.sku.id,
     skuCode: params.sku.code,
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
     latestOrderDays: coverage.latestOrderDays,
     lifecycle: forecastEntry.lifecycle,
     needsReplenishment: coverage.needsReplenishment,
@@ -149,16 +155,17 @@ export async function computeSkuWarehouseHealth(params: {
       productionDays: coverage.leadTime.productionDays,
       shippingDays: coverage.leadTime.shippingDays,
       inboundBufferDays: coverage.leadTime.inboundBufferDays,
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
 
 export async function computeAllInventoryHealth(): Promise<SkuHealthRow[]> {
   const spuMoqMap = new Map(
     (await db.select({ id: spus.id, moq: spus.moq }).from(spus)).map((s) => [s.id, s.moq]),
diff --git a/apps/web/server/lib/inventory-position.test.ts b/apps/web/server/lib/inventory-position.test.ts
index fcd9416..a11de6a 100644
--- a/apps/web/server/lib/inventory-position.test.ts
+++ b/apps/web/server/lib/inventory-position.test.ts
@@ -1,12 +1,13 @@
 import assert from 'node:assert/strict';
 import { describe, it } from 'node:test';
 import {
   aggregateDraftBucketsForWarehouse,
+  effectiveQtyWithProductionFallback,
   mapDraftStatusToBucket,
   mergeInventoryPosition,
   normalizeSnapshotForWarehouse,
   openDraftQty,
 } from './inventory-position.js';
 
 describe('inventory-position pure', () => {
   it('maps draft statuses to buckets', () => {
@@ -117,9 +118,32 @@ describe('inventory-position pure', () => {
       },
       draftBuckets: { inProduction: 50, inTransit: 20, confirmedOpen: 10 },
     });
     assert.equal(result.qtyInProduction, 55);
     assert.equal(result.qtyInTransit, 30);
     assert.equal(result.qtyConfirmedOpen, 10);
     assert.equal(result.effectiveQty, 100 + 55 + 30 + 10);
   });
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
 });
diff --git a/apps/web/server/lib/inventory-position.ts b/apps/web/server/lib/inventory-position.ts
index 29b285c..34079eb 100644
--- a/apps/web/server/lib/inventory-position.ts
+++ b/apps/web/server/lib/inventory-position.ts
@@ -43,16 +43,46 @@ export type InventoryPositionBreakdown = {
 export type DraftOpenLine = {
   draftId: string;
   status: string;
   openQty: number;
   warehouseCode: string | null;
   atRisk?: boolean;
 };
 
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
 type InventoryPositionSnapshot = {
   qtyAvailable: number;
   qtyInTransit: number;
   qtyInProduction: number;
   qtyReserved: number;
 };
 
 export function normalizeSnapshotForWarehouse(
diff --git a/apps/web/server/lib/inventory-snapshot.ts b/apps/web/server/lib/inventory-snapshot.ts
index 6bf27cc..3124f24 100644
--- a/apps/web/server/lib/inventory-snapshot.ts
+++ b/apps/web/server/lib/inventory-snapshot.ts
@@ -1,11 +1,16 @@
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
   qtyInProduction: number;
   /** 鏈粨鍙敭 + 鍦ㄩ€旓紙涓嶅惈鍦ㄤ骇锛?*/
   localEffectiveQty: number;
@@ -65,46 +70,49 @@ export async function getLatestInventorySnapshot(
     localEffectiveQty,
     effectiveQty: localEffectiveQty,
   };
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
     .select({ code: warehouses.code })
     .from(warehouses)
     .where(eq(warehouses.isActive, true));
diff --git a/apps/web/server/tasks/replenishmentForecast.ts b/apps/web/server/tasks/replenishmentForecast.ts
index d4c1c93..960565a 100644
--- a/apps/web/server/tasks/replenishmentForecast.ts
+++ b/apps/web/server/tasks/replenishmentForecast.ts
@@ -4,20 +4,18 @@ import {
   skus,
   reorderSuggestions,
   safetyStockConfig,
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
 import {
   normalizeReplenishLight,
   shouldReplenishByLight,
@@ -195,22 +193,25 @@ export async function runReplenishmentForecast() {
 
     for (const wh of whRows) {
       const health = healthRows.find(
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
       }
 
       let suggestedQty = coverage.suggestedQty;
@@ -228,17 +229,17 @@ export async function runReplenishmentForecast() {
       const poolNote =
         wh.regionGroup === 'US'
           ? `US浠撶綉瑕嗙洊 ${Number.isFinite(usNetworkCoverage) ? usNetworkCoverage.toFixed(1) : '鈭?} 澶ー
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
       const reason =
         health.demandSource === 'forecast'
           ? `${reasonBase}锛岄渶姹傚彛寰勶細鏈堝害棰勬祴鏃ュ潎`

