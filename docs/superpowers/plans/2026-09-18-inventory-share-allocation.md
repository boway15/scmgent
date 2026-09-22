# 库存规划分仓投影与在途日期治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把飞书 `OVERSEAS` 合计按销售占比拆到目的仓批次，全局扣除发运/跟单在途后处理残差日期，去掉假 ETA，使规划确定线与 7/15/30 按目的仓可用。

**Architecture:** 新增纯函数 `allocateByShare` / `splitResidualTransit`；扩展 `buildLotsFromInputs` 做全局残差与无期排除；`syncInventorySupplyLots` 读 `turnoverSnapshot` 后投影。规划 API 透出 `allocation`；未分仓跳过 `stockout_horizon`。不改 `inventory_records` 合计口径，不改日余额公式。

**Tech Stack:** TypeScript、Node `tsx --test`、Drizzle/Postgres、Hono、React

**Spec:** `docs/superpowers/specs/2026-09-18-inventory-share-allocation-design.md`

## Global Constraints

- 不接迅捷 API，不加密飞书 Cron，不改飞书同步列结构。
- `inventory_records` 仍写 `OVERSEAS` 合计；禁止把合计拆成假分仓 records。
- 不改 `projectDailyInventory` / 建议量 / 覆盖天数健康灯公式。
- 7/15/30 只看确定线；三桶上架只进计划线。
- 禁止残差 `available_at = today + defaultTransitLeadDays`。
- 无占比不拆仓；该目的仓不写 `stockout_horizon`。
- 不新建批次表列（用 `sourceId` 约定）；不新开路由。
- 中文 UI；标识符英文。
- 测试：`pnpm --filter @scm/web exec tsx --test <files>`
- Windows PowerShell 提交用 `git commit -m "feat: ..."`，不要 bash heredoc。

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/inventory-share-allocation.ts` | 占比解析、最大余数、残差三桶拆分、规划 allocation 判定 |
| `apps/web/server/lib/inventory-share-allocation.test.ts` | 上述纯函数 |
| `apps/web/server/lib/inventory-supply-lots.ts` | 全局扣在途、OVERSEAS 投影入口、无期残差、无仓跟单 |
| `apps/web/server/lib/inventory-supply-lots.test.ts` | lots 行为；改掉「假 ETA」旧用例 |
| `apps/web/server/lib/inventory-supply-lot-sync.ts` | 读 turnoverSnapshot，传入 shares/schedule |
| `apps/web/server/lib/inventory-timeline-service.ts` | OVERSEAS 占用按占比拆；禁止把 OVERSEAS 全量补进目的仓 |
| `apps/web/server/lib/inventory-planning-service.ts` | 透出 `allocation` |
| `apps/web/server/tasks/stockAlert.ts` | unallocated 跳过 horizon 缺货/uncoverable |
| `apps/web/src/lib/api.ts` + 规划页 + 三池页 | 黄条/数据条/占比标签 |

---

### Task 1: `allocateByShare` 与残差日期纯函数

**Files:**
- Create: `apps/web/server/lib/inventory-share-allocation.ts`
- Create: `apps/web/server/lib/inventory-share-allocation.test.ts`

**Interfaces:**
- Consumes: `TURNOVER_BUCKET_WAREHOUSE_MAP`（`./turnover-bucket-warehouse.js`）、`FEISHU_REGION_SALES_SHARE_FIELDS`（`./inventory-turnover-feishu-headers.js`）
- Produces:

```ts
export const SHARE_MISMATCH_DELTA = 0.05;

export type ShareParseResult = {
  method: 'sales_share' | 'unallocated';
  shareSum: number;
  shareSumWarning: boolean;
  /** 仅正权重；sales_share 时已归一化使 Σweight=1 */
  weights: Array<{ warehouse: string; weight: number }>;
};

export type ResidualTransitSlice = {
  qty: number;
  availableAt: string | null;
  bucket: 'd5' | 'd15' | 'd25' | 'earliest' | 'undated';
};

export type PlanningAllocationMethod = 'sales_share' | 'native_warehouse' | 'unallocated';

export type PlanningAllocation = {
  method: PlanningAllocationMethod;
  snapshotDate: string | null;
  overseasTotal: number;
  allocatedQty: number;
  undatedTransitQty: number;
  shareSumWarning: boolean;
};

