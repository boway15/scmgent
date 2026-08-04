### Task 3: Schema `shipments` + `shipment_milestones`

**Files:**
- Create: `packages/db/src/schema/shipments.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0057_shipments.sql`
- Modify: journal

**Interfaces:**

```ts
// shipments
id, shipmentNo unique, draftId?, planItemId?, skuId, qty,
containerNo?, bookingRef?, trackingNo?, transportMode?,
status: varchar // booked|loaded|departed|arrived_port|customs|received_wh|available|cancelled
etaAvailable?, sourceSystem?, externalId?, createdAt, updatedAt

// shipment_milestones
id, shipmentId, milestone, plannedAt?, actualAt?, remark?, createdAt
unique(shipmentId, milestone)
```

- [ ] **Step 1: Schema + SQL + journal**

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(db): add shipments and shipment_milestones tables"
```

---
