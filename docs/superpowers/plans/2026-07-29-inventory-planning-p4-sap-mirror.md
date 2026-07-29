# 库存规划 P4（SAP 镜像适配层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 SAP 镜像适配层：Fixture Transport、商家/SKU 幂等同步、PO 只读镜像表、sync_runs 与管理页；不接真实 SAP、不改飞书列表。

**Architecture:** `SapMirrorTransport` 端口 + JSON fixture 实现；ingest 服务按 entity upsert 本地主数据或 `sap_po_mirrors`；补齐 `sync_status`/`last_sync_at`/`external_version`；管理 API + `/data/sap-mirror` 页。

**Tech Stack:** PostgreSQL、Drizzle、Hono、React、tsx test

**Spec:** `docs/superpowers/specs/2026-07-29-sap-mirror-adapter-design.md`  
**前置:** `feat/inventory-planning-p3`

## Global Constraints

- **禁止真实 SAP 网络/SDK 调用**；仅 Fixture/JSON ingest。
- **飞书四列表结构冻结**（bulk-stock / follow-up / overview / query + mappers）。
- PO 镜像**不**计入 `resolveInventoryPosition`。
- 规划逻辑仍在本系统；镜像可关联 `external_id`，不替换 `purchase_drafts` 状态机。
- 迁移从 `0062` 起（P3 用到 0061）。

---

### Task 1: Sync 元数据列补齐

**Files:** schema merchants/skus/purchase_drafts/pmc_plans/shipments/lead_time_profiles + `0062_sync_metadata.sql`

对缺列补：`external_version varchar(50)`, `sync_status varchar(20)`, `last_sync_at timestamptz`。

- [ ] Schema + SQL + journal  
- [ ] Commit: `feat(db): add sync_status and external_version metadata columns`

---

### Task 2: sap_sync_runs + sap_po_mirrors schema

**Files:** `packages/db/src/schema/sap-mirror.ts`, `0063_sap_mirror.sql`, export index

Tables per design §3.

- [ ] Schema + migration  
- [ ] Commit: `feat(db): add sap sync runs and PO mirror tables`

---

### Task 3: Transport + mapping 纯函数

**Files:**
- `apps/web/server/lib/sap-mirror/types.ts`
- `apps/web/server/lib/sap-mirror/map-merchant.ts` + test
- `apps/web/server/lib/sap-mirror/map-sku.ts` + test
- `apps/web/server/lib/sap-mirror/map-po.ts` + test
- `apps/web/server/lib/sap-mirror/fixture-transport.ts`

```ts
export function mapSapVendorToMerchant(item: {
  vendorId: string;
  name: string;
  code?: string;
}): { sourceSystem: 'sap'; externalId: string; code: string; name: string };

export function mapSapMaterialToSku(item: {
  materialId: string;
  name: string;
  unit?: string;
}): { sourceSystem: 'sap'; externalId: string; code: string; name: string; unit: string };
```

- [ ] TDD maps  
- [ ] Commit: `feat: add SAP mirror mapping helpers and fixture transport`

---

### Task 4: Ingest 服务

**Files:** `apps/web/server/lib/sap-mirror/ingest.ts` + test（可用注入 db mock 或测纯编排）

`ingestSapMirrorBatch({ entityType, items, userId })` → 写 run + upsert。

Merchant/SKU：按 `(source_system, external_id)` 查，无则 insert，有则 update name/code + sync 字段。  
PO：upsert mirror head/lines；解析 merchant/sku id 可选。

- [ ] Implement + tests for upsert accounting  
- [ ] Commit: `feat: ingest SAP mirror batches into local tables`

---

### Task 5: API routes

**Files:** `apps/web/server/routes/sap-mirror.ts`, mount index

- `POST /api/sap-mirror/ingest` `{ entityType, items }` requireMenu `data.sap_mirror`
- `GET /api/sap-mirror/runs`
- `GET /api/sap-mirror/purchase-orders`

- [ ] Routes  
- [ ] Commit: `feat: add SAP mirror ingest and query APIs`

---

### Task 6: 管理页 + 菜单

**Files:** `SapMirrorPage.tsx`, router, api.ts, seed, `0064_sap_mirror_menu.sql`

UI：选择实体类型、粘贴 JSON 数组、提交、展示 run summary；PO 镜像只读表。

- [ ] Page + menu  
- [ ] Commit: `feat: add SAP mirror admin page`

---

### Task 7:（可选最小）PO 镜像关联跟单

`POST /api/sap-mirror/purchase-orders/:id/create-draft`：若行能解析 skuId，创建 `purchase_drafts` source=manual/sap，写入 external_id，**不**改飞书页。

若时间紧可跳过并在报告注明 deferred。

---

### Task 8: 验收

```bash
pnpm --filter @scm/web exec tsx --test server/lib/sap-mirror/*.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
```

| 项 | 判定 |
|----|------|
| Fixture 商家/SKU 幂等 | |
| PO 不进 position | |
| 无真实 SAP 调用 | |
| 飞书四列表未改 | |

---

## Out of scope

真实 SAP、库存镜像、回写、飞书列表改列、替换 PMC 状态机。