export function parseShareValue(raw: string | undefined | null): number;
export function parseSharesFromSnapshot(snapshot: Record<string, string | undefined>): ShareParseResult;
export function allocateByShare(qty: number, parsed: ShareParseResult): Map<string, number>;
export function parseTransitBuckets(snapshot: Record<string, string | undefined>): {
  d5: number;
  d15: number;
  d25: number;
};
export function splitResidualTransit(params: {
  residual: number;
  buckets: { d5: number; d15: number; d25: number };
  earliestAvailableAt: string | null;
  today: string;
}): ResidualTransitSlice[];
export function resolvePlanningAllocation(params: {
  planningWarehouse: string;
  nativeWarehouseQty: number;
  overseasTotal: number;
  share: ShareParseResult;
  allocatedQty: number;
  undatedTransitQty: number;
  snapshotDate: string | null;
}): PlanningAllocation;
export function shouldSkipConfirmedHorizon(method: PlanningAllocationMethod): boolean;
```

- [ ] **Step 1: Write the failing tests**

`inventory-share-allocation.test.ts`：`node:test` + `node:assert/strict`。`parseShareValue` 与 mapper 一致：`'0.41'`→0.41，`'41%'`→0.41，空→0。

`parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' })` → `method:'sales_share'`，权重仓 `US-WEST`/`US-EAST`。全空 → `unallocated`。`美西:'0.5'` 仅一列且 shareSum=0.5 → 仍 `sales_share`（相对归一），`shareSumWarning: true`。

`allocateByShare(100, 0.6/0.4)` → WEST=60 EAST=40；`allocateByShare(0, …)` 全 0；`unallocated` 返回空 Map；`allocateByShare(10, 1/3+1/3+1/3)` 三仓之和为 10。余数并列时按 `warehouse` 字符串升序稳定分配。

`splitResidualTransit`：`residual=80, buckets={40,20,10}, earliest=null, today='2026-09-18'` → 三片 qty 40/20/10 日期 `2026-09-23`/`2026-10-03`/`2026-10-13`，另 `undated` 10。`residual=50, buckets={40,20,10}`（桶和 70>50）→ 三片之和=50 且无 undated。`residual=30, buckets 全 0, earliest='2026-10-01'` → 一片 earliest 30。`residual=30, 桶空且 earliest null` → 一片 undated、`availableAt:null`。

`resolvePlanningAllocation`：目的仓 `US-WEST`、overseasTotal>0、share unallocated、nativeWarehouseQty=0 → `unallocated`。share sales_share 且 allocatedQty=60 → `sales_share`。nativeWarehouseQty>0 → `native_warehouse`。`shouldSkipConfirmedHorizon('unallocated')===true`，另两档 false。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-share-allocation.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`parseShareValue`：trim、去逗号、`%` 则 `/100`。`parseSharesFromSnapshot`：遍历 `FEISHU_REGION_SALES_SHARE_FIELDS`，用 `TURNOVER_BUCKET_WAREHOUSE_MAP[region]` 得仓码，正权重入列；无正权重 → unallocated；否则归一化 `weight=w/sum`，`shareSumWarning = |shareSum-1| > SHARE_MISMATCH_DELTA`（unallocated 时 warning=false）。

`allocateByShare`：qty≤0 或 unallocated → 空或全 0 Map（测试用空 Map 即可，调用方对 0 不建批）。`floor(qty*weight)`，余数按 `qty*weight - floor` 降序，并列 `warehouse.localeCompare`，每次 +1。Map 的 key 为仓码，Σvalue=qty。

`parseTransitBuckets`：读 `预计10天上架_合计`、`预计10-20天上架_合计`、`预计超20天上架_合计`，`parseInt` 去逗号，非法当 0。

`splitResidualTransit`：residual≤0 → `[]`。桶和 `B=d5+d15+d25`。若 B>0 且 B≤residual：三片正数量桶（日期 today+5/+15/+25，用现网 `addDaysIso` from `inventory-supply-lots.js`），`undated = residual-B`（>0 则再推一片）。若 B>residual：把 d5/d15/d25 当三个 weight 调 `allocateByShare(residual, 构造 sales_share 权重)` 得到三仓数量（用仓库名 `d5`/`d15`/`d25` 仅此函数内部），无 undated。B=0 且 earliest 非空 → earliest 一片。否则 undated 一片。

