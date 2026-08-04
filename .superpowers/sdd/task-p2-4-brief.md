### Task 4: Shipments API

**Files:**
- Create: `apps/web/server/lib/shipment-delay.ts`（纯函数�?delayDays�?- Create: `apps/web/server/lib/shipment-delay.test.ts`
- Create: `apps/web/server/routes/shipments.ts`
- Modify: `apps/web/server/index.ts`

**Interfaces:**
- `GET /api/shipments` �?list + optional `?delayed=1`
- `POST /api/shipments` �?create
- `PATCH /api/shipments/:id`
- `POST /api/shipments/:id/milestones` �?upsert milestone planned/actual
- `GET /api/shipments/delays` �?聚合延误�?- `requireMenu('pmc.shipments')`

延误规则�?
```ts
export function calcMilestoneDelayDays(plannedAt: string | null, actualAt: string | null, today: Date): number | null
// planned 有值且 (actual ?? today) > planned �?天数差；否则 null/0
```

列表 `delayed=1`：存在任一里程�?delay>0，或 `eta_available < today` �?status 未到 `available`�?
- [ ] **Step 1: delay 纯函�?TDD**

- [ ] **Step 2: CRUD routes**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add shipments API with delay calculation"
```

---
