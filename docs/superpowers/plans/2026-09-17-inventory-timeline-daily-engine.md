# 库存时间轴日余额引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现网五锚点时间轴升级为 SKU×仓按日余额引擎，按确定/预计/计划三档供给计算缺货日、破安全库存日、最晚下单日与建议量，并接到规划页、补货任务、预警与驾驶舱。

**Architecture:** 纯函数 `classifySupplyLot` + `projectDailyInventory` 作为唯一未来可售口径；`inventory_supply_lots` 当事件用，日序列不落库。`buildSkuWarehouseTimeline` 读占用、开放批次、已发布预测与分段交期后调用纯函数。调用方改读新字段；`alert_type` 增加 `uncoverable_by_new_po`。

**Tech Stack:** TypeScript、Node `tsx --test`、Drizzle/Postgres、Hono、React、TanStack Query

**Spec:** `docs/superpowers/specs/2026-09-17-inventory-timeline-daily-engine-design.md`

## Global Constraints

- 不新建库存事件表，不落库日序列，不新开路由。
- 飞书同步列表（库存总览/库存查询等）列结构不得改。
- PMC 未转跟单的计划行不算供给；调拨单/出货执行单本期不做。
- 建议量只扣确定+预计，不扣计划线（在产）。
- 7/15/30 预警只看确定线 `confirmedEnding(k) ≤ 0`。
- 覆盖天数健康灯并行保留；补货量与缺货日以时间轴为准。
- 中文 UI；标识符英文。迁移号：磁盘已有 `0093` → 本 plan 用 `0094`；若冲突取磁盘最大 +1。
- 测试命令：`pnpm --filter @scm/web exec tsx --test <files>`

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/inventory-timeline.ts` | `classifySupplyLot`、`projectDailyInventory`、窗口与展示锚点 |
| `apps/web/server/lib/inventory-timeline.test.ts` | 入档 + 日引擎 + 长周期样例 |
| `apps/web/server/lib/inventory-snapshot.ts` | 快照补 `qtyReserved` |
| `apps/web/server/lib/inventory-supply-lot-sync.ts` | 加载开放批次（含计划档，不再用旧 eligible 过滤） |
| `apps/web/server/lib/inventory-timeline-service.ts` | 组装入参、降级、返回新结构 |
| `apps/web/server/lib/inventory-planning-service.ts` | 规划 view 透出新 timeline |
| `apps/web/server/lib/inventory-horizon-alerts.ts` | 锚点读确定线；增加 uncoverable 候选 |
| `apps/web/server/tasks/replenishmentForecast.ts` / `stockAlert.ts` | 改读新返回值 |
| `packages/db/src/schema/reorder.ts` + `0094_*.sql` | `uncoverable_by_new_po` |
| `apps/web/server/lib/planning-dashboard.ts` | 新计划已来不及计数 |
| `apps/web/src/lib/api.ts` + 规划页/预警/驾驶舱/三池 | 类型与展示 |

---

### Task 1: 供给入档 `classifySupplyLot`

**Files:**
- Modify: `apps/web/server/lib/inventory-timeline.ts`
- Modify: `apps/web/server/lib/inventory-timeline.test.ts`

**Interfaces:**
- Produces:

```ts
export type SupplyClass = 'confirmed' | 'expected' | 'planned' | 'excluded';

export type ClassifySupplyLotInput = {
  pool: 'overseas' | 'in_transit' | 'local';
  availableAt: string | null;
  productionStatus?: 'in_production' | 'qc_pending' | 'completed' | null;
  shipReadyAt?: string | null;
  etaEstimated?: boolean;
  dateUnknown?: boolean;
  today: string;
};

