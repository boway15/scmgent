# Review P1 Task3
BASE: 42a36a502d515d01e6dfeb18f476f4c2d415ab81
HEAD: bfec1bd3f70861ecc5c7ea4bf2537009b7e5ebe3
## Commits
bfec1bd feat: resolve lead time from lead_time_profiles with legacy fallback

## Stat
 .superpowers/sdd/task-p1-3-report.md           |  17 +++
 apps/web/server/lib/lead-time-resolver.test.ts | 163 +++++++++++++++++++++++++
 apps/web/server/lib/lead-time-resolver.ts      |  81 +++++++++++-
 3 files changed, 260 insertions(+), 1 deletion(-)

## Diff
diff --git a/.superpowers/sdd/task-p1-3-report.md b/.superpowers/sdd/task-p1-3-report.md
new file mode 100644
index 0000000..1a973f7
--- /dev/null
+++ b/.superpowers/sdd/task-p1-3-report.md
@@ -0,0 +1,17 @@
+# Task P1-3 Report: lead-time profile resolver
+
+**Status:** Done  
+**Branch:** feat/inventory-planning-p1  
+**Commit:** `feat: resolve lead time from lead_time_profiles with legacy fallback`
+
+## Deliverables
+- Added pure `pickLeadTimeProfile` with the four-level merchant/warehouse/mode priority.
+- `resolveLeadTimeForSkuWarehouse` now accepts optional `transportMode` and resolves active default profiles into the six-segment breakdown.
+- Legacy merchant/SKU supplier/warehouse/constants resolution remains the fallback and returns `profileId: null`.
+- Added `lead-time-resolver.test.ts` covering profile priority and no-match fallback.
+- No Feishu-synced list page or mapper was changed.
+
+## Verification
+- Resolver + replenishment lead-time tests: 17 passed.
+- Targeted strict TypeScript check: passed.
+- Full server typecheck remains blocked by pre-existing errors outside Task P1-3; no error references the changed resolver files.
diff --git a/apps/web/server/lib/lead-time-resolver.test.ts b/apps/web/server/lib/lead-time-resolver.test.ts
new file mode 100644
index 0000000..8772296
--- /dev/null
+++ b/apps/web/server/lib/lead-time-resolver.test.ts
@@ -0,0 +1,163 @@
+import assert from 'node:assert/strict';
+import { describe, it } from 'node:test';
+import * as leadTimeResolver from './lead-time-resolver.js';
+
+type ProfileRow = {
+  id: string;
+  merchantCode: string | null;
+  destinationWarehouseCode: string;
+  transportMode: string | null;
+  productionDays: number;
+  domesticDays: number;
+  bookingDays: number;
+  transitDays: number;
+  customsDays: number;
+  inboundDays: number;
+};
+
+type PickProfile = (
+  rows: ProfileRow[],
+  params: {
+    merchantCode?: string | null;
+    warehouseCode: string;
+    transportMode?: string | null;
+  },
+) => ProfileRow | undefined;
+
+const zeros = {
+  domesticDays: 0,
+  bookingDays: 0,
+  transitDays: 0,
+  customsDays: 0,
+  inboundDays: 0,
+};
+
+describe('lead-time-resolver', () => {
+  const pickLeadTimeProfile = Reflect.get(
+    leadTimeResolver,
+    'pickLeadTimeProfile',
+  ) as PickProfile | undefined;
+
+  it('exports the profile picker', () => {
+    assert.equal(typeof pickLeadTimeProfile, 'function');
+  });
+
+  it('prefers merchant+warehouse+mode over merchant+warehouse', () => {
+    assert.ok(pickLeadTimeProfile);
+    const picked = pickLeadTimeProfile(
+      [
+        {
+          id: 'a',
+          merchantCode: 'M1',
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: null,
+          productionDays: 20,
+          ...zeros,
+        },
+        {
+          id: 'b',
+          merchantCode: 'M1',
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: 'fcl',
+          productionDays: 25,
+          ...zeros,
+        },
+      ],
+      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'fcl' },
+    );
+
+    assert.equal(picked?.id, 'b');
+  });
+
+  it('falls back from merchant profile to warehouse default profile', () => {
+    assert.ok(pickLeadTimeProfile);
+    const picked = pickLeadTimeProfile(
+      [
+        {
+          id: 'warehouse-mode',
+          merchantCode: null,
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: 'air',
+          productionDays: 12,
+          ...zeros,
+        },
+        {
+          id: 'warehouse-generic',
+          merchantCode: null,
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: null,
+          productionDays: 18,
+          ...zeros,
+        },
+      ],
+      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'air' },
+    );
+
+    assert.equal(picked?.id, 'warehouse-mode');
+  });
+
+  it('prefers merchant generic profile over warehouse mode profile', () => {
+    assert.ok(pickLeadTimeProfile);
+    const picked = pickLeadTimeProfile(
+      [
+        {
+          id: 'warehouse-mode',
+          merchantCode: null,
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: 'air',
+          productionDays: 12,
+          ...zeros,
+        },
+        {
+          id: 'merchant-generic',
+          merchantCode: 'M1',
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: null,
+          productionDays: 18,
+          ...zeros,
+        },
+      ],
+      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'air' },
+    );
+
+    assert.equal(picked?.id, 'merchant-generic');
+  });
+
+  it('uses warehouse generic profile when merchant and mode profiles are absent', () => {
+    assert.ok(pickLeadTimeProfile);
+    const picked = pickLeadTimeProfile(
+      [
+        {
+          id: 'warehouse-generic',
+          merchantCode: null,
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: null,
+          productionDays: 18,
+          ...zeros,
+        },
+      ],
+      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'air' },
+    );
+
+    assert.equal(picked?.id, 'warehouse-generic');
+  });
+
+  it('returns undefined when no profile matches so legacy resolution can run', () => {
+    assert.ok(pickLeadTimeProfile);
+    const picked = pickLeadTimeProfile(
+      [
+        {
+          id: 'other-warehouse',
+          merchantCode: 'M1',
+          destinationWarehouseCode: 'US-EAST',
+          transportMode: null,
+          productionDays: 20,
+          ...zeros,
+        },
+      ],
+      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: null },
+    );
+
+    assert.equal(picked, undefined);
+  });
+});
diff --git a/apps/web/server/lib/lead-time-resolver.ts b/apps/web/server/lib/lead-time-resolver.ts
index 1ee29d2..e7aa0ff 100644
--- a/apps/web/server/lib/lead-time-resolver.ts
+++ b/apps/web/server/lib/lead-time-resolver.ts
@@ -1,8 +1,8 @@
 import { eq, and } from 'drizzle-orm';
