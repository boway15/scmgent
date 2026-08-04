# Task 6 Report: 跟单 API — 读写 `etaAvailable`

## Done
- `buildEtaPatch` helper + unit test (TDD, GREEN)
- GET `/purchase-drafts` returns `etaAvailable`
- PATCH accepts `etaAvailable`; syncs `confirmedDeliveryDate`
- Legacy `confirmedDeliveryDate`-only PATCH also writes `etaAvailable`
- Confirm flow (`confirmed`) falls back to `expectedDate` → both fields
- `api.ts`: `getPurchaseTracking` / `updatePurchaseTracking` typed

## Test
```
pnpm --filter @scm/web exec tsx --test server/lib/purchase-draft-eta.test.ts
→ 1 pass
```

## Commit
`feat: expose eta_available on purchase draft API`
