# 库存规划 P2（断货修正 + 发运轻模型 + 延误列表）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 历史回退日需求支持断货修正（有效销售速度）；新增与 FOB 解耦的发运批次/节点人工维护；提供延误列表，与内部 PMC 跟单可售日联动。

**Architecture:** 纯函数计算 `effectiveDailyDemand`（有库存天数口径）；健康/补货 historical 回退优先使用该值并写入 metrics。新建 `shipments` + `shipment_milestones`；API + 新页面 `/pmc/shipments`（非飞书列表）。延误 = 相对计划节点的逾期天数，列表聚合跟单 `eta_available` 与发运节点。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `tsx --test`

**Spec:** `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` §7.2、§9、§13 P2  
**前置:** P0 已合 main；P1 在 `feat/inventory-planning-p1`（建议先合 P1 再开 P2 分支，或基于 P1 继续分支）

## Global Constraints

- **飞书同步列表只读结构（强制，同 P1）**：不得调整列/表头/行布局：
  - 大件备货 `/procurement/bulk-stock`
  - 采购跟进 `/procurement/follow-up`
  - 库存总览 `/inventory/overview`
  - 库存查询 `/inventory/query`
  - 相关 Feishu mapper / 同步契约
  - **允许**：新建 `/pmc/shipments`、增强 `/pmc/tracking`、补货建议 metrics 文案、SKU 规划页展示断货修正标记
- 与 FOB `/logistics/fob-*` **解耦**；不做船司 API。
- 不做 Z 值、规划驾驶舱（P3）、正式 PO、BOM、重建预测台。
- 断货修正仅影响 **historical 回退**；已发布预测仍优先。
- 中文 UI；迁移号从磁盘最大 +1 起（P1 已用到 `0056` → 本 plan 用 `0057` shipments、`0058` 菜单）。

## Locked decisions (P2)

| 项 | 决定 |
|----|------|
| 有库存判定 | 优先：当日/对应日 `inventory_records.qty_available > 0`（按 SKU+仓）；无记录日视为「未知」，**不计入分母也不剔除销量**时改用日历均摊并 `stockoutAdjusted: false` |
| 统计窗口 | 默认与现 EOQ/历史一致 **90 天**（可参数化） |
| 发运页 | `/pmc/shipments`，菜单 `pmc.shipments` |
| 一票一 SKU | 首版 `shipments.sku_id` + `qty`；不拆明细表 |
| 延误列表 | 同页 Tab 或筛选：逾期未完成里程碑 + 跟单 `eta_available < today` 且未收货 |

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/effective-daily-demand.ts` | 断货修正纯函数 |
| `apps/web/server/lib/effective-daily-demand.test.ts` | 单测 |
| `apps/web/server/lib/replenishment.ts` / `inventory-health-service.ts` | 接入修正后的 historicalAvgDaily |
| `packages/db/src/schema/shipments.ts` | shipments / milestones |
| `packages/db/drizzle/0057_shipments.sql` | 迁移 |
| `packages/db/drizzle/0058_shipments_menu.sql` | 菜单 |
| `apps/web/server/routes/shipments.ts` | CRUD + 延误查询 |
| `apps/web/src/pages/ShipmentsPage.tsx` | 列表/节点/延误 |
| `apps/web/src/pages/PurchaseTrackingPage.tsx` | 可选：链到关联发运（不改飞书页） |
| `router.tsx` / `api.ts` / `seed.ts` | 路由权限 |

---

### Task 1: 断货修正纯函数

**Files:**
- Create: `apps/web/server/lib/effective-daily-demand.ts`
- Create: `apps/web/server/lib/effective-daily-demand.test.ts`

**Interfaces:**

```ts
export type DailySale = { saleDate: string; qtySold: number };
export type DailyAvailability = { date: string; qtyAvailable: number };

export type EffectiveDailyDemandResult = {
  avgDaily: number;
  stockoutAdjusted: boolean;
  windowDays: number;
  inStockDays: number;
  soldOnInStockDays: number;
  calendarSold: number;
};

