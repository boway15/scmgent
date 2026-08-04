# Review Package Task 6
BASE: 563102073c0d27391c44c0ad2ef070cbed184c32
HEAD: 62d273e98b3a49f67e2c1e805b31176d99ca6563

## Commits
62d273e feat: expose eta_available on purchase draft API


## Stat
 apps/web/server/lib/purchase-draft-eta.test.ts | 12 ++++++++++++
 apps/web/server/lib/purchase-draft-eta.ts      |  6 ++++++
 apps/web/server/routes/procurement.ts          | 14 +++++++++++---
 apps/web/src/lib/api.ts                        |  2 ++
 4 files changed, 31 insertions(+), 3 deletions(-)


## Diff
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
@@ -5,16 +5,17 @@ import { requireMenu } from '../lib/rbac.js';
 import { getCurrentUser } from '../lib/auth-context.js';
 import {
   assertPurchaseDraftTransition,
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
 }
 
 export async function createPurchaseDraft(params: {
@@ -72,16 +73,17 @@ function mapDraftRow(row: {
   sourceRefId: string | null;
   planItemId: string | null;
   planId: string | null;
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
   ownerUserId: string | null;
   ownerName: string | null;
   remark: string | null;
@@ -111,16 +113,17 @@ procurementRoutes.get('/purchase-drafts', async (c) => {
       sourceRefId: purchaseDrafts.sourceRefId,
       planItemId: purchaseDrafts.planItemId,
       planId: purchaseDrafts.sourceRefId,
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
       ownerUserId: purchaseDrafts.ownerUserId,
       ownerName: users.name,
       remark: purchaseDrafts.remark,
@@ -154,16 +157,17 @@ procurementRoutes.post('/purchase-drafts', async (c) => {
 });
 
 procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), async (c) => {
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
 
   const [existing] = await db
     .select()
@@ -180,25 +184,29 @@ procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), asy
   }
 
   const patch: Partial<typeof purchaseDrafts.$inferInsert> = {
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
   }
 
   const [row] = await db
diff --git a/apps/web/src/lib/api.ts b/apps/web/src/lib/api.ts
index 3094272..3acce6e 100644
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -1454,16 +1454,17 @@ export const api = {
         id: string;
         draftNo: string;
         skuCode: string;
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
         planItemId?: string | null;
         planNo?: string | null;
         merchantCode?: string | null;
@@ -1474,16 +1475,17 @@ export const api = {
         remark?: string | null;
       }>
     >(`/api/purchase-drafts${status ? `?status=${status}` : ''}`),
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
   receivePurchaseTracking: (
     id: string,
     data: { qtyReceived: number; receivedDate?: string; idempotencyKey?: string },

