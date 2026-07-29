# 库存规划 P3（规划驾驶舱 + 可选 Z 值 + external_id）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P0–P2 口径稳定后，增加只读规划驾驶舱 KPI；为安全库存增加可选 Z 值方法（默认仍覆盖天数）；在关键实体铺齐 `source_system` / `external_id` 预留字段（不做真实 SAP）。

**Architecture:** 新建 `GET /api/planning/dashboard` 聚合健康快照、补货建议、跟单延误、发运延误、预测准确率等；新页 `/inventory/planning-dashboard`（或 `/pmc/planning-dashboard`）。扩展 `safety_stock_config` 字段 + `calcSafetyStockByMethod` 纯函数；仅当 method≠coverage_days 时覆盖 `safetyStockQty`/`safetyStockDays` 写回路径可选。external_id 列加到 skus/merchants/purchase_drafts/shipments/lead_time_profiles（已有的跳过）。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `tsx --test`

**Spec:** `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` §6.3、§10.2、§12、§13 P3  
**前置:** 基于 `feat/inventory-planning-p2`（含 P1+P2）

## Global Constraints

- **飞书同步列表只读结构（强制）**：不改大件备货、采购跟进、库存总览、库存查询的列/表头/行布局及 Feishu mapper 契约。
- 驾驶舱 **只读聚合**，不改飞书同步写入。
- Z 值方法 **默认关闭**；`safety_stock_method` 默认 `coverage_days`。
- 不做真实 SAP 接口、不做正式 PO/BOM、不改 FOB。
- 经营看板 `/dashboard` 可保留；规划驾驶舱为独立页面，避免与经营 KPI 混为一谈。
- 迁移从 `0059` 起。

## Locked decisions

| 项 | 决定 |
|----|------|
| 驾驶舱路由 | `/inventory/planning-dashboard`，菜单 `inventory.planning_dashboard` |
| Z 默认 | `coverage_days`；UI 在安全库存页可选切换 |
| Z 公式 P3 | 先实现 `z_demand`：`ceil(Z × σ_d × √L)`；`z_demand_leadtime` 可 stub 或同实现含 σ_L |
| Z 表 | 服务水平 → Z：90→1.28，95→1.65，97.5→1.96，99→2.33 |
| external_id | 缺啥补啥；已有列不重复加 |

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/safety-stock-z.ts` | Z 值计算纯函数 |
| `apps/web/server/lib/planning-dashboard.ts` | KPI 聚合 |
| `apps/web/server/routes/planning-dashboard.ts` | API |
| `apps/web/src/pages/PlanningDashboardPage.tsx` | 驾驶舱 UI |
| `packages/db/.../safety_stock_config` 扩展 | method 字段 |
| schema skus/merchants/drafts/shipments/profiles | external 字段 |
| `SafetyStockPage.tsx` | 方法选择（轻量） |

---

### Task 1: Z 值纯函数 + 单测

**Files:**
- Create: `apps/web/server/lib/safety-stock-z.ts`
- Create: `apps/web/server/lib/safety-stock-z.test.ts`

**Interfaces:**

```ts
export type SafetyStockMethod = 'coverage_days' | 'z_demand' | 'z_demand_leadtime';

export function zFromServiceLevel(serviceLevel: number): number; // 0.9→1.28 etc; unknown → throw or nearest

