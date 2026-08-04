# P2 Task 3 实施报告

- 新增 `packages/db/src/schema/shipments.ts`：`shipments`（shipmentNo 唯一、draft/planItem/sku 关联、qty、物流字段、status varchar、etaAvailable）与 `shipment_milestones`（planned/actual 日期、remark）。
- `shipment_milestones` 对 `(shipmentId, milestone)` 建唯一索引；里程碑表 cascade 删除。
- 迁移 `0057_shipments.sql` 含 FK（draft/plan_item set null、sku restrict）及 draft/sku/status 索引。
- `schema/index.ts` 导出 shipments；journal 追加 idx 52。
- 未修改飞书 UI/mapper。
- `@scm/db` tsc --noEmit 通过。
- 提交：`feat(db): add shipments and shipment_milestones tables`
