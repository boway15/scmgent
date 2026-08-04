# Inventory Daily Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将每日飞书库存周转同步归档为可按日期查询的完整 SKU 快照，同一业务日期只发布最后一次成功完整批次，并在库存总览与 SKU 抽屉提供历史查询。

**Architecture:** 新增同步批次表和 SKU 每日快照表。飞书导入成功且无行错误后，读取导入后的完整库存总览行，以 Asia/Shanghai 业务日期写入暂存批次；事务内发布新批次并替换同日旧批次。当前态继续使用现有 `skus` / `inventory_records`，历史日期统一读取每日快照 JSONB。

**Tech Stack:** PostgreSQL、Drizzle ORM、Hono、React、TanStack Query、Node test/tsx。

## Global Constraints

- 飞书多维表格是库存周转权威数据源。
- `snapshot_date` 使用 Asia/Shanghai 业务日期，`synced_at` 保存真实同步时刻。
- 同日最后一次“成功且完整”的批次生效；失败或含行错误的同步不得替换已发布快照。
- 今日无成功快照时，库存总览回退最近成功日期并明确返回 stale 状态。
- 历史视图必须使用归档时完整字段，不与当前 SKU 主数据拼接造成历史污染。
- 不为 JSONB 66 个字段逐一建索引；仅建立日期与 SKU 查询索引。

---

### Task 1: 快照日期与发布模型

**Files:**
- Create: `apps/web/server/lib/inventory-daily-snapshot.test.ts`
- Create: `apps/web/server/lib/inventory-daily-snapshot.ts`
- Modify: `packages/db/src/schema/inventory.ts`
- Generate: `packages/db/drizzle/0047_inventory_daily_snapshots.sql`

**Interfaces:**
- Produces: `getShanghaiBusinessDate(now?: Date): string`
- Produces: `publishInventoryDailySnapshot(input): Promise<{ runId; snapshotDate; rowCount }>`
- Produces: `listInventorySnapshotDates(): Promise<InventorySnapshotDateOption[]>`

- [ ] **Step 1: Write failing tests**
  - 验证 UTC 临界时间转换为上海业务日期。
  - 验证快照行去重规则：同一 SKU 仅保留输入中的最后一条。
  - 验证只有无错误、非空数据可进入发布。

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-daily-snapshot.test.ts`

Expected: FAIL because snapshot module does not exist.

- [ ] **Step 3: Implement schema and publication**
  - `inventory_snapshot_runs`: `id`, `snapshot_date`, `synced_at`, `source`, `status`, `row_count`, `import_batch_id`, timestamps。
  - `inventory_daily_snapshots`: `run_id`, `snapshot_date`, `sku_id`, `sku_code`, `payload`, timestamps。
  - 唯一索引 `(snapshot_date, sku_id)`，趋势索引 `(sku_id, snapshot_date)`。
  - 发布事务先锁定业务日期，删除同日旧明细/run，再插入最后成功批次。

- [ ] **Step 4: Run tests and verify GREEN**

### Task 2: 飞书同步后发布每日快照

**Files:**
- Modify: `apps/web/server/lib/bitable-sync.ts`
- Modify: `apps/web/server/lib/inventory-turnover-pull-task.ts`
- Test: `apps/web/server/lib/inventory-daily-snapshot.test.ts`

**Interfaces:**
- Consumes: `publishInventoryDailySnapshot`
- Produces: 同步响应中的 `snapshotDate`, `snapshotRowCount`, `snapshotRunId`

- [ ] **Step 1: Add failing publication-eligibility tests**
  - 行错误、空导入、非 `inventory_turnover` 不发布。
  - 成功完整导入发布完整 overview item。

- [ ] **Step 2: Run tests and verify RED**
- [ ] **Step 3: Call publication only after successful import finalization**
- [ ] **Step 4: Run tests and verify GREEN**

### Task 3: 历史日期总览与详情 API

**Files:**
- Modify: `apps/web/server/lib/inventory-overview-service.ts`
- Modify: `apps/web/server/routes/inventory.ts`
- Create: `apps/web/server/lib/inventory-overview-history.test.ts`

**Interfaces:**
- Extends: `InventoryOverviewQuery.snapshotDate?: string`
- Produces: `GET /api/inventory/overview/dates`
- Extends: list/detail/export endpoints with `snapshotDate`
- Produces response metadata: `selectedSnapshotDate`, `latestSnapshotDate`, `isLatestSnapshot`, `isStale`

- [ ] **Step 1: Write failing query/date-resolution tests**
- [ ] **Step 2: Run tests and verify RED**
- [ ] **Step 3: Implement latest/today fallback and JSONB snapshot queries**
- [ ] **Step 4: Run tests and verify GREEN**

### Task 4: 日期切换与 SKU 趋势 API

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/InventoryOverviewPage.tsx`
- Modify: `apps/web/src/components/InventoryOverviewRowDrawer.tsx`
- Modify: `apps/web/server/routes/inventory.ts`
- Modify: `apps/web/server/lib/inventory-daily-snapshot.ts`

**Interfaces:**
- Produces: `api.getInventorySnapshotDates()`
- Produces: `api.getInventoryOverviewTrend(skuId, fields?)`
- Adds: 总览日期选择器和非今日数据提示
- Adds: 抽屉库存趋势日期列表/指标对比

- [ ] **Step 1: Write failing pure tests for date selection and trend projection**
- [ ] **Step 2: Run tests and verify RED**
- [ ] **Step 3: Implement API clients and UI**
- [ ] **Step 4: Run tests, type/build and verify GREEN**

### Task 5: 文档与完整验证

**Files:**
- Modify: `docs/feishu-bitable-sync.md`

- [ ] **Step 1: Document retention, same-day replacement, fallback and migration**
- [ ] **Step 2: Run targeted tests**

Run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-daily-snapshot.test.ts server/lib/inventory-overview-history.test.ts`

- [ ] **Step 3: Run full build**

Run: `pnpm build`

- [ ] **Step 4: Review migration SQL and final diff**
