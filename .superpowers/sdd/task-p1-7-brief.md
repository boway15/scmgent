### Task 7: 琛ヨ揣寤鸿鍙В閲?UI

**Files:**
- Modify: `apps/web/src/pages/ReorderSuggestionsPage.tsx`
- Optional: `apps/web/src/lib/reorder-suggestion-explain.ts`锛堢函鍑芥暟鏍煎紡鍖栨枃妗堬紝鍙崟娴嬶級

**Interfaces:**
- Produces: 灞曞紑鍖哄睍绀猴細

```text
瑙﹀彂鍘熷洜锛歿reason 鎴栫敱 health/coverage 鎺ㄥ}
搴撳瓨浣嶇疆锛歿effectiveQty} = 鍙敭 {a} + 鐢熶骇 {p} + 鍦ㄩ€?{t} + 宸茬‘璁ゆ湭鐢熶骇 {c} 鈭?宸插垎閰?{r}
鏃ュ潎闇€姹傦細{avgDaily}锛坽demandSource}锛?鎬绘彁鍓嶆湡锛歿total} = 鐢熶骇 {..} + 鈥?
瀹夊叏搴撳瓨澶╂暟 / 鐩爣瑕嗙洊 / 寤鸿閲?/ 寤鸿涓嬪崟鏃?/ profileId
```

浠?`item.metrics` 璇伙紱缂哄瓧娈垫椂闄嶇骇鏄剧ず `item.reason`銆?
鏂囨鏇存柊椤靛ご锛氭湁鏁堜緵缁欏惈銆屽簱瀛樹綅缃紙鍙敭+鍦ㄩ€?鐢熶骇/璺熷崟琛ョ己+宸茬‘璁ゅ紑鏀锯垝宸插垎閰嶏級銆嶃€?
閾炬帴锛歋KU 鈫?`/inventory/planning/${skuId}`锛圱ask 8 璺敱灏辩华鍚庡彲鐢紱鍙厛閾捐繃鍘伙級銆?
- [ ] **Step 1: 绾嚱鏁?`formatSuggestionExplain(metrics, item)` + 鍗曟祴**

- [ ] **Step 2: 鎺ュ叆灞曞紑鍖?*

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: explain reorder suggestions with position and lead-time breakdown

EOF
)"
```

---
