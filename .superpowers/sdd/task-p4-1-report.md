# Task P4-1 Report: Sync 元数据列补齐

**Status:** Done  
**Commit:** `feat(db): add sync_status and external_version metadata columns`

## Changes

- **Schema** (6 tables): `merchants`, `skus`, `purchase_drafts`, `pmc_plans`, `shipments`, `lead_time_profiles`
- **Columns added:** `external_version varchar(50)`, `sync_status varchar(20)`, `last_sync_at timestamptz` (all nullable)
- **Migration:** `packages/db/drizzle/0062_sync_metadata.sql` + journal entry idx 55

## Notes

- `source_system` / `external_id` already present from P3; only sync metadata added.
- `sync_status` values per design: `pending` / `synced` / `error` / `ignored` (varchar, no enum).
- Schema only; no Feishu UI or SAP integration.

## Files

| File | Action |
|------|--------|
| `packages/db/src/schema/products.ts` | merchants columns |
| `packages/db/src/schema/inventory.ts` | skus columns |
| `packages/db/src/schema/procurement.ts` | purchase_drafts columns |
| `packages/db/src/schema/pmc.ts` | pmc_plans columns |
| `packages/db/src/schema/shipments.ts` | shipments columns |
| `packages/db/src/schema/lead-time.ts` | lead_time_profiles columns |
| `packages/db/drizzle/0062_sync_metadata.sql` | migration |
| `packages/db/drizzle/meta/_journal.json` | journal |