export function calcEffectiveDailyDemand(params: {
  sales: DailySale[];
  availability: DailyAvailability[]; // 可为空
  windowDays?: number;
  asOf?: Date;
}): EffectiveDailyDemandResult;
```

规则：

1. 取 `asOf` 往前 `windowDays`（默认 90）日历日。
2. 若 `availability` 覆盖该窗口（至少有 1 天记录）：  
   - `inStockDays` = 窗口内 `qtyAvailable > 0` 的天数  
   - `soldOnInStockDays` = 这些日期的销量之和  
   - `avgDaily = inStockDays > 0 ? soldOnInStockDays / inStockDays : 0`  
   - `stockoutAdjusted: true`
3. 若无可用库存历史：`avgDaily = calendarSold / windowDays`，`stockoutAdjusted: false`。

- [ ] **Step 1: 写失败测试**（30 天窗、10 天断货、销量 1000 → 有效日需求 50）

```ts
it('adjusts for stockout days', () => {
  const sales = /* 20 days × 50 */;
  const availability = /* 20 days >0, 10 days =0 */;
  const r = calcEffectiveDailyDemand({ sales, availability, windowDays: 30, asOf: new Date('2026-07-01') });
  assert.equal(r.stockoutAdjusted, true);
  assert.equal(r.inStockDays, 20);
  assert.equal(r.avgDaily, 50);
});

it('falls back to calendar average without availability', () => {
  const r = calcEffectiveDailyDemand({
    sales: [{ saleDate: '2026-06-01', qtySold: 90 }],
    availability: [],
    windowDays: 30,
    asOf: new Date('2026-07-01'),
  });
  assert.equal(r.stockoutAdjusted, false);
  assert.equal(r.avgDaily, 3); // 90/30
});
```

- [ ] **Step 2: RED → 实现 → GREEN**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add stockout-adjusted effective daily demand helper"
```

---

### Task 2: 接入健康/补货 historical 回退

**Files:**
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Modify: `apps/web/server/lib/replenishment.ts`（若 `calcDailyStats` 可委托）
- Optional loader: 从 `inventory_records` 按 SKU+仓拉窗口内每日最新 qty_available（按 recorded_date）
- Modify: metrics + `reorder-suggestion-explain` 展示 `stockoutAdjusted`

**Interfaces:**
- 在算 `eoqCalc.avgDaily` / historical 路径前调用 effective demand；metrics 增加：

```ts
{
  stockoutAdjusted: boolean,
  inStockDays: number,
  demandWindowDays: number,
}
```

加载可用性策略（实现选一，文档写死）：

- **A（推荐 MVP）**：对窗口内每个有 `inventory_records` 的 `recorded_date` 取该日最新一条；缺日不插值。仅当 `availability.length >= minCoverage`（如窗口的 30%）才 `stockoutAdjusted: true`，否则日历均摊。
- 常量：`MIN_AVAILABILITY_COVERAGE = 0.3`

- [ ] **Step 1: 单测 loader 合并或 health metrics shape**

- [ ] **Step 2: 实现接入；预测路径不变**

- [ ] **Step 3: 更新 `formatSuggestionExplain`：历史来源时标注「断货修正」**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: use stockout-adjusted demand for historical replenishment fallback"
```

---

### Task 3: Schema `shipments` + `shipment_milestones`

**Files:**
- Create: `packages/db/src/schema/shipments.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0057_shipments.sql`
- Modify: journal

**Interfaces:**

```ts
// shipments
id, shipmentNo unique, draftId?, planItemId?, skuId, qty,
containerNo?, bookingRef?, trackingNo?, transportMode?,
status: varchar // booked|loaded|departed|arrived_port|customs|received_wh|available|cancelled
etaAvailable?, sourceSystem?, externalId?, createdAt, updatedAt

// shipment_milestones
id, shipmentId, milestone, plannedAt?, actualAt?, remark?, createdAt
unique(shipmentId, milestone)
```

- [ ] **Step 1: Schema + SQL + journal**

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(db): add shipments and shipment_milestones tables"
```

---

### Task 4: Shipments API

