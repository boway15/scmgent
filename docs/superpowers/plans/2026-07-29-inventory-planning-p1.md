# 库存规划 P1（提前期 Profile + 可解释建议 + SKU 规划页）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P0 库存位置与预计可售日之上，落地路线级提前期配置、补货建议可解释展示、跟单关键里程碑日期，以及单 SKU 库存规划页。

**Architecture:** 新建 `lead_time_profiles` 表；扩展 `LeadTimeBreakdown` 为 6 段并保持 `shippingDays`/`inboundBufferDays` 兼容别名；`lead-time-resolver` 按商家+目的仓（运输方式可空）解析 profile。健康/补货 metrics 写入 `profileId` 与分段天数。前端增强建议展开区与新建 `/inventory/planning/:skuId`。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、TanStack Query、Node `tsx --test`

**Spec:** `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` §5、§8.2、§10、§13 P1、§16.1  
**前置:** P0 已合入 `main`（`resolveInventoryPosition`、`eta_available`）

## Global Constraints

- **飞书同步列表只读结构（强制）**：以下页面/列表的**列结构、字段展示、表头与行信息布局不得调整**（数据来自飞书同步，改列会破坏业务对照）：
  - 大件备货（`/procurement/bulk-stock` 及对应飞书列表）
  - 采购跟进/飞书采购跟单（`/procurement/follow-up` 及对应飞书列表）
  - 库存总览（`/inventory/overview`）
  - 库存查询（`/inventory/query`）
  - 相关 Feishu mapper / 同步写入路径的**对外列表字段契约**一并冻结
  - **允许**：内部 PMC 跟单 `/pmc/tracking`、补货建议、新建 SKU 规划页、提前期配置页（非飞书同步列表）
- 提前期首版维度：**商家 + 目的仓**；`transport_mode` / `origin_location` **可空**（匹配时优先更具体行）。
- `LeadTimeBreakdown` 新增 6 段，同时保留 `shippingDays`（= booking+transit+customs）与 `inboundBufferDays`（= inboundDays）供旧调用方。
- 解析优先级：精确 profile → 仓默认 profile/`warehouses` → 商家/供货/SKU 生产天 → 代码常量。
- SKU 规划页路由锁定：`/inventory/planning/:skuId`，菜单 `inventory.planning`（挂在库存下）。
- 补货与 ETA 继续使用「预计可售日」语义；不改 FOB、不做 shipments（P2）、不做断货修正（P2）、不做 Z 值/驾驶舱（P3）。
- 中文 UI；标识符英文。扩展现表/服务，禁止平行规划主路径。
- 迁移号：磁盘已有 `0052` → 本 plan 用 `0053`（lead_time_profiles）与 `0054`（跟单里程碑 + 菜单）；若本地编号冲突，以磁盘最大 +1 起连续编号并同步 journal。

## Locked product decisions (P1)

