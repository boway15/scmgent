# Review P1 Task1
BASE: c92b1e463855558d665164cdbf0f0a2a7474fc31
HEAD: a7b8296bff6cd97573aa3389141c69b2f8b72c0c
## Commits
a7b8296 feat: extend lead time breakdown to six segments with compat aliases

## Stat
 apps/web/server/lib/replenishment-coverage.test.ts | 26 +++++++++++
 apps/web/server/lib/replenishment-coverage.ts      | 50 ++++++++++++++++++++--
 2 files changed, 72 insertions(+), 4 deletions(-)

## Diff
diff --git a/apps/web/server/lib/replenishment-coverage.test.ts b/apps/web/server/lib/replenishment-coverage.test.ts
index 2e3a015..004823d 100644
--- a/apps/web/server/lib/replenishment-coverage.test.ts
+++ b/apps/web/server/lib/replenishment-coverage.test.ts
@@ -22,16 +22,42 @@ describe('replenishment-coverage', () => {
     const lead = calcTotalLeadTime({
       productionDays: DEFAULT_PRODUCTION_LEAD_DAYS,
       shippingDays: 45,
       inboundBufferDays: 7,
     });
     assert.equal(lead.totalLeadDays, 102);
   });
 
+  it('sums six segments and sets compat aliases', () => {
+    const lt = calcTotalLeadTime({
+      productionDays: 25,
+      domesticDays: 3,
+      bookingDays: 7,
+      transitDays: 35,
+      customsDays: 5,
+      inboundDays: 3,
+    });
+    assert.equal(lt.totalLeadDays, 78);
+    assert.equal(lt.shippingDays, 47); // 7+35+5
+    assert.equal(lt.inboundBufferDays, 3);
+  });
+
+  it('accepts legacy shippingDays + inboundBufferDays', () => {
+    const lt = calcTotalLeadTime({
+      productionDays: 50,
+      shippingDays: 45,
+      inboundBufferDays: 7,
+    });
+    assert.equal(lt.transitDays, 45);
+    assert.equal(lt.bookingDays, 0);
+    assert.equal(lt.customsDays, 0);
+    assert.equal(lt.totalLeadDays, 102);
+  });
+
   it('marks red when coverage is below total lead time', () => {
     const health = calcInventoryHealth({
       coverageDays: 90,
       totalLeadDays: 102,
       safetyStockDays: 14,
       overstockThresholdDays: 180,
     });
     assert.equal(health, 'red');
diff --git a/apps/web/server/lib/replenishment-coverage.ts b/apps/web/server/lib/replenishment-coverage.ts
index 4d4a327..86af4d5 100644
--- a/apps/web/server/lib/replenishment-coverage.ts
+++ b/apps/web/server/lib/replenishment-coverage.ts
@@ -32,19 +32,27 @@ export const DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE: Record<string, number> = {
   'US-SOUTH': 60,
   'US-SOUTHEAST': 60,
   DE: 80,
   UK: 75,
 };
 
 export type LeadTimeBreakdown = {
   productionDays: number;
+  domesticDays: number;
+  bookingDays: number;
+  transitDays: number;
+  customsDays: number;
+  inboundDays: number;
+  /** compat = booking + transit + customs */
   shippingDays: number;
+  /** compat = inboundDays */
   inboundBufferDays: number;
   totalLeadDays: number;
+  profileId?: string | null;
 };
 
 export function resolveShippingLeadDays(warehouseCode: string, configured?: number | null): number {
   if (configured != null && configured > 0) return configured;
   return DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE[warehouseCode] ?? 60;
 }
 
 export function resolveProductionLeadDays(
@@ -53,27 +61,61 @@ export function resolveProductionLeadDays(
   for (const value of candidates) {
     if (value != null && value > 0) return value;
   }
   return DEFAULT_PRODUCTION_LEAD_DAYS;
 }
 
 export function calcTotalLeadTime(params: {
   productionDays: number;
-  shippingDays: number;
+  domesticDays?: number;
+  bookingDays?: number;
+  transitDays?: number;
+  customsDays?: number;
+  inboundDays?: number;
+  /** legacy: if provided without booking/transit/customs, treat as transitDays */
+  shippingDays?: number;
   inboundBufferDays?: number;
 }): LeadTimeBreakdown {
   const productionDays = Math.max(0, params.productionDays);
-  const shippingDays = Math.max(0, params.shippingDays);
-  const inboundBufferDays = Math.max(0, params.inboundBufferDays ?? DEFAULT_INBOUND_BUFFER_DAYS);
+  const domesticDays = Math.max(0, params.domesticDays ?? 0);
+
+  let bookingDays = Math.max(0, params.bookingDays ?? 0);
+  let transitDays = Math.max(0, params.transitDays ?? 0);
+  let customsDays = Math.max(0, params.customsDays ?? 0);
+
+  const hasExplicitShippingSegments =
+    params.bookingDays != null || params.transitDays != null || params.customsDays != null;
+
+  if (!hasExplicitShippingSegments && params.shippingDays != null) {
+    transitDays = Math.max(0, params.shippingDays);
+    bookingDays = 0;
+    customsDays = 0;
+  }
+
+  const inboundDays = Math.max(
+    0,
+    params.inboundDays ?? params.inboundBufferDays ?? DEFAULT_INBOUND_BUFFER_DAYS,
+  );
+
+  const shippingDays = bookingDays + transitDays + customsDays;
+  const inboundBufferDays = inboundDays;
+  const totalLeadDays =
+    productionDays + domesticDays + bookingDays + transitDays + customsDays + inboundDays;
+
   return {
     productionDays,
+    domesticDays,
+    bookingDays,
+    transitDays,
+    customsDays,
+    inboundDays,
     shippingDays,
     inboundBufferDays,
-    totalLeadDays: productionDays + shippingDays + inboundBufferDays,
+    totalLeadDays,
   };
 }
 
 export function calcCoverageDays(effectiveQty: number, avgDaily: number): number {
   if (avgDaily <= 0) return effectiveQty > 0 ? Number.POSITIVE_INFINITY : 0;
   return effectiveQty / avgDaily;
 }
 

