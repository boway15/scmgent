### Task 4: Ingest 服务

**Files:** `apps/web/server/lib/sap-mirror/ingest.ts` + test（可用注�?db mock 或测纯编排）

`ingestSapMirrorBatch({ entityType, items, userId })` �?�?run + upsert�?
Merchant/SKU：按 `(source_system, external_id)` 查，无则 insert，有�?update name/code + sync 字段�? 
PO：upsert mirror head/lines；解�?merchant/sku id 可选�?
- [ ] Implement + tests for upsert accounting  
- [ ] Commit: `feat: ingest SAP mirror batches into local tables`

---
