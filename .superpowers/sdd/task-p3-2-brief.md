### Task 2: Schema �?safety_stock_config 扩展

**Files:**
- Modify: `packages/db/src/schema/inventory.ts` (`safetyStockConfig`)
- Create: `packages/db/drizzle/0059_safety_stock_method.sql`
- journal

**Columns:**

```text
safety_stock_method varchar/enum default 'coverage_days'
service_level numeric(4,3) nullable  -- e.g. 0.950
demand_std_dev numeric nullable
lead_time_std_dev numeric nullable
```

- [ ] **Step 1: Migration + schema**

- [ ] **Step 2: Commit** `feat(db): add safety stock method fields for Z-value option`

---
