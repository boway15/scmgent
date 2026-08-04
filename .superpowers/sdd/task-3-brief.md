### Task 3: `resolveInventoryPosition`锛堣搴擄級

**Files:**
- Modify: `apps/web/server/lib/inventory-position.ts`
- Modify: `apps/web/server/lib/inventory-position.test.ts`锛堝彲缁х画绾嚱鏁帮紱DB 璺緞鐢ㄥ彲娉ㄥ叆 loader 鍋氬崟娴嬶紝閬垮厤寮轰緷璧栫湡瀹?PG锛?
**Interfaces:**
- Consumes: `mapDraftStatusToBucket`, `openDraftQty`, `mergeInventoryPosition`
- Consumes: `inventoryRecords`, `purchaseDrafts`, `pmcPlanItems`, `pmcPlans`锛堟垨娉ㄥ叆锛?- Produces:

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

- [ ] **Step 2: Run test 鈥?RED**

- [ ] **Step 3: Implement aggregate + resolve**

`aggregateDraftBucketsForWarehouse`锛氬 `warehouseCode` 鍖归厤鐨勮鎸?bucket 绱姞锛沗warehouseCode == null` 绱姞鍒?`unassignedOpenQty`锛堜笉杩涜浠?buckets锛夈€?
`resolveInventoryPosition`锛?
1. 鑻?`warehouseCode === 'IN-PRODUCTION'`锛氬彧璇诲湪浜т粨 snapshot锛坄getLatestInProductionQty` / records锛夛紝drafts 涓嶈锛沗effectiveQty = qtyInProduction`銆?2. 鍚﹀垯璇昏浠撴渶鏂?`inventory_records`锛坅vailable / transit / reserved锛涚敓浜у瓧娈甸€氬父 0锛夈€?3. 鏌ヨ璇?SKU 寮€鏀捐窡鍗曪細`status not in (received, cancelled)`锛宍openQty = qty - receivedQty > 0`锛宩oin `planItem` / `plan` 瑙ｆ瀽浠撱€?4. `aggregateDraftBucketsForWarehouse` 鈫?`mergeInventoryPosition`銆?5. 鐗╃悊浠?**涓嶈** 鎶?`IN-PRODUCTION` snapshot 鍔犺繘缁撴灉锛堝尯鍩熸睜鍦?Task 4 澶勭悊锛夈€?
鏌ヨ绀烘剰锛?
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

- [ ] **Step 4: Run tests 鈥?GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-position.ts apps/web/server/lib/inventory-position.test.ts
git commit -m "$(cat <<'EOF'
feat: resolve inventory position from snapshot and purchase drafts

EOF
)"
```

---
