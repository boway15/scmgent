### Task 5: 鍋ュ悍/琛ヨ揣 metrics 鍐欏叆瀹屾暣 lead + profileId

**Files:**
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Modify: `apps/web/server/lib/inventory-health-service.test.ts`锛坢etrics shape锛?- Modify: `apps/web/server/tasks/replenishmentForecast.ts`锛堣嫢鍐?suggestion.reason/metrics锛?
**Interfaces:**
- metrics 澧炲姞锛?
```ts
{
  leadTimeProfileId: string | null,
  productionDays, domesticDays, bookingDays, transitDays, customsDays, inboundDays,
  shippingDays, inboundBufferDays, totalLeadDays,
  inventoryPosition: { ... } // 宸叉湁 P0
}
```

- [ ] **Step 1: 鏂█ build metrics 鍚柊瀛楁**

- [ ] **Step 2: 瀹炵幇 鈥?`computeSkuWarehouseHealth` 宸茶皟 resolver锛屽睍寮€ breakdown 鍐欏叆 metrics**

- [ ] **Step 3: 纭 `calcCoverageReplenishmentFromForecast` 浠嶅悆 production/shipping/inbound锛坈ompat锛?*

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: persist lead-time profile breakdown in health metrics

EOF
)"
```

---
