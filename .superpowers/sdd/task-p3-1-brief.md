### Task 1: Z 值纯函数 + 单测

**Files:**
- Create: `apps/web/server/lib/safety-stock-z.ts`
- Create: `apps/web/server/lib/safety-stock-z.test.ts`

**Interfaces:**

```ts
export type SafetyStockMethod = 'coverage_days' | 'z_demand' | 'z_demand_leadtime';

export function zFromServiceLevel(serviceLevel: number): number; // 0.9�?.28 etc; unknown �?throw or nearest

export function calcSafetyStockQty(params: {
  method: SafetyStockMethod;
  serviceLevel?: number; // 0.95 default when z_*
  demandStdDev: number;  // 日需求标准差
  totalLeadDays: number;
  avgDaily?: number;
  leadTimeStdDev?: number;
  safetyStockDays?: number; // coverage path
}): { safetyStockQty: number; z?: number; method: SafetyStockMethod };
```

- coverage_days：`ceil(avgDaily * safetyStockDays)`（avgDaily 缺则 0�?- z_demand：`ceil(Z * demandStdDev * sqrt(L))`
- z_demand_leadtime：`ceil(Z * sqrt(L*σ_d² + μ²*σ_L²))`

- [ ] **Step 1: TDD tests for table + formulas**

- [ ] **Step 2: Implement �?GREEN**

- [ ] **Step 3: Commit** `feat: add optional Z-value safety stock calculator`

---
