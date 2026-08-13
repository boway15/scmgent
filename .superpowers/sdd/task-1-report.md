# Task 1 Report: T99 折扣 0.6→0.8（TDD）

## Status

**DONE**

## What Was Implemented

- Raised `T99_SYSTEM_FLOOR_DISCOUNT` from `0.6` to `0.8` in `forecast-demand.ts`.
- Updated `resolveT99ReplenishmentFallbackDaily` default discount to reference `T99_SYSTEM_FLOOR_DISCOUNT` (avoids drift).
- Synced allcat V4.1 T99 formula string and `buildT99ReviewMessage` copy from `×0.6` to `×0.8`.
- Kept `recent_max06` enum mode name unchanged.
- Did **not** change T4B constants, ghost gates, or T99 zero-gate (`recent30≤0→0`).

## TDD Evidence

### RED (Step 2)

Command:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
```

Result: **FAIL** (2 failing tests)

- `resolveT99SystemFloorDaily uses max(r30,r90)*0.8 near and *0.72 far` — `2.4 !== 3.2`
- `T99 zero forecast falls back to recent sales for replenishment` — `1.2 !== 1.6`

Zero-gate test remained passing (unchanged).

### GREEN (Step 5)

Commands:

```bash
pnpm --filter @scm/web exec tsx --test server/lib/forecast-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/forecast-allcat-v41.test.ts
```

Results:

- `forecast-demand.test.ts`: **14/14 PASS**
- `forecast-allcat-v41.test.ts`: **46/46 PASS** (T99 bounded/floor assertions updated; no T4B assertion changes in this task)

## Files Changed

| File | Change |
|------|--------|
| `apps/web/server/lib/forecast-demand.ts` | `T99_SYSTEM_FLOOR_DISCOUNT = 0.8`; fallback default uses constant |
| `apps/web/server/lib/forecast-demand.test.ts` | T99 floor/fallback expectations → 0.8口径 |
| `apps/web/server/lib/forecast-allcat-v41.ts` | `tierFormula` T99 + `buildT99ReviewMessage` ×0.8 |
| `apps/web/server/lib/forecast-allcat-v41.test.ts` | T99 bounded daily + horizonFactors assertions |

## Commit

```
8f77778 feat(forecast): raise T99 floor discount 0.6→0.8
```

4 files changed, 16 insertions(+), 16 deletions(-) — Task 1 scope only (isolated from unrelated allcat WIP on branch).

## Self-Review

- TDD order followed: tests updated first, RED verified, then minimal implementation.
- Fallback default references `T99_SYSTEM_FLOOR_DISCOUNT` per brief preference.
- Zero-gate behavior preserved (`recent30=0` → daily 0, mode `zero_gate_recent30`).
- Far-month decay unchanged (`flexDecayFromK=3`, `flexDecayFactor=0.72`).
- Also updated `computeAllCatV41BoundedDaily applies T99 system floor with far-month decay` test (near 3.2, far 2.304) — required for GREEN; brief listed the `computeAllCatV41ForecastForMonth` case explicitly but bounded test is same T99 path.

## Concerns

- **Mode name `recent_max06`**: Still references 0.6 historically; left unchanged per brief. UI/docs may show 0.8 formula while mode key says `_06` — cosmetic inconsistency only.
- **Frontend formula display**: `forecast-v41-system-formula.ts` / UI help text may still mention 0.6 if not updated in later tasks — out of Task 1 scope but worth checking in Task 5 or UI pass.
- **Branch WIP**: Other unstaged allcat/forecast changes on branch were excluded from this commit intentionally.
