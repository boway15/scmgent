### Task 6: 璺熷崟閲岀▼纰戞棩鏈熷瓧娈?
**Files:**
- Modify: `packages/db/src/schema/procurement.ts`
- Create: `packages/db/drizzle/0055_purchase_draft_milestones.sql`
- Modify: journal
- Modify: `apps/web/server/routes/procurement.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/PurchaseTrackingPage.tsx`

**Interfaces:** 鏂板鍒楋紙date, nullable锛夛細

```text
planned_production_done_date
actual_production_done_date
planned_pickup_date
etd
eta_port
customs_done_date
eta_warehouse
```

锛坄eta_available` 宸叉湁锛夈€傚彲閫?`transport_mode` varchar銆?
PATCH 鍏佽鏇存柊涓婅堪瀛楁锛汫ET 杩斿洖銆俇I锛氭姌鍙犮€岄噷绋嬬銆嶅尯鍩熸垨娆¤琛屽唴缂栬緫锛?*涓诲睍绀轰粛鏄璁″彲鍞棩**銆?
- [ ] **Step 1: Schema + SQL + journal**

- [ ] **Step 2: API**

- [ ] **Step 3: UI锛堣嚦灏?etd / eta_port / eta_warehouse / eta_available锛?*

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add purchase draft milestone dates for PMC tracking

EOF
)"
```

---