| 项 | 决定 |
|----|------|
| Profile 维 | 商家×目的仓优先；运输方式可空 |
| 规划页菜单 | 库存模块 `/inventory/planning/:skuId` |
| 建议可解释 | 增强现有「查看依据」，展示 position + lead breakdown + 触发原因 |
| 里程碑 | 跟单表加日期列；不必上独立 production_plan |

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/db/src/schema/lead-time.ts`（新） | `lead_time_profiles` |
| `packages/db/src/schema/procurement.ts` | 跟单里程碑日期列 |
| `packages/db/drizzle/0053_*.sql` / `0054_*.sql` | 迁移 + 菜单 |
| `apps/web/server/lib/replenishment-coverage.ts` | 扩展 breakdown / total |
| `apps/web/server/lib/lead-time-resolver.ts` | profile 解析 |
| `apps/web/server/lib/lead-time-resolver.test.ts` | 单测 |
| `apps/web/server/lib/inventory-health-service.ts` | metrics 写入 profile/分段 |
| `apps/web/server/routes/lead-time-profiles.ts`（新） | CRUD 或 list+upsert |
| `apps/web/server/routes/procurement.ts` | 里程碑 PATCH/GET |
| `apps/web/server/routes/inventory-planning.ts`（新）或 inventory.ts | SKU 规划聚合 API |
| `apps/web/src/pages/ReorderSuggestionsPage.tsx` | 可解释面板 |
| `apps/web/src/pages/SkuInventoryPlanningPage.tsx`（新） | SKU 规划页 |
| `apps/web/src/pages/PurchaseTrackingPage.tsx` | 里程碑字段 |
| `apps/web/src/router.tsx` / `api.ts` / seed 菜单 | 路由与权限 |

---

### Task 1: 扩展 `LeadTimeBreakdown`（纯函数，兼容旧字段）

**Files:**
- Modify: `apps/web/server/lib/replenishment-coverage.ts`
- Modify: `apps/web/server/lib/replenishment-coverage.test.ts`

**Interfaces:**
- Produces:

```ts
export type LeadTimeBreakdown = {
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
  /** compat = booking + transit + customs */
  shippingDays: number;
  /** compat = inboundDays */
  inboundBufferDays: number;
  totalLeadDays: number;
  profileId?: string | null;
};

export function calcTotalLeadTime(params: {
  productionDays: number;
  domesticDays?: number;
  bookingDays?: number;
  transitDays?: number;
  customsDays?: number;
  inboundDays?: number;
  /** legacy: if provided without booking/transit/customs, treat as transitDays */
  shippingDays?: number;
  inboundBufferDays?: number;
}): LeadTimeBreakdown;
```

- [ ] **Step 1: Write failing tests**

```ts
it('sums six segments and sets compat aliases', () => {
  const lt = calcTotalLeadTime({
    productionDays: 25,
    domesticDays: 3,
    bookingDays: 7,
    transitDays: 35,
    customsDays: 5,
    inboundDays: 3,
  });
  assert.equal(lt.totalLeadDays, 78);
  assert.equal(lt.shippingDays, 47); // 7+35+5
  assert.equal(lt.inboundBufferDays, 3);
});

it('accepts legacy shippingDays + inboundBufferDays', () => {
  const lt = calcTotalLeadTime({
    productionDays: 50,
    shippingDays: 45,
    inboundBufferDays: 7,
  });
  assert.equal(lt.transitDays, 45);
  assert.equal(lt.bookingDays, 0);
  assert.equal(lt.customsDays, 0);
  assert.equal(lt.totalLeadDays, 102);
});
```

- [ ] **Step 2: Run RED**

`pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts`

- [ ] **Step 3: Implement `calcTotalLeadTime` 扩展**；更新现有断言若字段形状变了（保证旧测试仍绿）。

- [ ] **Step 4: Run GREEN + Commit**

```bash
git add apps/web/server/lib/replenishment-coverage.ts apps/web/server/lib/replenishment-coverage.test.ts
git commit -m "$(cat <<'EOF'
feat: extend lead time breakdown to six segments with compat aliases

EOF
)"
```

---

### Task 2: Schema `lead_time_profiles` + 迁移

**Files:**
- Create: `packages/db/src/schema/lead-time.ts`
- Modify: `packages/db/src/schema/index.ts`（export）
- Create: `packages/db/drizzle/0054_lead_time_profiles.sql`（若 Task 3 先占 0053，本任务用 0054；**统一：本任务 0053_lead_time_profiles，Task 4 跟单用 0054**）
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces table `lead_time_profiles` 字段对齐 spec §5.3（transport_mode / origin_location nullable）

- [ ] **Step 1: 写 schema**

```ts
export const transportModeEnum = pgEnum('transport_mode', [
  'fcl', 'lcl', 'air', 'express', 'rail', 'truck_air', 'direct',
]);

