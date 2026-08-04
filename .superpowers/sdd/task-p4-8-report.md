# P4 Task 8 — Acceptance report

**Branch:** `feat/inventory-planning-p4`  
**HEAD:** `e97009e`  
**Date:** 2026-07-29

## Tests

| Command | Result |
|---------|--------|
| `pnpm --filter @scm/web exec tsx --test server/lib/sap-mirror/*.test.ts` | **28 pass / 0 fail** |
| `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts` | **9 pass / 0 fail** |

## Checklist

| 项 | 判定 |
|----|------|
| Fixture 商家/SKU 幂等 | PASS（ingest tests: insert then skip identical） |
| PO 不进 position | PASS（create-draft test: no warehouse → unassigned only；mirrors never hooked into `resolveInventoryPosition`） |
| 无真实 SAP 调用 | PASS（fixture transport only；no sap-sdk / OData / network matches under `sap-mirror/`） |
| 飞书四列表未改 | PASS（`git diff 6d5fe8d^..HEAD` on frozen paths empty） |

## P4 commits (Task 1–7)

1. `6d5fe8d` sync metadata columns (0062)
2. `35835e7` sap sync runs + PO mirror tables (0063)
3. `7aa7c08` mapping helpers + fixture transport
4. `7b91dd5` idempotent ingest
5. `7144fa1` `/api/sap-mirror/*` routes
6. `0def0a6` admin page `/data/sap-mirror` + menu (0064)
7. `e97009e` optional PO → purchase_draft

## Out of scope (confirmed)

- Real SAP Transport / SDK
- Inventory mirror (P4.1+)
- Feeding PO mirrors into planning position
