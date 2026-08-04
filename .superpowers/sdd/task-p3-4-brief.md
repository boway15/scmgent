### Task 4: Schema �?external_id 铺齐

**Files:**
- Audit then ALTER：`skus`, `merchants`, `purchase_drafts`, `shipments`, `lead_time_profiles`, `pmc_plans`（按缺补�?- Create: `packages/db/drizzle/0060_external_ids.sql`

每表至少：`source_system varchar(50)`, `external_id varchar(100)`；有行概念的再加 `external_line_id`（pmc_plan_items / 可选）�?
跳过已有列�?
- [ ] **Step 1: Diff schema vs needed �?SQL**

- [ ] **Step 2: Commit** `feat(db): add source_system and external_id placeholders`

---
