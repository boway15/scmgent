# Task 6 Report: 参数存储服务与补货任务接入

## Status

**DONE**

## Commit

- SHA: `86d46ccacbaac88756348c0f32347eefd31d6a9a`
- Subject: `feat(replenishment): resolve rule params per scope and record rule runs`
- Branch: `feat/rule-modules-p0`
- Staged only the 3 files named in the brief (not `git add -A`). Report file is not in the commit.

## Files Changed (3)

| File | Action |
|------|--------|
| `apps/web/server/rules/core/store.ts` | Created: `loadActiveParamSets`, `createParamsResolver`, `startRuleRun`, `finishRuleRun` |
| `apps/web/server/rules/core/store.test.ts` | Created: memoize + warehouse override over global |
| `apps/web/server/tasks/replenishmentForecast.ts` | Resolve params per SKU/warehouse, rule decisions, `rule_eval_runs`, `ruleRunId` / `ruleTrace` |

## Wiring

- `activeSkus` select includes `projectGroup`.
- `ReplenishmentRunOptions` adds `paramSets?` and `trigger?`. `paramSets` overrides DB active sets.
- SKU scope (`skuParams`): MOQ priority, yellow linkage, network `defaultSafetyStockDays` / `singleCoverDays`.
- Warehouse scope (`whParams`): `coverDays`, slow-moving, overstock fallback, US defer, `ruleDefaults`.
- Gray coverage light writes `ruleTrace` and `continue`s **before** the warehouse timeline.
- After timeline qty is computed, `decideWarehouseCandidate` applies MOQ via `candidate.qty`. `applyMoq` is not called again.
- Non-dry-run starts `rule_eval_runs` before the dry-run return, writes `metrics.ruleRunId`, then `finishRuleRun`.
- `decisionHealth` is annotated `InventoryHealth` so a later gray decision light still typechecks after the early gray `continue` narrows the initial value. No runtime change.

## TDD: RED / GREEN

### RED（实现 `store.ts` 之前）

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts
Exit code: 1
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../server/rules/core/store.js'
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

### GREEN（Step 4 / Step 6）

```text
Command: pnpm --filter @scm/web exec tsx --test server/rules/core/store.test.ts server/rules/replenishment/evaluate.test.ts server/lib/network-replenishment.test.ts
Exit code: 0
ℹ tests 20
ℹ suites 7
ℹ pass 20
ℹ fail 0
```

`createParamsResolver` memoizes the UK scope (`singleCoverDays` 60) and resolves US-WEST to the global 40.

## Typecheck

```text
Command: pnpm --filter @scm/web exec tsc --noEmit -p tsconfig.json
Exit code: 2
```

Same class as Task 4: TS6305 across `server/` (including untouched files), plus TS6306 and TS6310 on `tsconfig.node.json` (`composite` / `noEmit`). No TS2xxx semantic errors in that log. `store.ts` and `replenishmentForecast.ts` only appear as TS6305 “.d.ts has not been built”.

This log was captured before the `InventoryHealth` annotation. That annotation is type-only and does not add a new error class.

## Baseline（无 active 参数集）

```text
Command: pnpm --filter @scm/web exec tsx scripts/replenishment-baseline.ts compare ../../.tmp-rules-baseline.json
Exit code: 0
与基线一致（用时 131s）
```

`SELECT count(*) FROM rule_param_sets` was 0 before this compare.

## Smoke（global `singleCoverDays=60`）

Insert:

```sql
INSERT INTO rule_param_sets (module_code, scope_type, scope_value, params, version, status)
VALUES ('replenishment', 'global', '*', '{"singleCoverDays": 60}', 1, 'active');
```

`INSERT 0 1`. Same compare command:

```text
Exit code: 1
共 1498 处差异
```

The script prints at most 200 diff lines. All 200 are `suggestions` `suggestedQty` increases (200 up, 0 down), for example `100100901::NETWORK suggestedQty: 31 → 59`, `100101001::NETWORK 28 → 54`. The other 1298 lines were not printed.

Cleanup:

```sql
DELETE FROM rule_param_sets WHERE module_code = 'replenishment' AND version = 1 AND scope_type = 'global';
```

`DELETE 1`. Follow-up `GROUP BY status` returned 0 rows. No leftover param sets.

## Concerns

- Smoke stdout is capped at 200 of 1498 diffs, so later lines (likely health `suggestedQty`, possibly other health fields) were not inspected one by one. The visible set is only suggested quantity increases.
- Project `tsc -p tsconfig.json` still exits 2 for the pre-existing TS6305/6306/6310 project-reference issue.
