-- 库存查询飞书明细同一 SKU 可有多行（如按销售国家拆行），不能按 (snapshot_date, sku_code) 唯一。
DROP INDEX IF EXISTS "inventory_query_daily_snapshots_date_sku_code_unique_idx";
CREATE INDEX IF NOT EXISTS "inventory_query_daily_snapshots_date_sku_code_idx"
  ON "inventory_query_daily_snapshots" ("snapshot_date", "sku_code");