`resolvePlanningAllocation`：`nativeWarehouseQty>0` → native_warehouse；`share.method==='sales_share'` → sales_share；`overseasTotal>0 && share.method==='unallocated'` → unallocated；否则 native_warehouse（无海外合计时不当作未分仓）。

`shouldSkipConfirmedHorizon`：`method === 'unallocated'`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-share-allocation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/web/server/lib/inventory-share-allocation.ts apps/web/server/lib/inventory-share-allocation.test.ts
git commit -m "feat: allocate overseas qty by Feishu sales share"
```

---

### Task 2: `buildLotsFromInputs` 全局残差与禁止假 ETA

**Files:**
- Modify: `apps/web/server/lib/inventory-supply-lots.ts`
- Modify: `apps/web/server/lib/inventory-supply-lots.test.ts`

**Interfaces:**
- Consumes: Task 1 `allocateByShare`、`ShareParseResult`、`splitResidualTransit`、`parseTransitBuckets`
- Produces: 扩展后的 `buildLotsFromInputs`（签名如下）。现网 `SupplyLotSnapshotInput` 不变。

```ts
export type SkuAllocationContext = {
  share: ShareParseResult;
  transitBuckets: { d5: number; d15: number; d25: number };
  earliestAvailableAt: string | null;
};

export function buildLotsFromInputs(params: {
  snapshots: SupplyLotSnapshotInput[];
  drafts: SupplyLotDraftInput[];
  shipments: SupplyLotShipmentInput[];
  today: string;
  defaultTransitLeadDaysByWarehouse: Record<string, number>;
  allocationBySku?: Map<string, SkuAllocationContext>;
}): { lots: BuiltSupplyLot[]; eligibleLots: BuiltSupplyLot[] };
```

发运批次逻辑保持：有仓、qty>0、非 available/cancelled；无 `etaAvailable` 时仍可用 `today+defaultLead` 且 `dateUnknown/etaEstimated`（单据估期，不是快照残差）。

- [ ] **Step 1: Write / update failing tests**

保留「发运盖住快照在途、真 ETA」用例（`US-WEST` 真分仓快照）。**改写** `uses estimated ETA for snapshot transit when no shipment rows`：

快照改为 `warehouseCode:'OVERSEAS', qtyAvailable:100, qtyInTransit:80`，无 allocationBySku（或 unallocated）：在途批 `availableAt===null`、`dateUnknown===true`，**不得**等于 `addDaysIso(today, 45)`。海外在库批仍在 `OVERSEAS`。

新增：

1. allocation 美西 0.6 美东 0.4，OVERSEAS 在库 100、在途 0 → 海外批 US-WEST=60、US-EAST=40，`sourceId` 为 `avail-share:{sku}:{wh}`，无 OVERSEAS 在库批。  
2. OVERSEAS 在途 80，发运 US-WEST 30 有 ETA，占比 0.6/0.4，无三桶无 earliest → 发运在途 30；残差 50 拆 WEST=30 EAST=20，均 `undated`、`sourceId` 含 `transit-share:` 与 `:undated`。  
3. 残差 80、三桶 40/20/10、占比全给美西 → 美西计划在途三片日期 +5/+15/+25，undated 10；`classifySupplyLot` 对有期残差为 `planned`（可在本文件 import classify 或只断言 etaEstimated true 且 availableAt 非空）。  
4. 真分仓快照 `US-WEST` 在库 10 **不要**再拆 OVERSEAS；若同时没有 OVERSEAS 行，海外批仓码仍是 US-WEST、`sourceId` 仍 `avail:{sku}:US-WEST`。  
5. 跟单 `warehouseCode:null`、openQty 100、status `in_production`、有占比 0.6/0.4 → 本地两批 60/40，`sourceId` 以 `#share` 结尾。无占比则一批 `OVERSEAS`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-supply-lots.test.ts`

Expected: 旧假 ETA 用例或新用例 FAIL

- [ ] **Step 3: Write minimal implementation**

在 `buildLotsFromInputs` 中：

