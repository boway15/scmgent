# Task P2-7 Report: SKU 规划页展示断货修正标记

## Done
- `buildSkuPlanningView` 在 `demandSource === 'historical'` 时透出 `stockoutAdjusted`（来自 health metrics）。
- `SkuInventoryPlanningPage` 当历史需求且 `stockoutAdjusted === true` 时，在需求口径旁展示「· 日需求已按有库存天数修正」。
- 新增单测 `exposes stockoutAdjusted when demand is historical`。

## Commit
`feat: show stockout-adjusted demand flag on SKU planning page`

## Files
- `apps/web/server/lib/inventory-planning-service.ts`
- `apps/web/server/lib/inventory-planning-service.test.ts`
- `apps/web/src/pages/SkuInventoryPlanningPage.tsx`

## Verification
`node --import tsx --test server/lib/inventory-planning-service.test.ts` — 4/4 pass
