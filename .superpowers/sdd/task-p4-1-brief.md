### Task 1: Sync 元数据列补齐

**Files:** schema merchants/skus/purchase_drafts/pmc_plans/shipments/lead_time_profiles + `0062_sync_metadata.sql`

对缺列补：`external_version varchar(50)`, `sync_status varchar(20)`, `last_sync_at timestamptz`�?
- [ ] Schema + SQL + journal  
- [ ] Commit: `feat(db): add sync_status and external_version metadata columns`

---