-import { db, merchants, skuSuppliers, warehouses } from '@scm/db';
+import { db, leadTimeProfiles, merchants, skuSuppliers, warehouses } from '@scm/db';
 import {
   DEFAULT_INBOUND_BUFFER_DAYS,
   resolveProductionLeadDays,
   resolveShippingLeadDays,
   calcTotalLeadTime,
   type LeadTimeBreakdown,
@@ -10,18 +10,96 @@ import {
 
 export type ResolvedLeadTime = LeadTimeBreakdown & {
   merchantCode?: string | null;
   warehouseCode: string;
 };
 
+export type LeadTimeProfileRow = {
+  id: string;
+  merchantCode: string | null;
+  destinationWarehouseCode: string;
+  transportMode: string | null;
+  productionDays: number;
+  domesticDays: number;
+  bookingDays: number;
+  transitDays: number;
+  customsDays: number;
+  inboundDays: number;
+};
+
+export function pickLeadTimeProfile(
+  rows: readonly LeadTimeProfileRow[],
+  params: {
+    merchantCode?: string | null;
+    warehouseCode: string;
+    transportMode?: string | null;
+  },
+): LeadTimeProfileRow | undefined {
+  const mode = params.transportMode || null;
+  const merchantCode = params.merchantCode || null;
+  const matches = (candidateMerchant: string | null, candidateMode: string | null) =>
+    rows.find(
+      (row) =>
+        row.destinationWarehouseCode === params.warehouseCode &&
+        row.merchantCode === candidateMerchant &&
+        row.transportMode === candidateMode,
+    );
+
+  return (
+    (merchantCode && mode ? matches(merchantCode, mode) : undefined) ??
+    (merchantCode ? matches(merchantCode, null) : undefined) ??
+    (mode ? matches(null, mode) : undefined) ??
+    matches(null, null)
+  );
+}
+
 export async function resolveLeadTimeForSkuWarehouse(params: {
   skuId: string;
   merchantCode?: string | null;
   warehouseCode: string;
   skuLeadTimeDays?: number | null;
+  transportMode?: string | null;
 }): Promise<ResolvedLeadTime> {
+  const profileRows = await db
+    .select({
+      id: leadTimeProfiles.id,
+      merchantCode: leadTimeProfiles.merchantCode,
+      destinationWarehouseCode: leadTimeProfiles.destinationWarehouseCode,
+      transportMode: leadTimeProfiles.transportMode,
+      productionDays: leadTimeProfiles.productionDays,
+      domesticDays: leadTimeProfiles.domesticDays,
+      bookingDays: leadTimeProfiles.bookingDays,
+      transitDays: leadTimeProfiles.transitDays,
+      customsDays: leadTimeProfiles.customsDays,
+      inboundDays: leadTimeProfiles.inboundDays,
+    })
+    .from(leadTimeProfiles)
+    .where(
+      and(
+        eq(leadTimeProfiles.destinationWarehouseCode, params.warehouseCode),
+        eq(leadTimeProfiles.isDefault, true),
+      ),
+    );
+  const profile = pickLeadTimeProfile(profileRows, params);
+
+  if (profile) {
+    return {
+      ...calcTotalLeadTime({
+        productionDays: profile.productionDays,
+        domesticDays: profile.domesticDays,
+        bookingDays: profile.bookingDays,
+        transitDays: profile.transitDays,
+        customsDays: profile.customsDays,
+        inboundDays: profile.inboundDays,
+      }),
+      profileId: profile.id,
+      merchantCode: params.merchantCode,
+      warehouseCode: params.warehouseCode,
+    };
+  }
+
   let productionDays = resolveProductionLeadDays(params.skuLeadTimeDays);
 
   if (params.merchantCode) {
     const [merchant] = await db
       .select({ productionLeadDays: merchants.productionLeadDays })
       .from(merchants)
@@ -65,10 +143,11 @@ export async function resolveLeadTimeForSkuWarehouse(params: {
     shippingDays,
     inboundBufferDays: warehouse?.inboundBufferDays ?? DEFAULT_INBOUND_BUFFER_DAYS,
   });
 
   return {
     ...breakdown,
+    profileId: null,
     merchantCode: params.merchantCode,
     warehouseCode: params.warehouseCode,
   };
 }

