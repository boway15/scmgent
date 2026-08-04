### Task 5: Schema 鈥?`eta_available`

**Files:**
- Modify: `packages/db/src/schema/procurement.ts`
- Create: `packages/db/drizzle/0052_purchase_draft_eta_available.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`锛堣拷鍔?idx锛宼ag `0052_purchase_draft_eta_available`锛涜嫢鏈湴 journal 涓庣鐩?migration 缂栧彿涓嶄竴鑷达紝浠?*纾佺洏鏈€澶х紪鍙?+ 1**涓哄噯骞跺悓姝?journal锛?
**Interfaces:**
- Produces: `purchaseDrafts.etaAvailable: date | null`

- [ ] **Step 1: Add column to schema**

```ts
/** 棰勮鍙敭鏃ワ紙琛ヨ揣/寤惰涓诲瓧娈碉紱鍐欏叆鏃跺悓姝?confirmedDeliveryDate锛?*/
etaAvailable: date('eta_available'),
```

鏀惧湪 `confirmedDeliveryDate` 鏃併€?
- [ ] **Step 2: SQL migration**

```sql
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "eta_available" date;
UPDATE "purchase_drafts"
SET "eta_available" = "confirmed_delivery_date"
WHERE "eta_available" IS NULL AND "confirmed_delivery_date" IS NOT NULL;
```

- [ ] **Step 3: Journal entry**

鎸変粨搴撶幇鏈?journal 鏍煎紡杩藉姞涓€鏉?`0052_purchase_draft_eta_available`銆?
- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/procurement.ts packages/db/drizzle/0052_purchase_draft_eta_available.sql packages/db/drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
feat(db): add purchase_drafts.eta_available for sellable ETA

EOF
)"
```

---