export function classifySupplyLot(input: ClassifySupplyLotInput): SupplyClass;
```

- [ ] **Step 1: Write the failing tests**

在 `inventory-timeline.test.ts` 增加 `describe('classifySupplyLot')`，从 `./inventory-timeline.js` 导入 `classifySupplyLot`。用例（`today = '2026-09-17'`）：

```ts
assert.equal(
  classifySupplyLot({ pool: 'overseas', availableAt: '2026-09-17', today: '2026-09-17' }),
  'confirmed',
);
assert.equal(
  classifySupplyLot({
    pool: 'in_transit',
    availableAt: '2026-09-24',
    etaEstimated: false,
    dateUnknown: false,
    today: '2026-09-17',
  }),
  'confirmed',
);
assert.equal(
  classifySupplyLot({
    pool: 'in_transit',
    availableAt: '2026-11-16',
    etaEstimated: true,
    dateUnknown: true,
    today: '2026-09-17',
  }),
  'planned',
);
assert.equal(
  classifySupplyLot({
    pool: 'local',
    availableAt: '2026-11-08',
    productionStatus: 'completed',
    shipReadyAt: '2026-09-17',
    today: '2026-09-17',
  }),
  'expected',
);
assert.equal(
  classifySupplyLot({
    pool: 'local',
    availableAt: '2026-12-28',
    productionStatus: 'in_production',
    shipReadyAt: '2026-10-20',
    today: '2026-09-17',
  }),
  'planned',
);
assert.equal(
  classifySupplyLot({
    pool: 'local',
    availableAt: '2026-11-20',
    productionStatus: 'completed',
    shipReadyAt: '2026-10-01',
    today: '2026-09-17',
  }),
  'planned',
);
assert.equal(
  classifySupplyLot({ pool: 'local', availableAt: null, productionStatus: 'completed', today: '2026-09-17' }),
  'excluded',
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts`

Expected: FAIL（`classifySupplyLot` is not a function / not exported）

- [ ] **Step 3: Write minimal implementation**

在 `inventory-timeline.ts` 导出 `classifySupplyLot`：

- 无 `availableAt` → `excluded`
- `overseas` → `confirmed`
- `in_transit`：`etaEstimated === true` 或 `dateUnknown === true` → `planned`，否则 `confirmed`
- `local`：`productionStatus === 'completed'` 且 `shipReadyAt` 存在且 `shipReadyAt <= today` → `expected`；其余有可用日 → `planned`

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts`

Expected: PASS（可暂时保留旧 `projectInventoryTimeline` 测试，本 task 不删）

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-timeline.ts apps/web/server/lib/inventory-timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): classify supply lots into confirmed/expected/planned

EOF
)"
```

---

### Task 2: 日余额引擎 `projectDailyInventory`

**Files:**
- Modify: `apps/web/server/lib/inventory-timeline.ts`
- Modify: `apps/web/server/lib/inventory-timeline.test.ts`

**Interfaces:**
- Consumes: `classifySupplyLot`（本 task 的 lots 已带 `supplyClass`，不再现场 classify）
- Produces:

```ts
export type DailyLot = {
  supplyClass: 'confirmed' | 'expected' | 'planned';
  pool: string;
  qty: number;
  availableAt: string;
};

export type DailyTimelinePoint = {
  horizonDays: number;
  asOf: string;
  confirmedEnding: number;
  expectedEnding: number;
  plannedInbound: number;
  cumulativeDemand: number;
  supplyEvents: Array<{ pool: string; qty: number; availableAt: string; supplyClass: string }>;
};

export type DailyInventoryResult = {
  today: string;
  windowDays: number;
  totalLeadDays: number;
  stockoutDateConfirmed: string | null;
  stockoutDateExpected: string | null;
  safetyBreachDateConfirmed: string | null;
  reorderDate: string | null;
  tooLateForNewPo: boolean;
  uncoverableByNewPo: boolean;
  suggestedQty: number;
  points: DailyTimelinePoint[];
};

