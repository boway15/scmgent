# Task P4-4 Report: SAP mirror ingest service

**Status:** Done

## Commit

`feat(sap-mirror): add idempotent PO mirror ingest service`

## Deliverables

- **`ingest.ts`:** `ingestSapMirrorBatch({ entityType, items, userId })` — creates `sap_sync_runs`, upserts merchants/skus by `(source_system, external_id)`, upserts `sap_po_mirrors` + lines with optional SKU/merchant resolution
- **Idempotency:** merchant/sku skip when row unchanged; PO skip when `external_version` matches; PO version bump → update
- **Accounting:** inserted / updated / skipped / errors → run status `succeeded|partial|failed`
- **`createDbSapMirrorStore`:** production Drizzle adapter; **`createMemorySapMirrorStore`:** test double

## Tests

```bash
pnpm --filter @scm/web exec tsx --test server/lib/sap-mirror/*.test.ts
# 23 pass, 0 fail
```

## Constraints

- No SAP network; no `resolveInventoryPosition` / planning qty hooks
- Feishu list mappers untouched
- PO mirrors only in `sap_po_mirrors` tables

## Files (2)

`apps/web/server/lib/sap-mirror/{ingest,ingest.test}.ts`
