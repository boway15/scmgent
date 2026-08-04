### Task 7: 璺熷崟椤?UI 鈥?棰勮鍙敭鏃?
**Files:**
- Modify: `apps/web/src/pages/PurchaseTrackingPage.tsx`

**Interfaces:**
- Consumes: `api.updatePurchaseTracking(..., { etaAvailable })`
- Produces: 鍒楄〃灞曠ず銆岄璁″彲鍞棩銆嶏紱纭浜ゆ湡鏃跺彲褰曞叆鏃ユ湡

- [ ] **Step 1: 鏇存柊鏂囨涓庡垪**

- 椤靛ご璇存槑澧炲姞锛氫氦鏈熷瓧娈佃〃绀?*棰勮鍙敭鏃?*锛堝埌浠撲笂鏋跺悗鍙敭锛夛紝涓嶆槸鍒版腐鏃ャ€?- 琛ㄦ牸鍒楋細浼樺厛鏄剧ず `d.etaAvailable ?? d.confirmedDeliveryDate ?? d.expectedDate`
- 銆岀‘璁や氦鏈熴€嶅姩浣滐細鐢?`Input type="date"`锛堟垨鐜版湁妯″紡锛夋敹闆嗘棩鏈燂紝璋冪敤锛?
```ts
api.updatePurchaseTracking(id, {
  status: 'confirmed',
  etaAvailable: dateStr,
});
```

- 宸茬‘璁よ鍏佽鍗曠嫭淇濆瓨鍙敭鏃ワ紙灏忔寜閽€屾洿鏂板彲鍞棩銆嶏級锛屽彧 PATCH `etaAvailable`銆?
- [ ] **Step 2: 鎵嬪伐楠屾敹娓呭崟**锛堟棤鑷姩鍖?E2E 瑕佹眰锛?
1. 鎵撳紑 `/pmc/tracking`锛屾枃妗堝惈銆岄璁″彲鍞棩銆?2. 纭浜ゆ湡鍐欏叆鍚庯紝鍒楄〃鏄剧ず璇ユ棩锛涘埛鏂板悗浠嶅湪
3. DB 涓?`eta_available` 涓?`confirmed_delivery_date` 涓€鑷?
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PurchaseTrackingPage.tsx
git commit -m "$(cat <<'EOF'
feat: capture sellable ETA on purchase tracking UI

EOF
)"
```

---
