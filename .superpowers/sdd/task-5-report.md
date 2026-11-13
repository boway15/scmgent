# Task 5 Report

**Status:** Done  
**Commits:** none (per instruction)

## Summary

- `DemandPlanPilotPage.tsx`: removed `pageSize: 500` and client filter/slice; list query uses `page` / `pageSize` / `status` / `q`; `ListPagination` `total` from server; added「创建人」column before「创建 / 发布」(`createdByName ?? '—'`).
- Page-header「已发布 N 个版本」uses lightweight query `status: pilot_published, pageSize: 1` → `total`.
- `ForecastStrategySection.tsx` (weekly): draft lookup aligned with monthly — `status: draft, page: 1, pageSize: 1`, first item as latest draft.

## Concerns

- Full `npx tsc --noEmit` fails on pre-existing server build-artifact TS6305; IDE lints clean on touched files. Manual UI verify: `/data/demand-plan` pagination, filters, search, creator column.

## Path

`apps/web/src/pages/DemandPlanPilotPage.tsx`, `apps/web/src/components/ForecastStrategySection.tsx`