export function calcTimelineWindowDays(totalLeadDays: number, safetyStockDays: number): number;
export function displayHorizonDays(totalLeadDays: number, windowDays: number): number[];
export function projectDailyInventory(params: {
  lots: DailyLot[];
  today: string;
  reservedQty?: number;
  totalLeadDays: number;
  safetyStockDays: number;
  safetyStockQty: number;
  moq?: number;
  dailyDemandFn: (horizonDays: number) => number;
}): DailyInventoryResult;
```

公式（与 spec §5–§6 一致）：

- `W = clamp(ceil(totalLeadDays)+ceil(safetyStockDays), 90, 180)`
- `demandCum(k) = Σ dailyDemandFn(i) for i in [0,k]`（含当天）
- `supplyConfirmed(k) = max(0, Σ confirmed.qty where available_at≤asOf − reservedQty)`
- `supplyExpected(k)` 再加 expected；`plannedInbound(k)` 仅为计划档累计（不含确定/预计）
- `confirmedEnding = supplyConfirmed − demandCum`
- 展示锚点：`[0,7,15,30,min(totalLeadDays,W)]` 去重排序且 `≤ W`
- `suggestedQty = max(0, ceil(demandCum(kT)+safetyStockQty−supplyExpected(kT)))`，再抬 MOQ；`kT = min(totalLeadDays,W)`
- `avgDaily` 语义由调用方的 `dailyDemandFn` 体现；若所有日需求为 0：三个日期 `null`，`suggestedQty = 0`，`tooLateForNewPo/uncoverableByNewPo = false`
- `reorderDate`：有 `stockoutDateExpected` 则 `asOf_expected − totalLeadDays`（用现有 `subtractDaysIso`），早于 today 则钳 today 且 `tooLateForNewPo=true`
- `uncoverableByNewPo`：确定缺货的 `k < totalLeadDays`

`subtractDaysIso` 从 `./inventory-supply-lots.js` 导入（已存在）。`addDaysIso` 同样。

- [ ] **Step 1: Write the failing tests**

覆盖 spec §9：

1. `calcTimelineWindowDays(102, 14) === 116`；`calcTimelineWindowDays(10, 5) === 90`；`calcTimelineWindowDays(170, 20) === 180`
2. 占用：lots 仅海外 1000 @ today，`reservedQty=200`，`dailyDemandFn=()=>0`，`points` 中 k=0 的供给通过 `confirmedEnding===800`（需求 0）
3. 旧样例兼容：`totalLeadDays=45`、`safetyStockDays=45`（窗口 90，展示锚点含 45）。lots：海外 confirmed 1000 @ today、在途 confirmed 500 @ +7、本地 expected 300 @ +15、本地 expected 500 @ +25。`dailyDemandFn = () => 2600 / 46`（k=0..45 共 46 天累计 2600）。断言 horizon 45 的 `expectedEnding === -300`，`cumulativeDemand === 2600`。

4. 长周期样例（today=`2026-09-17`，`dailyDemandFn=()=>40`，reserved 0，`totalLeadDays=102`，`safetyStockDays=14`，`safetyStockQty=500`，moq 0）：

| class | pool | qty | availableAt |
|-------|------|-----|-------------|
| confirmed | overseas | 1000 | 2026-09-17 |
| confirmed | in_transit | 500 | 2026-09-24 |
| expected | local | 300 | 2026-11-08 |
| planned | local | 800 | 2026-12-28 |

断言：

- `windowDays === 116`
- k=7：`confirmedEnding === 1500 - 8*40`（1180），`expectedEnding === 1180`
- k=30：`expectedEnding === confirmedEnding`（均为 `1500 - 31*40 = 260`）
- 建议量不扣 800 在产（`suggestedQty === 2820`）

长周期测试代码：

```ts
const p7 = r.points.find((p) => p.horizonDays === 7)!;
assert.equal(p7.confirmedEnding, 1180);
assert.equal(p7.expectedEnding, 1180);
const p30 = r.points.find((p) => p.horizonDays === 30)!;
assert.equal(p30.confirmedEnding, 260);
assert.equal(p30.expectedEnding, 260);
assert.equal(r.suggestedQty, 2820);
assert.equal(r.uncoverableByNewPo, true);
assert.ok(r.safetyBreachDateConfirmed);
assert.ok(r.stockoutDateConfirmed);
assert.ok(r.safetyBreachDateConfirmed < r.stockoutDateConfirmed);
assert.equal(r.tooLateForNewPo, true);
assert.equal(r.reorderDate, '2026-09-17');
assert.equal(r.points.find((p) => p.horizonDays === 102)?.plannedInbound, 800);
```

5. 日需求全 0：`stockoutDateConfirmed === null`，`suggestedQty === 0`

保留旧 `projectInventoryTimeline` 测试直到 Task 3 删除调用后再删函数。本 task 新旧测试共存。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts`

Expected: FAIL（`projectDailyInventory` / `calcTimelineWindowDays` 未导出）

- [ ] **Step 3: Write minimal implementation**

在 `inventory-timeline.ts` 实现上述函数。扫描 `k=0..W` 找第一个 `confirmedEnding<=0`、`expectedEnding<=0`、`confirmedEnding<safetyStockQty`。`points` 只输出展示锚点；每个 point 的 `supplyEvents` 为 `availableAt<=asOf` 的全部 lots（含 planned）。`plannedInbound` = 计划档 `availableAt<=asOf` 的 qty 之和。

