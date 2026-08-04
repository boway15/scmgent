# Task P4-3 Report: SAP mapping helpers + fixture transport

**Status:** Done | **Commit:** `7aa7c08`

## Deliverables

- **`types.ts`:** `SapMirrorTransport`, `SapMirrorFixture`, ingest result + SAP input/mapped types
- **`map-merchant.ts`:** `mapSapVendorToMerchant` — vendorId→externalId, code fallback, trim
- **`map-sku.ts`:** `mapSapMaterialToSku` — materialId→externalId/code, unit defaults to EA
- **`map-po.ts`:** `mapSapPurchaseOrderToMirror` — head/lines for `sap_po_mirrors` upsert, raw payload preserved
- **`fixture-transport.ts`:** `loadSapMirrorFixture` + `createFixtureTransport` (in-memory or JSON file, cursor pagination)

## Tests

```bash
pnpm --filter @scm/web exec tsx --test server/lib/sap-mirror/*.test.ts
# 14 pass, 0 fail
```

## Constraints

- No SAP SDK/HTTP/network
- Feishu list mappers untouched
- Pure functions only; ingest (Task 4) consumes these mappers

## Files (9)

`apps/web/server/lib/sap-mirror/{types,map-merchant,map-sku,map-po,fixture-transport}.{ts,test.ts}`
