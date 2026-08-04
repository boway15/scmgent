### Task 9: P1 楠屾敹鍥炲綊

- [ ] **Step 1: 璺戞祴**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/lead-time-resolver.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
```

- [ ] **Step 2: 鎵嬪伐娓呭崟**

| 椤?| 鍒ゅ畾 |
|----|------|
| 鏂板缓 profile锛堝晢瀹?浠擄級鍚庨噸璺戣ˉ璐э紝totalLeadDays/寤鸿鏃ュ彉鍖?| |
| 寤鸿銆屾煡鐪嬩緷鎹€嶅惈浣嶇疆鏋勬垚涓庡垎娈垫彁鍓嶆湡 | |
| `/inventory/planning/:skuId` 灞曠ず鍚屾簮 effectiveQty | |
| 璺熷崟鍙紪杈?etd/eta_port/eta_warehouse锛屽彲鍞棩浠嶄富瀛楁 | |
| 鏃?shipments / 鏂揣淇 / Z 鍊间唬鐮佹贩鍏?| |

- [ ] **Step 3: 鏇存柊璁捐 搂13 P1 鐘舵€佷负銆屽凡瀹炵幇銆嶄竴琛屽娉紙鍙€?commit docs锛?*

---
