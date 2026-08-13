# 销量导入加速 + 月表残月保护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日表残月不再覆盖月表；销量宽表导入从小时级降到大约十几分钟。

**Architecture:** 抽出 `shouldAggregateCalendarMonth`；月表改为一条 `INSERT…SELECT…ON CONFLICT`；SKU 先批量 `IN` 命中再逐条创建缺失码；宽表分片 25→200。

**Tech Stack:** Drizzle / postgres-js、现有 `sales-history-monthly` / `sales-xiaoshou` / `ensure-sku-from-import`、Node `tsx --test`

## Global Constraints

- 日表唯一键与 `ON CONFLICT DO NOTHING` 不变（已存在行不覆盖）
- 月表维度仍是 `(sku_id, channel, sale_year, month)`
- 残月：`YYYY-MM-01 < MIN(sale_date)`（当前聚合过滤范围内）则跳过
- 不引入 COPY；不改日表 365 天保留
- 用户文案不承诺固定分钟数（机器负载会变）

**Spec:** `docs/superpowers/specs/2026-08-13-sales-import-speed-monthly-guard-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `apps/web/server/lib/sales-history-monthly.ts` | 残月判定 + 批量 SQL 聚合 |
| `apps/web/server/lib/sales-history-monthly.test.ts` | `shouldAggregateCalendarMonth` |
| `apps/web/server/lib/ensure-sku-from-import.ts` | `chunkList` + 批量查找已存在 SKU |
| `apps/web/server/lib/ensure-sku-from-import.test.ts` | `chunkList` |
| `apps/web/server/lib/import/sales-xiaoshou.ts` | `SALES_WIDE_IMPORT_CHUNK_SIZE = 200` |
| `apps/web/server/lib/import/sales-xiaoshou.test.ts` | 分片常量 |
| `apps/web/server/lib/sales-history-import.ts` | 日表 insert chunk 2000 |
| `apps/web/server/routes/import.ts` | 去掉「数小时」文案 |

---

### Task 1: 残月纯函数

- [x] 在 `sales-history-monthly.test.ts` 增加 `shouldAggregateCalendarMonth` 用例
- [x] 导出并实现该函数
- [x] `cd apps/web && pnpm exec tsx --test server/lib/sales-history-monthly.test.ts`

### Task 2: 批量月聚合 SQL

- [x] `aggregateSalesHistoryMonthlyFromDaily` 改为 `INSERT…SELECT…ON CONFLICT`，过滤 `make_date(y,m,1) >= dailyMin`
- [x] `skuIds` 超过 2000 时分批
- [x] 现有 monthly helper 单测仍通过

### Task 3: SKU 批量查找 + 分片加大

- [x] 测试并导出 `chunkList`
- [x] `ensureSkusFromDailySales`：已存在码批量 `inArray`，仅缺失走 `ensureSkuFromImport`
- [x] `SALES_WIDE_IMPORT_CHUNK_SIZE = 200`；日表 insert chunk 2000
- [x] `cd apps/web && pnpm exec tsx --test server/lib/ensure-sku-from-import.test.ts server/lib/import/sales-xiaoshou.test.ts server/lib/sales-history-import.test.ts server/lib/sales-history-monthly.test.ts`

### Task 4: 导入提示文案

- [x] `import.ts` 两处「全量约需数小时」改为「大文件在后台执行，请勿重启」
