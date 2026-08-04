### Task 5: 规划驾驶舱聚合服�?
**Files:**
- Create: `apps/web/server/lib/planning-dashboard.ts`
- Create: `apps/web/server/lib/planning-dashboard.test.ts`（纯聚合�?SQL mock�?
**KPI 输出（只读）�?*

```ts
type PlanningDashboard = {
  skuActiveCount: number;
  healthRedCount: number;      // 未来断货风险近似：health red
  healthYellowCount: number;
  belowRopCount: number;       // from alerts or health
  pendingSuggestions: number;
  delayedShipments: number;
  delayedDraftsEtaAvailable: number; // eta_available < today & not received
  stockoutRateApprox?: number; // optional: red/active
  forecastHighMapeCount?: number; // reuse dashboard forecastContext if easy
  inventoryTurnoverDaysApprox?: number | null; // optional skip if no amount data
  calculatedAt: string;
};
```

数据来源：`inventory_health_snapshots` 最新、`reorder_suggestions` pending、`shipments` delay helper、`purchase_drafts`�?
- [ ] **Step 1: Implement aggregator + tests where pure**

- [ ] **Step 2: Commit** `feat: aggregate planning dashboard KPIs`

---
