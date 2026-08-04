# Task P2-6 Report: 跟单与发运弱关联

## Done
- **PurchaseTrackingPage**：新增「发运」列；已关联发运显示「查看发运」，否则在可发运状态显示「创建发运」，均跳转 `/pmc/shipments?draftId=`
- **ShipmentsPage**：读取 `draftId` query；筛选/高亮关联发运；无发运时展示预填创建表单（单号、数量、可售日、运输方式）
- **ShipmentsPage.test.ts**：补充 `shipmentsForDraftId`、`buildShipmentCreatePrefill` 单测

## Scope
- 仅改 `PurchaseTrackingPage.tsx`、`ShipmentsPage.tsx`（及测试）；未动飞书跟进列表

## Verify
```bash
pnpm --filter @scm/web exec tsx --test src/pages/ShipmentsPage.test.ts
# 5 passed
```

## Commit
`feat: link PMC tracking drafts to shipments`