MOQ：复用现有 `calcSuggestedQtyFromTimeline`（把 `projectedOverseasAtTarget` 设为 `supplyExpected(kT)`，`cumulativeDemandAtTarget` 设为 `demandCum(kT)`）。

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-timeline.ts apps/web/server/lib/inventory-timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): project daily confirmed/expected inventory balances

EOF
)"
```

---

### Task 3: 快照占用 + 加载开放批次 + 改写 `buildSkuWarehouseTimeline`

**Files:**
- Modify: `apps/web/server/lib/inventory-snapshot.ts`
- Modify: `apps/web/server/lib/inventory-supply-lot-sync.ts`
- Modify: `apps/web/server/lib/inventory-timeline-service.ts`
- Modify: `apps/web/server/lib/inventory-planning-service.ts`
- Modify: `apps/web/server/lib/inventory-planning-service.test.ts`
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`
- Modify: `apps/web/server/tasks/stockAlert.ts`
- Modify: `apps/web/server/lib/inventory-timeline.ts`（删除已无引用的 `projectInventoryTimeline` / `findStockoutDate`）
- Modify: `apps/web/server/lib/inventory-timeline.test.ts`（删除旧锚点 describe）

**Interfaces:**
- Consumes: `classifySupplyLot`、`projectDailyInventory`、`DailyInventoryResult`
- Produces:

```ts
export async function buildSkuWarehouseTimeline(params: {
  skuId: string;
  warehouseCode: string;
  avgDaily: number;
  forecastMap?: Map<string, number>;
  totalLeadDays: number;
  safetyStockDays: number;
  safetyStockQty: number;
  moq?: number;
  today?: Date;
}): Promise<{
  timeline: DailyInventoryResult;
  suggestedQty: number;
  reservedQty: number;
}>;

export async function loadOpenLotsForTimeline(params: {
  skuId: string;
  warehouseCode: string;
  today?: string;
}): Promise<Array<{
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
  availableAt: string | null;
  productionStatus: 'in_production' | 'qc_pending' | 'completed' | null;
  shipReadyAt: string | null;
  etaEstimated: boolean;
  dateUnknown: boolean;
}>>;
```

`InventorySnapshot` 增加 `qtyReserved: number`。`getLatestInventorySnapshot` SELECT 增加 `qty_reserved`；在产仓返回 0。

删除或停止导出 `loadEligibleTimelineLots`（仅被本 service 使用）。新函数不过滤 `isLotEligibleForTimeline`，返回全部 `status=open` 行。

Service 逻辑：

1. `todayStr = (params.today ?? new Date()).toISOString().slice(0,10)`
2. `snap = await getLatestInventorySnapshot(...)`；`reservedQty = max(0, snap.qtyReserved)`
3. `forecastMap = params.forecastMap`；若缺省，`loadMergedPublishedForecastBySkuIds([skuId])` 取 `.get(skuId)?.map`
4. 加载 lots → `classifySupplyLot` → 丢掉 `excluded`
5. 若分类后没有任何 `confirmed` 海外批且 `snap.qtyAvailable>0`，补一条 `{supplyClass:'confirmed', pool:'overseas', qty:snap.qtyAvailable, availableAt:todayStr}`
6. `dailyDemandFn(k)`：`avgDaily<=0` 且 map 空则 0；否则对 `asOf=today+k` 调用 `getForecastDailyForDate(map, date, avgDaily)`（从 `./forecast-demand.js` 导入）
7. 调用 `projectDailyInventory`，返回 `{ timeline, suggestedQty: timeline.suggestedQty, reservedQty }`

**删除** service 对 `targetCoverageDays` / `projectInventoryTimeline` / `DEFAULT_TIMELINE_HORIZONS` 的依赖。

- [ ] **Step 1: Write the failing planning-view test for new timeline fields**