1. 先生成全部发运 lots，并 `docTransitQty` 按 sku 累加发运 qty。  
2. 遍历 drafts：先对 `in_transit`/`partial_received` 累加 openQty 进同一 `docTransitQty`（在生成 lots 之前或同时，避免漏扣）。  
3. 快照：`warehouseCode !== 'OVERSEAS'` 保持现逻辑（本仓在库批 + 本仓 `qtyInTransit - 本仓发运` 残差）。本仓残差无期：`availableAt=null`、`dateUnknown=true`、`etaEstimated=true`，**不要** `addDaysIso(today, lead)`。`sourceId` 仍 `transit:{sku}:{wh}`。  
4. `warehouseCode === 'OVERSEAS'`：ctx=`allocationBySku.get(sku)`。在库：`sales_share` 则 `allocateByShare(qtyAvailable)` 逐仓建海外批 `sourceId=avail-share:{sku}:{wh}`；否则一条 OVERSEAS `avail:{sku}:OVERSEAS`。在途：`residual=max(0, qtyInTransit - docTransitQty[sku])`。`splitResidualTransit` 得 slices；每片 qty 再 `allocateByShare`（unallocated 则整片留 OVERSEAS）。`sourceId=transit-share:{sku}:{wh}:{bucket}`。  
5. 跟单：有 `warehouseCode` 走现网。无仓：`sales_share` 则拆 openQty 到各仓，`sourceId = draftId + '#share'`；否则 `warehouseCode='OVERSEAS'`。本地仍 `resolveLocalAvailableAt`，失败则 `availableAt=null`、`dateUnknown=true`。在途跟单有 `etaAvailable` 则确定档字段与现网一致。  
6. 同一 sku 多条 OVERSEAS 快照不应重复扣 docTransit：按 sku 只处理一次 OVERSEAS 在途（用该 sku 最新/最大在途或第一条；测试只给一行）。

`eligibleLots` 过滤保持 `isLotEligibleForTimeline`（无 `availableAt` 的不进）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-supply-lots.test.ts apps/web/server/lib/inventory-share-allocation.test.ts apps/web/server/lib/inventory-timeline.test.ts`

Expected: PASS（timeline 旧用例不得破坏）

- [ ] **Step 5: Commit**

```powershell
git add apps/web/server/lib/inventory-supply-lots.ts apps/web/server/lib/inventory-supply-lots.test.ts
git commit -m "feat: split OVERSEAS lots and drop fake residual ETAs"
```

---

### Task 3: 同步读取占比并投影 lots

**Files:**
- Modify: `apps/web/server/lib/inventory-supply-lot-sync.ts`

**Interfaces:**
- Consumes: `readTurnoverSnapshot`（`./inventory-turnover-snapshot.js`）、`skus.encodingMeta`、Task 1/2 类型
- Produces: `syncInventorySupplyLots` 仍返回 `{ lotCount, eligibleCount }`；调用 `buildLotsFromInputs` 时传入 `allocationBySku`

- [ ] **Step 1: Write a focused unit test if load helper is extractable**

在 `inventory-supply-lot-sync.ts` 导出纯函数（避免测 DB）：

```ts
export function buildAllocationBySku(
  rows: Array<{ skuId: string; encodingMeta: unknown }>,
): Map<string, SkuAllocationContext>
```

测试文件可新建 `inventory-supply-lot-sync-allocation.test.ts`：encodingMeta.turnoverSnapshot 含 `美西:'0.6'`、`预计10天上架_合计:'10'`、`最早在途上架时间:'2026-10-01'` → Map 中该 sku 的 share.method 为 sales_share，buckets.d5=10，earliest 为该日（若 `readTurnoverSnapshot` 会格式化日期，断言非空即可）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-supply-lot-sync-allocation.test.ts`

Expected: FAIL（函数不存在）

- [ ] **Step 3: Implement loader + wire sync**

`buildAllocationBySku`：对每行 `readTurnoverSnapshot(encodingMeta)`，`parseSharesFromSnapshot`、`parseTransitBuckets`，earliest 读 `最早在途上架时间`（trim，空则 null）。

`syncInventorySupplyLots`：load snapshots 不变。另 `select id, encodingMeta from skus`（可只查 snapshot 里出现过的 skuId）。`allocationBySku = buildAllocationBySku(...)`。`buildLotsFromInputs({ ..., allocationBySku })`。

跟单 `warehouseCode` 仍来自 PMC `targetWarehouseCode`；null 时交给 Task 2 拆仓。

