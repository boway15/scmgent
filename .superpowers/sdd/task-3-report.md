# Task 3 Report

- Status: implemented `DraftOpenLine`, warehouse draft aggregation, and real Drizzle-backed `resolveInventoryPosition`.
- Behavior: legacy `submitted` normalizes to `confirmed`; exceptions are marked `atRisk`; draft warehouse falls back from plan item to plan target; unassigned open quantity is tracked separately.
- Boundary: `IN-PRODUCTION` reads only its snapshot and skips drafts; physical warehouses never receive the SKU-level production snapshot.
- Tests: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts` — 6 passed, 0 failed.
- Lints: no diagnostics in the two modified inventory-position files.
- Type check: repository server type check still fails on unrelated pre-existing errors; no `inventory-position` errors remain.
- Important review fix: physical warehouse snapshots now force `qtyInProduction` to `0` before merge; only `IN-PRODUCTION` retains the snapshot production quantity.
- Focused regression test: a physical warehouse loader snapshot containing `qtyInProduction: 75` normalizes to `0`.
- Re-run: `pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts` — 7 passed, 0 failed.
