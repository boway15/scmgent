### Task 4: Profile API锛坙ist + upsert锛? 鏈€灏忕鐞?UI锛堝彲閫夌畝鍖栵級

**Files:**
- Create: `apps/web/server/routes/lead-time-profiles.ts`
- Modify: `apps/web/server/index.ts` 鎸傝浇
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/LeadTimeProfilesPage.tsx`锛堢畝鍗曡〃鏍?CRUD锛?- Modify: `apps/web/src/router.tsx`
- Migration/seed: 鑿滃崟 `data.lead_time` 鎴?`inventory.lead_time` path `/inventory/lead-time`锛堟寕搴撳瓨涓嬶紝sort 闈犲悗锛?
**Interfaces:**
- `GET /api/lead-time-profiles?warehouse=&merchant=`
- `POST /api/lead-time-profiles` upsert body
- `DELETE /api/lead-time-profiles/:id`
- `requireMenu('inventory.lead_time')`

鑻ユ椂闂寸揣锛?*鍙彧鍋?API + 鐢?Import/涓存椂椤甸潰**锛涗絾鏈?plan 瑕佹眰鑷冲皯鍙鍒楄〃 + 鏂板缓琛ㄥ崟涓€椤碉紝渚夸簬楠屾敹銆屾崲 profile 鍚庡缓璁彉鍖栥€嶃€?
- [ ] **Step 1: 璺敱 + 鑿滃崟 SQL**锛堝彲骞跺叆 `0053` 鎴栧崟鐙?`0054_lead_time_menu.sql`锛?
- [ ] **Step 2: 椤甸潰锛氬垪琛ㄣ€佽〃鍗曞瓧娈碉紙鐢熶骇/璁㈣埍/骞茬嚎/娓呭叧/鍏ヤ粨/鍥藉唴锛?*

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add lead time profile API and admin page

EOF
)"
```

---
