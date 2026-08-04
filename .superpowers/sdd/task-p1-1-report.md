# Task P1-1 Report: 扩展 LeadTimeBreakdown

## Status
**DONE**

## Base / Commits
- **BASE (before):** `c92b1e463855558d665164cdbf0f0a2a7474fc31`
- **Commit:** `a7b8296bff6cd97573aa3389141c69b2f8b72c0c`
- **Message:** `feat: extend lead time breakdown to six segments with compat aliases`
- **Files:** `replenishment-coverage.ts`, `replenishment-coverage.test.ts` only

## Tests
```
pnpm --filter @scm/web exec tsx --test server/lib/replenishment-coverage.test.ts
→ 11 pass, 0 fail
```
- TDD: RED (2 new tests failed) → GREEN (all 11 pass)
- Existing tests unchanged and passing

## Implementation Summary
- `LeadTimeBreakdown` extended with six segments: `productionDays`, `domesticDays`, `bookingDays`, `transitDays`, `customsDays`, `inboundDays`
- Compat aliases: `shippingDays` (= booking+transit+customs), `inboundBufferDays` (= inboundDays)
- Optional `profileId` on type (not set by `calcTotalLeadTime`; reserved for resolver)
- Legacy path: `shippingDays` without explicit booking/transit/customs → `transitDays`; `inboundBufferDays` → `inboundDays`
- No Feishu-sync or other module changes

## Concerns
- `calcCoverageReplenishment` still passes legacy `shippingDays`/`inboundBufferDays` — works via compat path; Task 2+ may wire six-segment resolver
- `formatCoverageReason` still prints "海运" using `shippingDays` compat alias — acceptable for now

## Docs
No docs commit (scope limited to pure functions per mandate).