export const leadTimeProfiles = pgTable('lead_time_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantCode: varchar('merchant_code', { length: 100 }),
  originLocation: varchar('origin_location', { length: 100 }),
  destinationWarehouseCode: varchar('destination_warehouse_code', { length: 100 }).notNull(),
  transportMode: transportModeEnum('transport_mode'),
  productionDays: integer('production_days').notNull().default(0),
  domesticDays: integer('domestic_days').notNull().default(0),
  bookingDays: integer('booking_days').notNull().default(0),
  transitDays: integer('transit_days').notNull().default(0),
  customsDays: integer('customs_days').notNull().default(0),
  inboundDays: integer('inbound_days').notNull().default(0),
  leadTimeStdDev: integer('lead_time_std_dev'),
  isDefault: boolean('is_default').notNull().default(false),
  sourceSystem: varchar('source_system', { length: 50 }),
  externalId: varchar('external_id', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

唯一性建议：部分唯一索引难在 PG 表达可空列——应用层保证「同 merchant+warehouse+mode 仅一条 is_default」；SQL 可加普通索引 `(merchant_code, destination_warehouse_code)`。

- [ ] **Step 2: SQL + journal idx**

```sql
CREATE TYPE "public"."transport_mode" AS ENUM ('fcl','lcl','air','express','rail','truck_air','direct');
CREATE TABLE IF NOT EXISTS "lead_time_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_code" varchar(100),
  "origin_location" varchar(100),
  "destination_warehouse_code" varchar(100) NOT NULL,
  "transport_mode" "public"."transport_mode",
  "production_days" integer DEFAULT 0 NOT NULL,
  "domestic_days" integer DEFAULT 0 NOT NULL,
  "booking_days" integer DEFAULT 0 NOT NULL,
  "transit_days" integer DEFAULT 0 NOT NULL,
  "customs_days" integer DEFAULT 0 NOT NULL,
  "inbound_days" integer DEFAULT 0 NOT NULL,
  "lead_time_std_dev" integer,
  "is_default" boolean DEFAULT false NOT NULL,
  "source_system" varchar(50),
  "external_id" varchar(100),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "lead_time_profiles_merchant_wh_idx"
  ON "lead_time_profiles" ("merchant_code", "destination_warehouse_code");
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(db): add lead_time_profiles for route lead-time config

EOF
)"
```

---

### Task 3: `resolveLeadTimeForSkuWarehouse` 接入 profile

**Files:**
- Modify: `apps/web/server/lib/lead-time-resolver.ts`
- Create: `apps/web/server/lib/lead-time-resolver.test.ts`

**Interfaces:**
- Consumes: `leadTimeProfiles`, `calcTotalLeadTime`
- Produces: `ResolvedLeadTime`（含 6 段 + `profileId`）
- Params 增加可选 `transportMode?: string | null`

匹配顺序（实现为纯函数 `pickLeadTimeProfile(rows, { merchantCode, warehouseCode, transportMode })` 便于单测）：

1. merchant + warehouse + mode（mode 非空时）
2. merchant + warehouse + mode IS NULL
3. merchant IS NULL + warehouse + mode（仓默认）
4. merchant IS NULL + warehouse + mode IS NULL
5. 回退现有 merchants/skuSuppliers/warehouses/常量路径，`profileId: null`

- [ ] **Step 1: 单测 pick + 回退**

```ts
it('prefers merchant+warehouse+mode over merchant+warehouse', () => {
  const picked = pickLeadTimeProfile(
    [
      { id: 'a', merchantCode: 'M1', destinationWarehouseCode: 'US-WEST', transportMode: null, productionDays: 20, ...zeros },
      { id: 'b', merchantCode: 'M1', destinationWarehouseCode: 'US-WEST', transportMode: 'fcl', productionDays: 25, ...zeros },
    ],
    { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'fcl' },
  );
  assert.equal(picked?.id, 'b');
});
```

- [ ] **Step 2: RED → 实现 → GREEN**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: resolve lead time from lead_time_profiles with legacy fallback

EOF
)"
```

---

### Task 4: Profile API（list + upsert）+ 最小管理 UI（可选简化）

**Files:**
- Create: `apps/web/server/routes/lead-time-profiles.ts`
- Modify: `apps/web/server/index.ts` 挂载
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/LeadTimeProfilesPage.tsx`（简单表格 CRUD）
- Modify: `apps/web/src/router.tsx`
- Migration/seed: 菜单 `data.lead_time` 或 `inventory.lead_time` path `/inventory/lead-time`（挂库存下，sort 靠后）

**Interfaces:**
- `GET /api/lead-time-profiles?warehouse=&merchant=`
- `POST /api/lead-time-profiles` upsert body
- `DELETE /api/lead-time-profiles/:id`
- `requireMenu('inventory.lead_time')`

若时间紧：**可只做 API + 用 Import/临时页面**；但本 plan 要求至少只读列表 + 新建表单一页，便于验收「换 profile 后建议变化」。

- [ ] **Step 1: 路由 + 菜单 SQL**（可并入 `0053` 或单独 `0054_lead_time_menu.sql`）

- [ ] **Step 2: 页面：列表、表单字段（生产/订舱/干线/清关/入仓/国内）**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add lead time profile API and admin page

EOF
)"
```

---

### Task 5: 健康/补货 metrics 写入完整 lead + profileId

**Files:**
- Modify: `apps/web/server/lib/inventory-health-service.ts`
- Modify: `apps/web/server/lib/inventory-health-service.test.ts`（metrics shape）
- Modify: `apps/web/server/tasks/replenishmentForecast.ts`（若写 suggestion.reason/metrics）

**Interfaces:**
- metrics 增加：

```ts
{
  leadTimeProfileId: string | null,
  productionDays, domesticDays, bookingDays, transitDays, customsDays, inboundDays,
  shippingDays, inboundBufferDays, totalLeadDays,
  inventoryPosition: { ... } // 已有 P0
}
```

- [ ] **Step 1: 断言 build metrics 含新字段**

- [ ] **Step 2: 实现 — `computeSkuWarehouseHealth` 已调 resolver，展开 breakdown 写入 metrics**

- [ ] **Step 3: 确认 `calcCoverageReplenishmentFromForecast` 仍吃 production/shipping/inbound（compat）**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: persist lead-time profile breakdown in health metrics

EOF
)"
```

