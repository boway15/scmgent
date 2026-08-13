### Task 5: Spec 鏀跺熬 + 鍏ㄩ噺鐩稿叧娴嬭瘯

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-t99-system-floor-design.md` 鈥?鐘舵€佹敼涓?`宸插疄鐜癭

- [ ] **Step 1: 璺戠浉鍏虫祴璇曞浠?*

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
```

Expected: 鍏ㄩ儴 PASS

- [ ] **Step 2: 鏇存柊 spec 鐘舵€佽**

`> **鐘舵€?*锛氬凡瀹炵幇`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-t99-system-floor-design.md
git commit -m "docs(forecast): mark T99 system floor spec implemented"
```

---

## Spec coverage (self-review)

| Spec 瑕佹眰 | Task |
|-----------|------|
| `resolveT99SystemFloorDaily` + 闂搁棬 + 杩滄湀琛板噺 | Task 1 |
| 琛ヨ揣 fallback `recent30鈮?` 鈫?0 | Task 1 |
| `computeAllCatV41BoundedDaily` T99 鍑烘暟 | Task 2 |
| `t99FloorDaily` / `t99FloorMode` factors | Task 2 |
| 鏍囩/澶嶆牳鏂囨銆屼繚瀹堜繚搴曘€?| Task 2 + 4 |
| 鎵归噺鐭╅樀鍐欏叆闈?0锛堝幓鎺夌‖缂栫爜锛?| Task 3 |
| 鍓嶇绛栫暐/鍒楄〃/鎶藉眽/鍒楀府鍔?| Task 4 |
| 銆屽緟鏍″噯銆嶄粎绯荤粺涓?0 | Task 4锛堟棦鏈夋潯浠讹紝verify锛?|
| 涓嶈繘涓?KPI / 涓嶆敼 Dify / 涓嶉噸璺戝巻鍙?| Global Constraints锛堟棤棰濆浠ｇ爜锛?|
| 楠屾敹鍗曟祴鍦烘櫙 | Task 1鈥?銆? |

鏃犲崰浣嶇锛沗resolveT99SystemFloorDaily` 绛惧悕鍦?Task 1/2/3 涓€鑷淬€?
