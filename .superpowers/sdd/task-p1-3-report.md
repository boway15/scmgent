# Task P1-3 Report: lead-time profile resolver

**Status:** Done  
**Branch:** feat/inventory-planning-p1  
**Commit:** `feat: resolve lead time from lead_time_profiles with legacy fallback`

## Deliverables
- Added pure `pickLeadTimeProfile` with the four-level merchant/warehouse/mode priority.
- `resolveLeadTimeForSkuWarehouse` now accepts optional `transportMode` and resolves active default profiles into the six-segment breakdown.
- Legacy merchant/SKU supplier/warehouse/constants resolution remains the fallback and returns `profileId: null`.
- Added `lead-time-resolver.test.ts` covering profile priority and no-match fallback.
- No Feishu-synced list page or mapper was changed.

## Verification
- Resolver + replenishment lead-time tests: 17 passed.
- Targeted strict TypeScript check: passed.
- Full server typecheck remains blocked by pre-existing errors outside Task P1-3; no error references the changed resolver files.
