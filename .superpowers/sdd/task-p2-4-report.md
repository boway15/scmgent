# P2 Task 4 Report

- Added `calcMilestoneDelayDays` with calendar-day delay handling and 5 passing tests.
- Added guarded `/api/shipments` list/create/update endpoints.
- Added milestone upsert and aggregated `/api/shipments/delays`.
- `?delayed=1` filters milestone delays and overdue `eta_available`.
- Mounted shipment routes with `requireMenu('pmc.shipments')`.
- Feishu list pages were not changed.

Verification:
- `pnpm --filter @scm/web exec tsx --test server/lib/shipment-delay.test.ts` — 5/5 passed.
- Server typecheck still reports unrelated pre-existing errors; no errors reference shipment files.
- Cursor lint diagnostics — clean for all changed source files.
