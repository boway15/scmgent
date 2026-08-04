# Task 7 Report: 跟单页 UI — 预计可售日

## Done
- 页头说明补充「交期/日期表示预计可售日（到仓上架后可售），不是到港日」
- 列名改为「预计可售日」；展示 `etaAvailable ?? confirmedDeliveryDate ?? expectedDate`
- `draft` 行：`Input type="date"` +「确认交期」→ `PATCH { status: 'confirmed', etaAvailable }`
- `confirmed` 行：日期输入 +「更新可售日」→ 仅 `PATCH { etaAvailable }`（不传 status）
- Commit: `feat: capture sellable ETA on purchase tracking UI`

## Manual checklist (code-verified, E2E pending)
| # | Item | Code | Manual |
|---|------|------|--------|
| 1 | `/pmc/tracking` 文案含「预计可售日」 | ✅ 页头 + 列头 | 待浏览器确认 |
| 2 | 确认交期后列表显示该日、刷新仍在 | ✅ mutation + invalidate | 待操作确认 |
| 3 | DB `eta_available` 与 `confirmed_delivery_date` 一致 | ✅ 后端 `buildEtaPatch` 双写 | 待 SQL 抽查 |

## Files
- `apps/web/src/pages/PurchaseTrackingPage.tsx` (only)
