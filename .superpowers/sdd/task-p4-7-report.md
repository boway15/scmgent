# Task P4-7 Report: PO mirror → purchase_draft link

## Commit

`feat(sap-mirror): optional link PO mirrors to purchase drafts`

## API

- `POST /api/sap-mirror/purchase-orders/:id/create-draft`
- 权限：`data.sap_mirror`（admin / pmc_planner）
- 按镜像行创建 `purchase_drafts`（`source=manual`，`sourceSystem=sap`，`externalId=sap:{poId}:{lineId}`）
- 无 `skuId` 的行跳过；已存在同 `externalId` 草稿则返回 `existing`（幂等）

## Position 隔离

- 草稿 `status=draft`，无 `planItemId` → 仅计入 `unassignedOpenQty`，**不**进入 `drafts_fill_gap` 的 in-transit / confirmedOpen 桶
- PO 镜像本身仍不进 position（P4 既有约束）

## Tests

```bash
pnpm --filter @scm/web exec tsx --test server/lib/sap-mirror/create-draft-from-po-mirror.test.ts
# 5 passed
```

## Files

- `apps/web/server/lib/sap-mirror/create-draft-from-po-mirror.ts`
- `apps/web/server/lib/sap-mirror/create-draft-from-po-mirror.test.ts`
- `apps/web/server/routes/sap-mirror.ts`

## Notes

- 未改飞书四列表 / SapMirrorPage UI
- 无真实 SAP 调用
