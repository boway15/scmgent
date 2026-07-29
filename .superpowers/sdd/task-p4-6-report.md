# Task P4-6 Report: SAP mirror admin page + menu

## Commit

`feat: add SAP mirror admin page`

## Route / menu

- **Path:** `/data/sap-mirror`
- **Menu code:** `data.sap_mirror`（父级 `data`）
- **Roles:** `super_admin`, `pmc_planner`

## UI

- 实体类型下拉（merchant / sku / purchase_order）
- JSON 数组粘贴 + 提交 → `POST /api/sap-mirror/ingest`
- 展示本次 run summary（inserted / updated / skipped / errors）
- 最近同步记录表 → `GET /api/sap-mirror/runs`
- PO 镜像只读表 → `GET /api/sap-mirror/purchase-orders`

## Files

- `apps/web/src/pages/SapMirrorPage.tsx`
- `apps/web/src/router.tsx`
- `apps/web/src/lib/api.ts`
- `packages/db/drizzle/0064_sap_mirror_menu.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/src/seed.ts`

## Notes

- 未改飞书四列表页
- 无真实 SAP 调用，仅前端调 `/api/sap-mirror/*`