不要改 `loadLatestPhysicalSnapshots` 的 OVERSEAS 行（records 保持合计）。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-supply-lot-sync-allocation.test.ts apps/web/server/lib/inventory-supply-lots.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/web/server/lib/inventory-supply-lot-sync.ts apps/web/server/lib/inventory-supply-lot-sync-allocation.test.ts
git commit -m "feat: apply sales-share allocation when syncing supply lots"
```

---

### Task 4: 规划 allocation、占用拆分、预警跳过

**Files:**
- Modify: `apps/web/server/lib/inventory-timeline-service.ts`
- Modify: `apps/web/server/lib/inventory-planning-service.ts`
- Modify: `apps/web/server/lib/inventory-planning-service.test.ts`（若已有 view 测试则扩展）
- Modify: `apps/web/server/tasks/stockAlert.ts`
- Modify: `apps/web/server/lib/inventory-horizon-alerts.ts`（仅当需要纯函数包装 skip；否则在 stockAlert 调用 `shouldSkipConfirmedHorizon`）
- Modify: `apps/web/src/lib/api.ts`（`SkuPlanningView.allocation` 类型，与后端字段一致）

**Interfaces:**
- Consumes: `resolvePlanningAllocation`、`shouldSkipConfirmedHorizon`、`allocateByShare`、`getLatestInventorySnapshot`、`readTurnoverSnapshot`
- Produces: `SkuPlanningView.allocation?: PlanningAllocation`；timeline `reservedQty` 为本仓占用或 OVERSEAS 占用拆分值

```ts
// SkuPlanningView 增加
allocation?: PlanningAllocation;
```

- [ ] **Step 1: Failing tests**

`inventory-planning-service.test.ts`：`buildSkuPlanningView` 传入 `allocation: { method:'unallocated', snapshotDate:'2026-09-18', overseasTotal:100, allocatedQty:0, undatedTransitQty:0, shareSumWarning:false }`，断言 view 上同结构。

新建 `inventory-horizon-skip.test.ts`（或加在 horizon-alerts.test）：`shouldSkipConfirmedHorizon('unallocated')` 为 true。文档化 stockAlert：若 skip，则 **不要** 把 `stockout_horizon` / `uncoverable_by_new_po` 写入；`coverage_short` / `overstock` 仍按现网健康口径（在 stockAlert 循环里 `if (shouldSkip) { deriveHorizonAlerts 后 filter 掉这两种 alertType }`）。

timeline-service：若不便测 DB，抽：

```ts
export function resolveReservedQty(params: {
  warehouseReserved: number;
  overseasReserved: number;
  share: ShareParseResult;
  planningWarehouse: string;
}): number
```

测试：本仓 reserved=5 → 5；本仓 0、overseas 10、美西 0.6 → 6；unallocated → 0（不把 10 全算进美西）。

无海外确定批时：`snap.qtyAvailable` 补当天可售 **仅当** `snap` 是本仓且 >0；本仓 0 时即使用 OVERSEAS 有货也 **禁止** 把全量补进目的仓（现网 `hasConfirmedOverseas` 分支）。加纯函数或改测试 `inventory-timeline-service` 若无测试则在 planning 集成注释 + timeline-service 内明确 `if (!hasConfirmedOverseas && snap.qtyAvailable > 0 && params.warehouseCode !== 'OVERSEAS')` 仍可补本仓实物；**不要** 读取 OVERSEAS.qtyAvailable 填入目的仓。

- [ ] **Step 2: Run tests, expect FAIL**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-planning-service.test.ts`

Expected: FAIL until view 透出 allocation

- [ ] **Step 3: Implement**

`getSkuPlanningView`：读 sku encodingMeta + 本仓/OVERSEAS snapshot。`share=parseSharesFromSnapshot(readTurnoverSnapshot(meta))`。`allocatedQty` = 该仓 open overseas lots 之和（或 `allocateByShare(overseasTotal).get(wh)??0`）。`undatedTransitQty` = 该仓 `dateUnknown` 在途 snapshot lots 数量和。`nativeWarehouseQty` = 本仓 records.qtyAvailable。`allocation=resolvePlanningAllocation(...)`。传入 `buildSkuPlanningView`。

`buildSkuWarehouseTimeline`：`warehouseReserved=snap.qtyReserved`；`overseasSnap=getLatestInventorySnapshot(sku,'OVERSEAS')`；`reservedQty=resolveReservedQty(...)`。补当天可售条件保持本仓 `snap.qtyAvailable`，禁止用 overseasSnap.qtyAvailable 补目的仓。

