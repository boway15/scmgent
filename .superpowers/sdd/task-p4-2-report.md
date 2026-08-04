# Task P4-2 Report: sap_sync_runs + sap_po_mirrors schema

**Status:** Done | **Commit:** `35835e7`

## Tables (design §3)

- **`sap_sync_runs`:** source_system, entity_type, status, requested_by, started/finished_at, summary jsonb, error_message
- **`sap_po_mirrors`:** external id/version, sync metadata, po_number, vendor/merchant, order_date, status_raw, payload; unique `(source_system, external_id)`
- **`sap_po_mirror_lines`:** mirror FK, external_line_id, sku refs, qty/uom/delivery_date, payload; unique `(mirror_id, external_line_id)`

## Files

`packages/db/src/schema/sap-mirror.ts`, `0063_sap_mirror.sql`, `index.ts` export, journal idx 56

Schema only; no Feishu or SAP transport.
