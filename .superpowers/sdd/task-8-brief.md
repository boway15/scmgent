### Task 8: P0 楠屾敹鍥炲綊

**Files:** 鏃犳柊鏂囦欢锛堣窇娴?+ 瀵圭収 spec锛?
- [ ] **Step 1: 璺戠浉鍏冲崟娴?*

```bash
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/purchase-draft-eta.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-light.test.ts
```

Expected: all PASS

- [ ] **Step 2: 瀵圭収 spec 搂1.4 / 搂16.1 楠屾敹娓呭崟**

| 楠屾敹椤?| 鍒ゅ畾 |
|--------|------|
| 鍋ュ悍涓庤ˉ璐т娇鐢ㄥ悓涓€ `resolveInventoryPosition` | 浠ｇ爜鏃犵洿鎺ョ敤 `snapshot.effectiveQty` 浣滀负浠撶骇涓诲彛寰?|
| metrics 鍚?position breakdown | `metrics.inventoryPosition` 瀛樺湪 |
| 榛樿 `drafts_fill_gap` | merge 榛樿鍊?|
| 鐗╃悊浠撲笉閲嶅鎽婂叏鐞冨湪浜?| resolve 鐗╃悊浠撹矾寰勬棤 `getLatestInProductionQty` 璁″叆 |
| `eta_available` 鍙鍐欎笖鍚屾鏃у瓧娈?| API + UI |
| 鏈仛 P1+ 鑼冨洿 | 鏃?lead_time_profiles / shipments 琛?|

- [ ] **Step 3: 鑻ユ湁缂哄彛锛屼慨瀹屽啀鎻愪氦锛涙棤浠ｇ爜鍒欒烦杩?commit**

---