`runStockAlert`：对每行算 allocation（可复用轻量函数 `loadShareForSku`，避免 N+1 过重：循环前批量读 encodingMeta Map）。`shouldSkipConfirmedHorizon` 为 true 时，从 `horizonCandidates` 去掉 `stockout_horizon` 与 `uncoverable_by_new_po`。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-planning-service.test.ts apps/web/server/lib/inventory-horizon-alerts.test.ts apps/web/server/lib/inventory-share-allocation.test.ts apps/web/server/lib/inventory-timeline.test.ts`

Expected: PASS（horizon-alerts 文件若无 skip 测试可只跑 share + planning）

- [ ] **Step 5: Commit**

```powershell
git add apps/web/server/lib/inventory-timeline-service.ts apps/web/server/lib/inventory-planning-service.ts apps/web/server/lib/inventory-planning-service.test.ts apps/web/server/tasks/stockAlert.ts apps/web/src/lib/api.ts
git commit -m "feat: expose share allocation on planning and skip false horizons"
```

---

### Task 5: 规划页数据条与三池标签

**Files:**
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- Modify: `apps/web/src/pages/InventoryPoolsPage.tsx`
- Modify: `apps/web/src/lib/api.ts`（若 Task 4 未改完类型）

**Interfaces:**
- Consumes: `SkuPlanningView.allocation`；三池 `sourceId`
- Produces: 规划黄条/灰条；三池「占比拆仓」「仓由占比推定」

- [ ] **Step 1: 页面文案（无独立单测则手工对照 spec §7）**

规划页，目标仓选择卡片下方：

- `allocation.method==='unallocated'`：琥珀色条，文案 **飞书无销售占比，库存记在 OVERSEAS，本仓确定线与 7/15/30 不可用。**  
- `method==='sales_share'`：`text-text-hint` **按近半年销售占比拆自海外合计；快照日 {snapshotDate ?? '未知'}。** 若 `shareSumWarning` 追加 **占比合计未接近 100%，已按相对权重拆分。**  
- `undatedTransitQty>0`：**{n} 件在途无可用日，未计入时间轴。**

三池：`sourceId` 包含 `avail-share` 或 `transit-share` → 仓码旁灰字「占比拆仓」；`sourceId` 以 `#share` 结尾 → 「仓由占比推定」。无 `availableAt` 保持现网黄条，不要展示估期日期。

有效供给 MetricCard hint 可改为 **飞书快照合计在总览；本页确定线按目的仓批次。**（一句，避免暗示本仓 records 已有分仓实物。）

- [ ] **Step 2: 类型检查改动文件**

`SkuPlanningView` 的 `allocation` 与后端一致。三池行类型已有 `sourceId`。

- [ ] **Step 3: 实现页面**

按 Step 1 插入 JSX，沿用现网 `Card` / 琥珀色条样式（三池 `bg-amber-50`）。

- [ ] **Step 4: 回归服务端测试**

Run: `pnpm --filter @scm/web exec tsx --test apps/web/server/lib/inventory-share-allocation.test.ts apps/web/server/lib/inventory-supply-lots.test.ts apps/web/server/lib/inventory-timeline.test.ts apps/web/server/lib/inventory-planning-service.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/pages/SkuInventoryPlanningPage.tsx apps/web/src/pages/InventoryPoolsPage.tsx apps/web/src/lib/api.ts
git commit -m "feat: show share-allocation banners on planning and pool pages"
```

---

## Spec coverage (self-review)

| Spec | Task |
|------|------|
| §4 占比拆仓、最大余数、无占比不拆 | 1, 2 |
| §4.4 占用 | 4 `resolveReservedQty` |
| §4.5 禁止 OVERSEAS 全量补进目的仓 | 4 |
| §5 全局残差、三桶/最早/无期、禁止假 ETA | 1 `splitResidualTransit`, 2 |
| §5.3 无仓跟单 | 2 |
| §6 sourceId | 2, 5 |
| §7 规划条、三池标签、horizon 跳过 | 4, 5 |
| §9 验收 1–6 | 1–4 测试 |
| §10 不改 records / 公式 / 预测 | Global Constraints |
| `inventory_records` 不变 | 3 不改 snapshot loader 写入 |

无 TBD。Task 2 的 `allocationBySku` 与 Task 1 `SkuAllocationContext` 名称一致。Task 4 `PlanningAllocation` 沿用 Task 1。