---

### Task 6: 跟单里程碑日期字段

**Files:**
- Modify: `packages/db/src/schema/procurement.ts`
- Create: `packages/db/drizzle/0054_purchase_draft_milestones.sql`
- Modify: journal
- Modify: `apps/web/server/routes/procurement.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/PurchaseTrackingPage.tsx`

**Interfaces:** 新增列（date, nullable）：

```text
planned_production_done_date
actual_production_done_date
planned_pickup_date
etd
eta_port
customs_done_date
eta_warehouse
```

（`eta_available` 已有）。可选 `transport_mode` varchar。

PATCH 允许更新上述字段；GET 返回。UI：折叠「里程碑」区域或次要行内编辑；**主展示仍是预计可售日**。

- [ ] **Step 1: Schema + SQL + journal**

- [ ] **Step 2: API**

- [ ] **Step 3: UI（至少 etd / eta_port / eta_warehouse / eta_available）**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add purchase draft milestone dates for PMC tracking

EOF
)"
```

---

### Task 7: 补货建议可解释 UI

**Files:**
- Modify: `apps/web/src/pages/ReorderSuggestionsPage.tsx`
- Optional: `apps/web/src/lib/reorder-suggestion-explain.ts`（纯函数格式化文案，可单测）

**Interfaces:**
- Produces: 展开区展示：

```text
触发原因：{reason 或由 health/coverage 推导}
库存位置：{effectiveQty} = 可售 {a} + 生产 {p} + 在途 {t} + 已确认未生产 {c} − 已分配 {r}
日均需求：{avgDaily}（{demandSource}）
总提前期：{total} = 生产 {..} + … 
安全库存天数 / 目标覆盖 / 建议量 / 建议下单日 / profileId
```

从 `item.metrics` 读；缺字段时降级显示 `item.reason`。

文案更新页头：有效供给含「库存位置（可售+在途+生产/跟单补缺+已确认开放−已分配）」。

链接：SKU → `/inventory/planning/${skuId}`（Task 8 路由就绪后可用；可先链过去）。

- [ ] **Step 1: 纯函数 `formatSuggestionExplain(metrics, item)` + 单测**

- [ ] **Step 2: 接入展开区**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: explain reorder suggestions with position and lead-time breakdown

EOF
)"
```

