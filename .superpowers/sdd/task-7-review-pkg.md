# Review Package Task 7
BASE: 62d273e98b3a49f67e2c1e805b31176d99ca6563
HEAD: aab76135cde34fa3a2cf793eedc2fdb7db75687a

## Commits
aab7613 feat: capture sellable ETA on purchase tracking UI


## Stat
 apps/web/src/pages/PurchaseTrackingPage.tsx | 86 +++++++++++++++++++++++++++--
 1 file changed, 81 insertions(+), 5 deletions(-)


## Diff
diff --git a/apps/web/src/pages/PurchaseTrackingPage.tsx b/apps/web/src/pages/PurchaseTrackingPage.tsx
index 9b66be8..6b7fa19 100644
--- a/apps/web/src/pages/PurchaseTrackingPage.tsx
+++ b/apps/web/src/pages/PurchaseTrackingPage.tsx
@@ -14,56 +14,68 @@ const STATUS_LABEL: Record<PurchaseDraftStatus, string> = {
   ready_to_ship: '寰呭彂璐?,
   in_transit: '鍦ㄩ€?,
   partial_received: '閮ㄥ垎鍒拌揣',
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
   exception: [{ label: '鎭㈠宸茬‘璁?, status: 'confirmed' }],
 };
 
 export function PurchaseTrackingPage() {
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
       qc.invalidateQueries({ queryKey: ['purchase-tracking'] });
       qc.invalidateQueries({ queryKey: ['dashboard'] });
     },
@@ -86,33 +98,34 @@ export function PurchaseTrackingPage() {
   return (
     <div className="space-y-6">
       <PageHeader title="閲囪喘璺熷崟" />
       <Card>
         <CardHeader>
           <CardTitle>璺熷崟鍒楄〃</CardTitle>
           <p className="text-sm text-text-sub">
             鍐呴儴灞ョ害鍙拌处锛岄潪姝ｅ紡閲囪喘鍗曘€傜‘璁や氦鏈?鈫?鐢熶骇 鈫?鍙戣揣 鈫?鍦ㄩ€?鈫?鐧昏鍒拌揣鍥炲啓搴撳瓨銆?+            浜ゆ湡/鏃ユ湡琛ㄧず棰勮鍙敭鏃ワ紙鍒颁粨涓婃灦鍚庡彲鍞級锛屼笉鏄埌娓棩銆?             鏁版嵁鏉ヨ嚜{' '}
             <Link to="/pmc/list" className="text-primary hover:underline">
               璁″垝鍒楄〃
             </Link>
             涓凡纭鐨勮鍒掋€?           </p>
         </CardHeader>
         <CardContent>
           <table className="w-full text-sm">
             <thead>
               <tr className="border-b border-border text-left text-text-sub">
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
               {records.map((d) => {
                 const actions = NEXT_ACTION[d.status] ?? [];
                 const canReceive = ['in_transit', 'partial_received', 'ready_to_ship', 'in_production', 'confirmed'].includes(
@@ -133,25 +146,88 @@ export function PurchaseTrackingPage() {
                     <td className="p-2">{d.merchantName ?? d.merchantCode ?? '-'}</td>
                     <td className="p-2">{d.skuCode}</td>
                     <td className="p-2 font-numeric">
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
                             disabled={updateStatus.isPending}
                             onClick={() => updateStatus.mutate({ id: d.id, status: a.status })}
                           >

