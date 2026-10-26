# Task 3 Report: 备货规则模块（参数 + 纯函数判断）

## Status

**DONE**

## Commit

- SHA: `6d07ad4943d57896ea8dab26fa54a81491d89077`
- Subject: `feat(rules): replenishment rule module params and pure decisions`

## Files Changed (7)

| File | Action |
|------|--------|
| `apps/web/server/rules/replenishment/params.ts` | Created |
| `apps/web/server/rules/replenishment/qty.ts` | Created |
| `apps/web/server/rules/replenishment/qty.test.ts` | Created |
| `apps/web/server/rules/replenishment/evaluate.ts` | Created |
| `apps/web/server/rules/replenishment/evaluate.test.ts` | Created |
| `apps/web/server/rules/replenishment/index.ts` | Created |
| `apps/web/server/rules/registry.ts` | Created |

No changes to `replenishmentForecast.ts`, timeline, or database (per scope).

## TDD: RED / GREEN

### qty.test.ts — RED (Step 3)

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts
Exit code: 1
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../replenishment/qty.js'
ℹ fail 1
```

### qty.test.ts — GREEN (Step 5)

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts
Exit code: 0
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

### evaluate.test.ts — RED (Step 7)

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/replenishment/evaluate.test.ts
Exit code: 1
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../replenishment/evaluate.js'
ℹ fail 1
```

### Both — GREEN (Step 9)

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/replenishment/qty.test.ts server/rules/replenishment/evaluate.test.ts
Exit code: 0
ℹ tests 16
ℹ suites 4
ℹ pass 16
ℹ fail 0
```

## Self-Review

- **Imports**: Task 2 core (`param.js`, `define.js`) used as specified. `InventoryHealth` from `replenishment-coverage.js` re-exports correctly. `needsReplenishmentByHealth`, `shouldReplenishByLight` wired in `evaluate.ts`.
- **Defaults**: `REPLENISHMENT_DEFAULTS` via `defaultsOf(REPLENISHMENT_PARAMS)` — singleCoverDays 30, defaultSafetyStockDays 14, overstockThresholdDays 180, slowMovingDailyMax 0.1, slowMovingMinCoverageDays 90, moqPriority `sku_then_spu`, yellowLightLinkage true, usNetworkDeferEnabled true.
- **Registry**: `RULE_MODULES` contains `replenishmentRule`; `getRuleModule('replenishment')` resolves.
- **Pure functions**: `decideReplenishmentQty` matches timeline gap/cover/MOQ semantics from brief tests. `decideWarehouseCandidate` trace items align with skip/include paths tested.
- **Gap**: `isUsDeferEnabled` exported but untested (brief did not require tests); trivial passthrough.

## Concerns

- None blocking. Future tasks should wire these modules into forecast/timeline without duplicating logic in `replenishmentForecast.ts` until explicitly migrated.
- `git add` scoped to `replenishment/` + `registry.ts` only (not `git add -A`) to avoid unrelated untracked files in repo root.