---

### Task 8: SKU 库存规划页 + API

**Files:**
- Create: `apps/web/server/lib/inventory-planning-service.ts`
- Modify: `apps/web/server/routes/inventory.ts`（或新 route 文件）
- Create: `apps/web/src/pages/SkuInventoryPlanningPage.tsx`
- Modify: `router.tsx`、`api.ts`
- Migration: 菜单 `inventory.planning` path `/inventory/planning`（列表可先重定向到总览带说明；详情 `/:skuId`）
- Seed: `packages/db/src/seed.ts` + SQL migration INSERT menu + role_menus for admin

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
  etaAvailableNearest?: string | null; // 最近跟单可售日
  stockoutDateEstimate?: string | null; // coverageDays 推算，简化
};
```

实现：复用 `resolveInventoryPosition` + `resolveLeadTimeForSkuWarehouse` + 与 health 相同的需求解析（可抽一小段或调用 `computeSkuWarehouseHealth` 单仓）。

UI：卡片展示指标表；简易曲线可用 CSS/纯文本阶跃说明（「按日消耗 + eta_available 补给」），**不强制图表库**；有 `recharts` 再用折线。

- [ ] **Step 1: API + 服务单测（mock 或纯组装）**

- [ ] **Step 2: 页面 + 路由 `inventory/planning/:skuId`**

- [ ] **Step 3: 菜单 migration**

- [ ] **Step 4: 从建议页/总览链入**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add SKU inventory planning page driven by position and lead time

EOF
)"
```

---

### Task 9: P1 验收回归

- [ ] **Step 1: 跑测**

```bash
pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/lead-time-resolver.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
```

- [ ] **Step 2: 手工清单**

| 项 | 判定 |
|----|------|
| 新建 profile（商家+仓）后重跑补货，totalLeadDays/建议日变化 | |
| 建议「查看依据」含位置构成与分段提前期 | |
| `/inventory/planning/:skuId` 展示同源 effectiveQty | |
| 跟单可编辑 etd/eta_port/eta_warehouse，可售日仍主字段 | |
| 无 shipments / 断货修正 / Z 值代码混入 | |

- [ ] **Step 3: 更新设计 §13 P1 状态为「已实现」一行备注（可选 commit docs）**

---

## Spec coverage

| Spec | Task |
|------|------|
| §5 lead_time_profiles + resolver | 1–3, 5 |
| §5 管理配置 | 4 |
| §8.2 里程碑日期 | 6 |
| §10.2/10.4 建议可解释 | 7 |
| §10.3 SKU 规划页 | 8 |
| §13 P1 验收 | 9 |
| P2 shipments / 断货修正 | 不做 |

## Out of scope（本 plan 不做）

- `shipments` 表、断货修正、规划驾驶舱、Z 值、SAP 接口、position N+1 深度优化（可另开小 PR）、正式 PO/BOM。

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-29-inventory-planning-p1.md`.**

**Two execution options:**

1. **Subagent-Driven（推荐）** — 按任务开子代理 + 评审  
2. **Inline Execution** — 本会话连续执行  

选哪一种？