**Files:**
- Create: `apps/web/server/lib/shipment-delay.ts`（纯函数算 delayDays）
- Create: `apps/web/server/lib/shipment-delay.test.ts`
- Create: `apps/web/server/routes/shipments.ts`
- Modify: `apps/web/server/index.ts`

**Interfaces:**
- `GET /api/shipments` — list + optional `?delayed=1`
- `POST /api/shipments` — create
- `PATCH /api/shipments/:id`
- `POST /api/shipments/:id/milestones` — upsert milestone planned/actual
- `GET /api/shipments/delays` — 聚合延误行
- `requireMenu('pmc.shipments')`

延误规则：

```ts
export function calcMilestoneDelayDays(plannedAt: string | null, actualAt: string | null, today: Date): number | null
// planned 有值且 (actual ?? today) > planned → 天数差；否则 null/0
```

列表 `delayed=1`：存在任一里程碑 delay>0，或 `eta_available < today` 且 status 未到 `available`。

- [ ] **Step 1: delay 纯函数 TDD**

- [ ] **Step 2: CRUD routes**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add shipments API with delay calculation"
```

---

### Task 5: 发运页 + 菜单 + 延误 Tab

**Files:**
- Create: `apps/web/src/pages/ShipmentsPage.tsx`
- Modify: `router.tsx`、`api.ts`、`seed.ts`
- Create: `packages/db/drizzle/0058_shipments_menu.sql` + journal

**UI（中文）：**
- Tab「全部发运」：表格（单号、SKU、数量、状态、柜号、预计可售、关联跟单）
- Tab「延误」：筛选 delayed
- 详情/抽屉：维护 7 个里程碑 planned/actual
- **禁止**改飞书采购/库存列表页

- [ ] **Step 1: 页面 + 路由**

- [ ] **Step 2: 菜单 migration `pmc.shipments` path `/pmc/shipments`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add PMC shipments page and delay tab"
```

---

### Task 6: 跟单与发运弱关联

**Files:**
- Modify: `PurchaseTrackingPage.tsx` — 若有 `draftId` 关联发运，显示链接「查看发运」到 `/pmc/shipments?draftId=`
- Modify: 创建发运时可带 `draftId`（从跟单跳转预填）

不改飞书跟进列表。

- [ ] **Step 1: 链接 + query 预填**

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: link PMC tracking drafts to shipments"
```

---

### Task 7: SKU 规划页展示断货修正标记

**Files:**
- Modify: `inventory-planning-service.ts` / `SkuInventoryPlanningPage.tsx`

当 `demandSource === 'historical' && stockoutAdjusted`，展示「日需求已按有库存天数修正」。

- [ ] **Step 1: 透出字段 + UI 一行说明**

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: show stockout-adjusted demand flag on SKU planning page"
```

---

### Task 8: P2 验收回归

```bash
pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/shipment-delay.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/lead-time-resolver.test.ts
```

手工/代码核对：

| 项 | 判定 |
|----|------|
| 有断货史样本：修正后 avgDaily > 日历均摊 | |
| 无库存历史：stockoutAdjusted false | |
| 可创建发运并维护节点 | |
| 延误 Tab 可见逾期 | |
| 飞书四列表列结构未改 | |
| 无 FOB 模块改动 | |

可选：设计 §13 标注 P2 实现计划路径。

---

## Spec coverage

| Spec | Task |
|------|------|
| §7.2 断货修正 | 1–2, 7 |
| §9 shipments / milestones | 3–5 |
| §9.3 延误列表 | 4–5 |
| 跟单联动 | 6 |
| 飞书冻结 | Global + Task 8 |
| P3 驾驶舱 / Z 值 | 不做 |

## Out of scope

船司 API、FOB 合并、多 SKU 一票明细表、库存总览改列、预测工作台重建、Z 值、驾驶舱。

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-29-inventory-planning-p2.md`.**

**建议分支策略：** 先将 `feat/inventory-planning-p1` 合入 main（或基于 P1 开 `feat/inventory-planning-p2`），再执行本 plan。

**Two execution options:**

1. **Subagent-Driven（推荐）**  
2. **Inline Execution**  

选哪一种？（若需先合 P1 再说一声。）