在 `inventory-planning-service.test.ts` 增加用例：`buildSkuPlanningView` 传入完整 `DailyInventoryResult` 形状的 `timeline` 与 `timelineSuggestedQty: 900`，断言 `suggestedQty===900`、`suggestedDate===timeline.reorderDate`、`stockoutDateEstimate===stockoutDateConfirmed`、`view.timeline.points` 原样透出。此时类型尚未改，测试应无法编译或断言失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-planning-service.test.ts`

Expected: FAIL（缺字段或 `stockoutDate` 旧形状）

- [ ] **Step 3: Implement snapshot + loader + service + caller signature**

`inventory-snapshot.ts` 的 `InventorySnapshot` 与 SELECT 增加 `qtyReserved`（`COALESCE(qty_reserved,0)`）。

`inventory-supply-lot-sync.ts`：将 `loadEligibleTimelineLots` 改名为 `loadOpenLotsForTimeline`，去掉 `isLotEligibleForTimeline` 过滤，映射 `productionStatus`/`shipReadyAt`/`etaEstimated`/`dateUnknown`。

`inventory-timeline-service.ts` 按上面 1–7 重写。

`inventory-planning-service.ts` `getSkuPlanningView` 调用改为新参数；`buildSkuPlanningView` 的 timeline 透出在 Task 4 改类型，本步先把 `built.timeline` 塞进 view（若类型不匹配则 Task 4 一起改——**并入 Step 3 改 view 类型**）。

规划 view `timeline` 改为 spec §7 字段（`stockoutDate` 删除，改 `stockoutDateConfirmed`）。`suggestedQty` 仍优先 `timelineSuggestedQty`。`stockoutDateEstimate` = `stockoutDateConfirmed ?? estimateStockoutDate(...)`。`suggestedDate`：若 `timeline.reorderDate` 有值则用之。

更新 `inventory-planning-service.test.ts`：给 `buildSkuPlanningView` 传入新 timeline 对象，断言字段原样透出，且 `suggestedQty`/`suggestedDate`/`stockoutDateEstimate` 被覆盖。

`replenishmentForecast.ts`：

```ts
const timelineResult = await buildSkuWarehouseTimeline({
  skuId: sku.id,
  warehouseCode: wh.code,
  avgDaily: health.avgDaily,
  totalLeadDays: health.totalLeadDays,
  safetyStockDays: health.coverage.safetyStockDays,
  safetyStockQty,
  moq: effectiveMoq || undefined,
});
if (timelineResult.suggestedQty > 0) {
  suggestedQty = timelineResult.suggestedQty;
  health.metrics.timelineSuggestedQty = timelineResult.suggestedQty;
  health.metrics.timelineStockoutDate = timelineResult.timeline.stockoutDateConfirmed;
  health.metrics.timelineReorderDate = timelineResult.timeline.reorderDate;
  health.metrics.timelinePoints = timelineResult.timeline.points.map((p) => ({
    horizonDays: p.horizonDays,
    confirmedEnding: p.confirmedEnding,
    expectedEnding: p.expectedEnding,
    cumulativeDemand: p.cumulativeDemand,
  }));
}
```

`stockAlert.ts` 同样换参数；`deriveHorizonAlerts` 的 `points` 暂用 `confirmedEnding` 作为 `projectedBalance`（Task 5 再加 uncoverable）。`stockoutDate: timeline.stockoutDateConfirmed`。

删除 `inventory-timeline.ts` 中仅被旧路径使用的 `projectInventoryTimeline` / `findStockoutDate`（若无引用）。更新 `inventory-timeline.test.ts` 删除旧 describe 或改为调用 `projectDailyInventory`。

- [ ] **Step 4: Run tests**

Run:

```
pnpm --filter @scm/web exec tsx --test server/lib/inventory-timeline.test.ts server/lib/inventory-planning-service.test.ts server/lib/inventory-horizon-alerts.test.ts server/lib/inventory-supply-lots.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/inventory-snapshot.ts apps/web/server/lib/inventory-supply-lot-sync.ts apps/web/server/lib/inventory-timeline-service.ts apps/web/server/lib/inventory-timeline.ts apps/web/server/lib/inventory-timeline.test.ts apps/web/server/lib/inventory-planning-service.ts apps/web/server/lib/inventory-planning-service.test.ts apps/web/server/tasks/replenishmentForecast.ts apps/web/server/tasks/stockAlert.ts
git commit -m "$(cat <<'EOF'
feat(inventory): wire daily timeline engine to snapshot lots and callers

