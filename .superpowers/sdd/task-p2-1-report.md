# Task P2-1 Report: 断货修正纯函数

## Status
**DONE**

## Base / Commits
- **BASE (before):** `0f36d70aa2390819f786b227941fcfab8c5e919e`
- **Commit:** `d1a8617edfb64501b25c1de39198b48634362ad3`
- **Message:** `feat: add stockout-adjusted effective daily demand helper`
- **Files:** `effective-daily-demand.ts`, `effective-daily-demand.test.ts` only

## Tests
```
pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts
→ 2 pass, 0 fail
```
- TDD: tests written first → implementation → GREEN
- 30 天窗 / 10 天断货 / 1000 销量 → avgDaily=50；无 availability 回退 calendarSold/windowDays

## Implementation Summary
- `calcEffectiveDailyDemand`: 窗口为 asOf 前 windowDays 个完整日历日（不含 asOf 当日）
- 有库存快照时：`avgDaily = soldOnInStockDays / inStockDays`，`stockoutAdjusted: true`
- 无快照时：`avgDaily = calendarSold / windowDays`，`stockoutAdjusted: false`
- 未改动 Feishu 同步列表 UI/mapper
