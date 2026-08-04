# Task P4-5 Report: SAP mirror API routes

**Status:** Done | **Commit:** `7144fa1`

## Commit

`feat(api): add sap-mirror sync and list endpoints`

## Deliverables

- **`routes/sap-mirror.ts`:** three endpoints under `data.sap_mirror` menu guard
  - `POST /api/sap-mirror/ingest` — `{ entityType, items }` or `{ entityType, fixture }` via `createFixtureTransport` → `ingestSapMirrorBatch`
  - `GET /api/sap-mirror/runs` — recent `sap_sync_runs` (limit query, default 50)
  - `GET /api/sap-mirror/purchase-orders` — PO mirrors with nested lines
- **`index.ts`:** mounted `sapMirrorRoutes` at `/api`

## Tests

Existing lib tests pass (23/23). No route tests added (brief did not require).

## Constraints

- No SAP network; fixture transport only for fixture body path
- Feishu list mappers untouched
- Staged only `routes/sap-mirror.ts` + `index.ts` mount

## Files (2)

`apps/web/server/routes/sap-mirror.ts`, `apps/web/server/index.ts`