EOF
)"
```

---

### Task 4: 预警枚举 `uncoverable_by_new_po` + 驾驶舱计数

**Files:**
- Modify: `packages/db/src/schema/reorder.ts`
- Create: `packages/db/drizzle/0094_alert_uncoverable_by_new_po.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`（追加 idx 96，tag `0094_alert_uncoverable_by_new_po`）
- Modify: `apps/web/server/lib/inventory-horizon-alerts.ts`
- Modify: `apps/web/server/lib/inventory-horizon-alerts.test.ts`
- Modify: `apps/web/server/lib/inventory-health-store.ts`（`findOpenStockAlert` 的 alertType 联合类型）
- Modify: `apps/web/server/tasks/stockAlert.ts`
- Modify: `apps/web/server/lib/planning-dashboard.ts`
- Modify: `apps/web/server/lib/planning-dashboard.test.ts`

**Interfaces:**
- Consumes: `DailyInventoryResult.uncoverableByNewPo`、`points[].confirmedEnding`
- Produces: `HorizonAlertType` 增加 `'uncoverable_by_new_po'`；`PlanningDashboard.uncoverableByNewPoCount: number`

SQL：

```sql
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'uncoverable_by_new_po';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

`deriveHorizonAlerts` 增加可选 `uncoverableByNewPo?: boolean`。为 true 时 push：

```ts
{
  alertType: 'uncoverable_by_new_po',
  horizonDays: null,
  projectedQty: 0,
  projectedStockoutDate: params.stockoutDate,
  thresholdQty: params.totalLeadDays,
}
```

`stockAlert.ts` 传入 `uncoverableByNewPo: timeline.uncoverableByNewPo`，points 映射：

```ts
points: timeline.points.map((p) => ({
  horizonDays: p.horizonDays,
  projectedBalance: p.confirmedEnding,
})),
```

`loadPlanningDashboard` 增加 count DISTINCT sku_id where `alert_type='uncoverable_by_new_po' AND is_resolved=false`。`aggregatePlanningDashboard` 透出该字段，缺省 0。

更新 `planning-dashboard.test.ts` 的 fixture 加 `uncoverableByNewPoCount: 0`（若测试构造 `PlanningDashboard`）。

- [ ] **Step 1: Write failing horizon + dashboard tests**

`inventory-horizon-alerts.test.ts`：在现有 points 上设 `uncoverableByNewPo: true`，断言存在 `alertType==='uncoverable_by_new_po'`。

`planning-dashboard.test.ts`（服务端 `apps/web/server/lib/planning-dashboard.test.ts`）：若 `aggregatePlanningDashboard` 有单测，断言新字段；否则给 `aggregatePlanningDashboard` 的 source 加 `uncoverableByNewPoCount: 3` 并断言输出 3。

- [ ] **Step 2: Run tests to verify fail**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-horizon-alerts.test.ts server/lib/planning-dashboard.test.ts`

Expected: FAIL（新断言 / 新字段）

- [ ] **Step 3: Implement enum, derive, stockAlert, dashboard**

按上面 SQL/类型/查询实现。

- [ ] **Step 4: Run tests**

Run:

```
pnpm --filter @scm/web exec tsx --test server/lib/inventory-horizon-alerts.test.ts server/lib/planning-dashboard.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/reorder.ts packages/db/drizzle/0094_alert_uncoverable_by_new_po.sql packages/db/drizzle/meta/_journal.json apps/web/server/lib/inventory-horizon-alerts.ts apps/web/server/lib/inventory-horizon-alerts.test.ts apps/web/server/lib/inventory-health-store.ts apps/web/server/tasks/stockAlert.ts apps/web/server/lib/planning-dashboard.ts apps/web/server/lib/planning-dashboard.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): alert when new PO cannot cover confirmed stockout

