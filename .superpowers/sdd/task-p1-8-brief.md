### Task 8: SKU 搴撳瓨瑙勫垝椤?+ API

**Files:**
- Create: `apps/web/server/lib/inventory-planning-service.ts`
- Modify: `apps/web/server/routes/inventory.ts`锛堟垨鏂?route 鏂囦欢锛?- Create: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- Modify: `router.tsx`銆乣api.ts`
- Migration: 鑿滃崟 `inventory.planning` path `/inventory/planning`锛堝垪琛ㄥ彲鍏堥噸瀹氬悜鍒版€昏甯﹁鏄庯紱璇︽儏 `/:skuId`锛?- Seed: `packages/db/src/seed.ts` + SQL migration INSERT menu + role_menus for admin

**Interfaces:**
- `GET /api/inventory/planning/:skuId?warehouse=`

```ts
type SkuPlanningView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  position: InventoryPositionBreakdown;
  leadTime: ResolvedLeadTime;
  avgDaily: number;
  demandSource: 'forecast' | 'historical';
  coverageDays: number;
  safetyStockDays: number;
  reorderPoint?: number;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  etaAvailableNearest?: string | null; // 鏈€杩戣窡鍗曞彲鍞棩
  stockoutDateEstimate?: string | null; // coverageDays 鎺ㄧ畻锛岀畝鍖?};
```

瀹炵幇锛氬鐢?`resolveInventoryPosition` + `resolveLeadTimeForSkuWarehouse` + 涓?health 鐩稿悓鐨勯渶姹傝В鏋愶紙鍙娊涓€灏忔鎴栬皟鐢?`computeSkuWarehouseHealth` 鍗曚粨锛夈€?
UI锛氬崱鐗囧睍绀烘寚鏍囪〃锛涚畝鏄撴洸绾垮彲鐢?CSS/绾枃鏈樁璺冭鏄庯紙銆屾寜鏃ユ秷鑰?+ eta_available 琛ョ粰銆嶏級锛?*涓嶅己鍒跺浘琛ㄥ簱**锛涙湁 `recharts` 鍐嶇敤鎶樼嚎銆?
- [ ] **Step 1: API + 鏈嶅姟鍗曟祴锛坢ock 鎴栫函缁勮锛?*

- [ ] **Step 2: 椤甸潰 + 璺敱 `inventory/planning/:skuId`**

- [ ] **Step 3: 鑿滃崟 migration**

- [ ] **Step 4: 浠庡缓璁〉/鎬昏閾惧叆**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add SKU inventory planning page driven by position and lead time

EOF
)"
```

---
