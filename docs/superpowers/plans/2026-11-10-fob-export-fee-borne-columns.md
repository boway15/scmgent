# FOB 导出费用「总/承担」双列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分摊总账与按工厂/主体导出宽表中，每个费用项改为「{费用}-总」「{费用}-承担」成对列。

**Architecture:** 仅改 `buildMerchantBillWideExportAoa`：费用区表头与单元格成对输出；`-总` 来自账单 pivot，`-承担` 预聚合自 allocations。总账复用该函数无需另改。

**Tech Stack:** TypeScript、Node test runner (`npx tsx --test`)

## Global Constraints

- 仅 FOB 导出模块；不改导入/核算/UI。
- 列名：`{feeType}-总` / `{feeType}-承担`；行尾 7 列保留。
- 费用清单仍用 `TRUCKING_FEE_HEADERS` / `FREIGHT_FEE_HEADERS`。
- 本会话不自动 git commit（除非用户另行要求）。

---

### Task 1: 宽表双列（TDD）

**Files:**
- Modify: `apps/web/server/lib/fob-reconcile-export.test.ts`
- Modify: `apps/web/server/lib/fob-reconcile-export.ts`（`buildMerchantBillWideExportAoa`）
- Modify: `.cursor/rules/fob-settlement-dev.mdc`（导出说明一句）

**Interfaces:**
- Consumes: `allocations[].allocatedAmountCny`、`bill.fees`、`*_FEE_HEADERS`
- Produces: 表头含成对费用列；数据行对应总/承担金额

- [x] **Step 1: 写失败断言**（表头含 `拖车费-总`/`拖车费-承担`；A: 1000/600；B: 1000/400）
- [x] **Step 2: 跑测确认失败** — `npx tsx --test server/lib/fob-reconcile-export.test.ts`
- [x] **Step 3: 实现双列 + 承担预聚合**
- [x] **Step 4: 跑测确认通过**
- [x] **Step 5: 同步 fob-settlement-dev.mdc 导出说明**
