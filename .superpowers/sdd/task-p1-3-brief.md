### Task 3: `resolveLeadTimeForSkuWarehouse` 鎺ュ叆 profile

**Files:**
- Modify: `apps/web/server/lib/lead-time-resolver.ts`
- Create: `apps/web/server/lib/lead-time-resolver.test.ts`

**Interfaces:**
- Consumes: `leadTimeProfiles`, `calcTotalLeadTime`
- Produces: `ResolvedLeadTime`锛堝惈 6 娈?+ `profileId`锛?- Params 澧炲姞鍙€?`transportMode?: string | null`

鍖归厤椤哄簭锛堝疄鐜颁负绾嚱鏁?`pickLeadTimeProfile(rows, { merchantCode, warehouseCode, transportMode })` 渚夸簬鍗曟祴锛夛細

1. merchant + warehouse + mode锛坢ode 闈炵┖鏃讹級
2. merchant + warehouse + mode IS NULL
3. merchant IS NULL + warehouse + mode锛堜粨榛樿锛?4. merchant IS NULL + warehouse + mode IS NULL
5. 鍥為€€鐜版湁 merchants/skuSuppliers/warehouses/甯搁噺璺緞锛宍profileId: null`

- [ ] **Step 1: 鍗曟祴 pick + 鍥為€€**

```ts
it('prefers merchant+warehouse+mode over merchant+warehouse', () => {
  const picked = pickLeadTimeProfile(
    [
      { id: 'a', merchantCode: 'M1', destinationWarehouseCode: 'US-WEST', transportMode: null, productionDays: 20, ...zeros },
      { id: 'b', merchantCode: 'M1', destinationWarehouseCode: 'US-WEST', transportMode: 'fcl', productionDays: 25, ...zeros },
    ],
    { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'fcl' },
  );
  assert.equal(picked?.id, 'b');
});
```

- [ ] **Step 2: RED 鈫?瀹炵幇 鈫?GREEN**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: resolve lead time from lead_time_profiles with legacy fallback

EOF
)"
```

---
