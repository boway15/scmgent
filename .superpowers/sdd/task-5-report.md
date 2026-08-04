# Task 5 Report — Schema `eta_available`

**Status:** Done  
**Commit:** `feat(db): add purchase_drafts.eta_available for sellable ETA`

## Changes

| File | Action |
|------|--------|
| `packages/db/src/schema/procurement.ts` | Added `etaAvailable: date('eta_available')` after `confirmedDeliveryDate` |
| `packages/db/drizzle/0052_purchase_draft_eta_available.sql` | ADD COLUMN + backfill from `confirmed_delivery_date` |
| `packages/db/drizzle/meta/_journal.json` | Appended idx 47, tag `0052_purchase_draft_eta_available` |

## Interface

- `purchaseDrafts.etaAvailable: date | null`

## Notes

- Journal only appended 0052; existing disk migrations 0048–0051 left untouched per brief.
- Backfill copies non-null `confirmed_delivery_date` into new column for existing rows.
