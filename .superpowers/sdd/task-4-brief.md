### Task 4: 鍋ュ悍璁＄畻涓庤ˉ璐т换鍔℃敼鐢?position

**Files:**
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Modify: `apps/web/server/lib/inventory-snapshot.ts`锛坄getRegionPoolSnapshot` / `sumEffectiveQtyForWarehouses`锛?- Modify: `apps/web/server/lib/inventory-health-service.test.ts`锛堣嫢鏈夌浉鍏虫柇瑷€鍒欐洿鏂帮紱鍙柊澧?position metrics 鏂█锛?
**Interfaces:**
- Consumes: `resolveInventoryPosition`
- Produces: `SkuHealthRow.effectiveQty` 鏉ヨ嚜 position锛沗metrics.inventoryPosition` 鍚?breakdown

- [ ] **Step 1: Write / extend failing test**

鍦?`inventory-health-service.test.ts` 鎴栨柊寤鸿交閲忔祴璇曪細楠岃瘉 metrics 褰㈢姸鍔╂墜锛堣嫢 compute 闅?mock DB锛屽垯鎶斤級锛?
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

鍗曟祴鏂█璇ュ璞″瓧娈甸綈鍏ㄣ€?
- [ ] **Step 2: Run 鈥?RED**锛堣嫢鍑芥暟灏氭湭瀵煎嚭锛?
- [ ] **Step 3: Wire `computeSkuWarehouseHealth`**

鏇挎崲锛?
```ts
const snapshot = await getLatestInventorySnapshot(...);
// effectiveQty: snapshot.effectiveQty
```

涓猴細

```ts
const position = await resolveInventoryPosition({
  skuId: params.sku.id,
  warehouseCode: params.warehouse.code,
});
// coverage / return 浣跨敤 position.effectiveQty
// metrics 鍚堝苟 buildInventoryPositionMetrics(position) 涓庡師 lead/safety 瀛楁
```

`replenishmentForecast.ts` 涓粨绾?`getLatestInventorySnapshot` 鏀逛负 `resolveInventoryPosition`锛沀S 鍖哄煙姹狅細

```ts
async function resolveRegionPoolEffectiveQty(skuId: string, regionGroup: string): Promise<number> {
  const whRows = await db.select(...).from(warehouses).where(region...);
  let total = 0;
  for (const code of whRows) {
    const pos = await resolveInventoryPosition({ skuId, warehouseCode: code });
    total += pos.effectiveQty;
  }
  // SKU 绾у湪浜э細浠呭綋鍚勪粨 production 涔嬪拰涓?0 鏃?fill_gap 涓€娆?  const inProd = await getLatestInProductionQty(skuId);
  const productionFromWarehouses = /* sum of qtyInProduction from each pos 鈥?track while looping */;
  if (productionFromWarehouses <= 0 && inProd > 0) total += inProd;
  return total;
}
```

鎶婂悓绛夐€昏緫鏀捐繘 `getRegionPoolSnapshot`锛岄伩鍏嶄换鍔′笌蹇収妯″潡鍒嗗弶銆?
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
