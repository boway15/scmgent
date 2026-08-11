# Task 2 Report: V4.1 bounded T99 output + horizon factors

## Status

**DONE_WITH_CONCERNS** — Task 2 implementation, TDD cycle, scoped commit, and self-review are complete. The required tests pass; repository-wide server type-check remains red from pre-existing diagnostics.

## Commit

- `46912b3` — `feat(forecast): apply T99 system floor in V4.1 bounded daily`
- Commit scope: only `forecast-allcat-v41.ts` and its test; Task 3 persistence and Task 4 frontend copy were not changed.

## Implementation

- Imported Task 1's `resolveT99SystemFloorDaily` and `T99FloorMode`.
- T99 bounded output now applies the recent30 zero gate, `max(recent30,recent90) × 0.6`, and far-horizon decay.
- Added `t99FloorDaily` / `t99FloorMode` to bounded results and persisted audit values into `horizonFactors`.
- Updated the T99 tier label, KPI target, and review message to conservative-floor semantics.
- Preserved zero output when recent30 is absent or zero.

## TDD and verification

- RED: required test command failed in exactly 2 new tests because T99 still returned `0`.
- GREEN: `pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts` — PASS, 43 tests, 0 failures.
- IDE lint: no errors in either changed file.
- `git diff --check`: PASS.
- `pnpm --filter @scm/web exec tsc -p tsconfig.node.json --noEmit`: FAIL with 219 existing diagnostics; the sole hit in this test file is an older fixture missing `trendRatio`, not a new Task 2 line.

## Self-review

- Verified near/far/gated values are `2.4`, `1.728`, and `0`, respectively.
- Verified forecast output and audit factors reuse the same bounded floor result without duplicate calculation.
- Verified T99 remains excluded from peer-platform lift and existing no-recent-sales behavior remains zero.
- Verified no changes to `forecast-collaboration.ts` or frontend files.

## Review fix (Task 2 follow-up)

**Issue 1 — T99 algorithm/formula still `no_forecast`:** Updated `tierAlgorithm` / `tierFormula` so T99 emits `t99_conservative_floor` and `max(recent30,recent90)*0.6 with far decay`, aligned with `kpiTarget: T99_CONSERVATIVE_FLOOR`.

**Issue 2 — `buildT99ReviewMessage` invented zero when floor params omitted:** When `floorMode` / `floorDaily` are both omitted, message now uses neutral copy `系统保守保底（有近30动销时出数，断销归零）`; zero gate and explicit positive floor paths unchanged.

**Verification:** `pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts` — PASS, 45 tests, 0 failures (+2 new review-message / metadata assertions).