export function calcSafetyStockQty(params: {
  method: SafetyStockMethod;
  serviceLevel?: number; // 0.95 default when z_*
  demandStdDev: number;  // 日需求标准差
  totalLeadDays: number;
  avgDaily?: number;
  leadTimeStdDev?: number;
  safetyStockDays?: number; // coverage path
}): { safetyStockQty: number; z?: number; method: SafetyStockMethod };
```

- coverage_days：`ceil(avgDaily * safetyStockDays)`（avgDaily 缺则 0）
- z_demand：`ceil(Z * demandStdDev * sqrt(L))`
- z_demand_leadtime：`ceil(Z * sqrt(L*σ_d² + μ²*σ_L²))`

- [ ] **Step 1: TDD tests for table + formulas**

- [ ] **Step 2: Implement → GREEN**

- [ ] **Step 3: Commit** `feat: add optional Z-value safety stock calculator`

---

### Task 2: Schema — safety_stock_config 扩展

**Files:**
- Modify: `packages/db/src/schema/inventory.ts` (`safetyStockConfig`)
- Create: `packages/db/drizzle/0059_safety_stock_method.sql`
- journal

**Columns:**

```text
safety_stock_method varchar/enum default 'coverage_days'
service_level numeric(4,3) nullable  -- e.g. 0.950
demand_std_dev numeric nullable
lead_time_std_dev numeric nullable
```

- [ ] **Step 1: Migration + schema**

- [ ] **Step 2: Commit** `feat(db): add safety stock method fields for Z-value option`

---

### Task 3: 安全库存 API/页接入可选方法

**Files:**
- Modify: safety-stock routes / calculate handler
- Modify: `SafetyStockPage.tsx` — 下拉方法 + 服务水平；计算按钮调用 Z 或覆盖天数
- DO NOT change Feishu pages

当 method 为 z_* 且缺 σ_d：用现有 `calcDailyStats().stdDev` 填入再算。

- [ ] **Step 1: Wire calculate endpoint**

- [ ] **Step 2: UI 最小表单字段**

- [ ] **Step 3: Commit** `feat: allow switching safety stock method to Z-value`

---

### Task 4: Schema — external_id 铺齐

**Files:**
- Audit then ALTER：`skus`, `merchants`, `purchase_drafts`, `shipments`, `lead_time_profiles`, `pmc_plans`（按缺补）
- Create: `packages/db/drizzle/0060_external_ids.sql`

每表至少：`source_system varchar(50)`, `external_id varchar(100)`；有行概念的再加 `external_line_id`（pmc_plan_items / 可选）。

跳过已有列。

- [ ] **Step 1: Diff schema vs needed → SQL**

- [ ] **Step 2: Commit** `feat(db): add source_system and external_id placeholders`

---

### Task 5: 规划驾驶舱聚合服务

**Files:**
- Create: `apps/web/server/lib/planning-dashboard.ts`
- Create: `apps/web/server/lib/planning-dashboard.test.ts`（纯聚合或 SQL mock）

**KPI 输出（只读）：**

```ts
type PlanningDashboard = {
  skuActiveCount: number;
  healthRedCount: number;      // 未来断货风险近似：health red
  healthYellowCount: number;
  belowRopCount: number;       // from alerts or health
  pendingSuggestions: number;
  delayedShipments: number;
  delayedDraftsEtaAvailable: number; // eta_available < today & not received
  stockoutRateApprox?: number; // optional: red/active
  forecastHighMapeCount?: number; // reuse dashboard forecastContext if easy
  inventoryTurnoverDaysApprox?: number | null; // optional skip if no amount data
  calculatedAt: string;
};
```

数据来源：`inventory_health_snapshots` 最新、`reorder_suggestions` pending、`shipments` delay helper、`purchase_drafts`。

- [ ] **Step 1: Implement aggregator + tests where pure**

- [ ] **Step 2: Commit** `feat: aggregate planning dashboard KPIs`

---

### Task 6: 驾驶舱 API + 页面 + 菜单

**Files:**
- Create: `routes/planning-dashboard.ts` — `GET /api/planning/dashboard` requireMenu `inventory.planning_dashboard`
- Create: `PlanningDashboardPage.tsx` — KPI 卡片 + 链到 suggestions/tracking/shipments/planning
- router, api.ts, seed, `0061_planning_dashboard_menu.sql`

UI：淘宝橙主题既有 Card；中文标签；点击跳转深层列表。**不改**经营看板必选字段，可在经营看板加一行链到规划驾驶舱（可选一行 Link，不算改飞书）。

- [ ] **Step 1: API + page + menu**

- [ ] **Step 2: Commit** `feat: add inventory planning dashboard page`

---

### Task 7: P3 验收回归

```bash
pnpm --filter @scm/web exec tsx --test server/lib/safety-stock-z.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/planning-dashboard.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/shipment-delay.test.ts
```

| 项 | 判定 |
|----|------|
| Z 方法单测：95% / σ / L 公式正确 | |
| 默认 coverage_days 行为不变 | |
| 驾驶舱 KPI 可返回 | |
| external 列存在 | |
| 飞书四列表未改 | |
| 无 SAP 真实接口 | |

---

## Spec coverage

| Spec | Task |
|------|------|
| §6.3 Z 值可选 | 1–3 |
| §12 external 预留 | 4 |
| §10.2 规划驾驶舱 | 5–6 |
| 飞书冻结 | Global + 7 |
| P4 SAP | 不做 |

## Out of scope

真实 SAP、正式 PO、改飞书列表、FOB、完整库存金额周转若缺数据则 KPI 标「暂无」。

---

**Plan:** `docs/superpowers/plans/2026-07-29-inventory-planning-p3.md`
