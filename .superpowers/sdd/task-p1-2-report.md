# Task P1-2 Report: `lead_time_profiles` schema

**Status:** Done  
**Branch:** feat/inventory-planning-p1  
**Commit:** `feat(db): add lead_time_profiles for route lead-time config`

## Deliverables
- `packages/db/src/schema/lead-time.ts` — `transportModeEnum` + `leadTimeProfiles` table
- `packages/db/drizzle/0053_lead_time_profiles.sql` — enum, table, index
- `packages/db/drizzle/meta/_journal.json` — idx 48
- `packages/db/src/schema/index.ts` — export added

## Notes
- Schema-only; no Feishu UI/mapper changes.
- `transport_mode` / `origin_location` nullable per spec §5.3.
- Index `(merchant_code, destination_warehouse_code)`; `is_default` uniqueness deferred to app layer.
- Next migration slot: **0054** (Task 6 milestones).
