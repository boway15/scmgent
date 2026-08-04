# Task 2 Report: 库存位置纯函数（桶映射 + fill_gap）

## Status

**COMPLETE** — 纯函数模块已创建，5/5 单测通过，已提交。

## Branch & Commit

- Branch: `feat/inventory-planning-boundary-p0`
- Commit: `fd22298` — `feat: add inventory position merge helpers for P0`

## Files Created

| File | Purpose |
|------|---------|
| `apps/web/server/lib/inventory-position.ts` | 类型定义 + `mapDraftStatusToBucket` / `openDraftQty` / `mergeInventoryPosition` |
| `apps/web/server/lib/inventory-position.test.ts` | 5 个纯函数单测 |

## TDD Evidence

### RED (Step 2)

Command:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
```

Result: **FAIL** — `ERR_MODULE_NOT_FOUND: Cannot find module '.../inventory-position.js'`

```
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

### GREEN (Step 4)

Same command after implementing `inventory-position.ts`:

Result: **PASS**

```
▶ inventory-position pure
  ✔ maps draft statuses to buckets
  ✔ computes open qty
  ✔ drafts_fill_gap only fills zero snapshot buckets
  ✔ snapshot_only ignores drafts
  ✔ sum_both adds drafts on top of snapshot
✔ inventory-position pure

ℹ tests 5
ℹ pass 5
ℹ fail 0
```

## Implementation Summary

- **`mapDraftStatusToBucket`**: 跟单状态 → 桶映射（`draft`/`confirmed`/`exception` → `confirmedOpen`；`in_production`/`ready_to_ship` → `inProduction`；`in_transit`/`partial_received` → `inTransit`；`received`/`cancelled` → `null`）
- **`openDraftQty`**: `max(0, qty - receivedQty)`
- **`mergeInventoryPosition`**: 三种去重模式
  - `drafts_fill_gap`（默认）：快照权威，跟单仅补 snapshot 为 0 的 `inProduction`/`inTransit` 桶；`confirmedOpen` 始终来自跟单
  - `snapshot_only`：忽略跟单桶
  - `sum_both`：快照 + 跟单叠加
- **`effectiveQty`**: `available + inProduction + inTransit + confirmedOpen - reserved - backorder`

## Test Coverage

| Test | Assertion focus |
|------|-----------------|
| maps draft statuses to buckets | 9 状态映射 |
| computes open qty | 开放量计算（含超收归零） |
| drafts_fill_gap | 快照非零桶保留、零桶补齐、effectiveQty |
| snapshot_only | 跟单被忽略 |
| sum_both | 快照与跟单叠加 |

## Concerns / Notes for Task 3+

- 本任务仅纯函数；`resolveInventoryPosition`（DB 聚合）留给 Task 3
- `qtyBackorder` 固定为 0；`sources` / `unassignedOpenQty` 透传但未在本任务单测中覆盖
- `confirmedOpen` 在 `drafts_fill_gap` 模式下不与快照去重（设计如此：快照无此桶）

## Out of Scope (not committed)

Working tree 其余脏文件未纳入本次 commit。
