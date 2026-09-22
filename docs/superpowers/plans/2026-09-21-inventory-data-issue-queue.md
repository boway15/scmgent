# 库存数据异常队列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把无期批次、未分仓、占比偏离扫成独立数据工单，供 PMC 处理，不混入健康异常单。

**Architecture:** 纯函数检测三类问题；新表 `inventory_data_issues` upsert；Hono 列表/处理 API；库存菜单页；每日流水线在三池同步后扫描。

**Tech Stack:** TypeScript、Node `tsx --test`、Drizzle/Postgres、Hono、React

**Spec:** `docs/superpowers/specs/2026-09-21-inventory-data-issue-queue-design.md`

## Global Constraints

- 不写入 `inventory_exceptions`，不改时间轴 / 健康灯 / 补货公式。
- 本期仅三类：`missing_available_at` / `unallocated_warehouse` / `share_sum_mismatch`。
- 不做完整度分数盘。
- 中文 UI；标识符英文。
- 测试：`pnpm --filter @scm/web exec tsx --test <files>`
- 用户未要求则不 git commit。

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/inventory-data-issues.ts` | 检测纯函数与文案 |
| `apps/web/server/lib/inventory-data-issues.test.ts` | 三类规则 |
| `packages/db/src/schema/inventory-data-issues.ts` | 表与枚举 |
| `packages/db/drizzle/0095_inventory_data_issues.sql` | 迁移 + 菜单 |
| `apps/web/server/lib/inventory-data-issue-store.ts` | upsert / 自动结案 |
| `apps/web/server/tasks/inventoryDataIssueScan.ts` | 读 lots + OVERSEAS + 占比后扫描 |
| `apps/web/server/routes/inventory-data-issues.ts` | GET/PATCH |
| `apps/web/src/pages/InventoryDataIssuesPage.tsx` | 列表工作台 |
| 流水线 / 任务 / 路由 / api / 驾驶舱 | 接入 |

---

### Task 1: 检测纯函数

**Files:**
- Create: `apps/web/server/lib/inventory-data-issues.ts`
- Create: `apps/web/server/lib/inventory-data-issues.test.ts`

**Interfaces:**
- Consumes: `ShareParseResult` from `inventory-share-allocation.ts`
- Produces: `detectInventoryDataIssues`, `DATA_ISSUE_TYPES`, `DataIssueCandidate`

- [ ] **Step 1–4:** TDD 三类检出 + 跳过已关闭批次 + 指纹稳定
- [ ] **Step 5:** 测试通过（本会话不单独 commit）

---

### Task 2: Schema / 扫描 / API / 页

按 spec 落地表、upsert、任务、页面、流水线 digest、驾驶舱入口、三池页链到队列。