EOF
)"
```

---

### Task 5: 前端类型与 SKU 规划页 / 驾驶舱 / 预警 / 三池

**Files:**
- Modify: `apps/web/src/lib/api.ts`（`SkuPlanningView.timeline`、`PlanningDashboard.uncoverableByNewPoCount`）
- Modify: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- Modify: `apps/web/src/pages/PlanningDashboardPage.tsx`
- Modify: `apps/web/src/pages/PlanningDashboardPage.test.ts`
- Modify: `apps/web/src/pages/AlertsPage.tsx`
- Modify: `apps/web/src/pages/InventoryPoolsPage.tsx`

**Interfaces:**
- Consumes: Task 3/4 的 API JSON
- Produces: 无新路由

`SkuPlanningView['timeline']`：

```ts
timeline?: {
  today: string;
  windowDays: number;
  totalLeadDays: number;
  stockoutDateConfirmed: string | null;
  stockoutDateExpected: string | null;
  safetyBreachDateConfirmed: string | null;
  reorderDate: string | null;
  tooLateForNewPo: boolean;
  uncoverableByNewPo: boolean;
  suggestedQty: number;
  points: Array<{
    horizonDays: number;
    asOf: string;
    confirmedEnding: number;
    expectedEnding: number;
    plannedInbound: number;
    cumulativeDemand: number;
    supplyEvents: Array<{ pool: string; qty: number; availableAt: string; supplyClass: string }>;
  }>;
};
```

规划页：

- 四个 MetricCard 在时间轴卡片上方或替换「有效供给」那一行之下增加：确定缺货日、破安全库存日、最晚下单日、交期地平线预计余额（`points` 中 `horizonDays === item.leadTime.totalLeadDays` 或最大 horizon 的 `expectedEnding`）。保留原覆盖天数四格。
- 表列：节点、日期、确定余额、预计余额、累计需求、管道（`plannedInbound>0` 则 `管道 +N`）。`confirmedEnding<=0` 行红底。
- 脚注改为：「确定线=海外可售+真实 ETA 在途；预计线=已达出货交期的本地货（可用日=出货交期+剩余物流）；计划线（在产/估期）不填近窗、不扣建议量。」
- `tooLateForNewPo` / `uncoverableByNewPo` 用一行警示文案。

驾驶舱：`buildPlanningDashboardCards` 增加卡片 `{ label: '新计划已来不及', value: String(dashboard.uncoverableByNewPoCount ?? 0), href: '/inventory/alerts', highlight: count>0 }`。更新 `PlanningDashboardPage.test.ts` fixture。

预警：`TYPE_LABEL.uncoverable_by_new_po = '新计划已来不及'`；`stockout_horizon` 展示为「未来缺货（确定线）」。

三池：`PageHeader` description 改为「无可用日不进时间轴；估期在途进计划线、不进确定线」。黄条文案同步。

- [ ] **Step 1: Update dashboard helper test first**

`PlanningDashboardPage.test.ts` fixture 加 `uncoverableByNewPoCount: 4`，断言卡片 label 与 value `'4'`、href `'/inventory/alerts'`。

- [ ] **Step 2: Run test to verify fail**

Run: `pnpm --filter @scm/web exec tsx --test src/pages/PlanningDashboardPage.test.ts`

Expected: FAIL（缺字段 / 缺卡片）

- [ ] **Step 3: Implement UI + api types**

按上面改五个前端文件。规划页用可选链：无 `timeline.points` 时保持现有「尚未生成」降级（覆盖天数四格 + 提示去三池同步）。

- [ ] **Step 4: Run tests**

Run:

```
pnpm --filter @scm/web exec tsx --test src/pages/PlanningDashboardPage.test.ts server/lib/inventory-timeline.test.ts server/lib/inventory-planning-service.test.ts server/lib/inventory-horizon-alerts.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/SkuInventoryPlanningPage.tsx apps/web/src/pages/PlanningDashboardPage.tsx apps/web/src/pages/PlanningDashboardPage.test.ts apps/web/src/pages/AlertsPage.tsx apps/web/src/pages/InventoryPoolsPage.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): show daily timeline dates and uncoverable-PO KPI

EOF
)"
```

---

## Spec coverage

| Spec 节 | Task |
|---------|------|
| §3 架构 classify + projectDaily + service | 1, 2, 3 |
| §4 入档规则 | 1, 3（加载不过滤在产） |
| §5 每日公式 / 窗口 / 含当天需求 / qty_reserved | 2, 3 |
| §6 三个日期、建议量、7/15/30 确定线 | 2, 3, 4 |
| §7 API/页面五行双列、驾驶舱、预警、三池文案 | 3, 5 |
| §8 降级（无批次、无预测、avgDaily=0、抛错、灰灯） | 2, 3（灰灯已在补货任务，不改写建议条件） |
| §9 测试 | 1–5 |
| §10 不做项 | 全 task 不引入调拨/事件表/PMC 计划供给 |
| §11 取代五锚点 | 3 删除 `projectInventoryTimeline` 调用 |

灰灯不写建议：现网 `replenishmentForecast` 已按健康灯跳过，不另开 task。
