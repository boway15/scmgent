-- 日序列 / 最新库存查询：sku + warehouse + recorded_date；created_at DESC 配合 DISTINCT ON
-- 线上大表可先在 autocommit 下 CREATE INDEX CONCURRENTLY 同名索引，再跑 migrate（IF NOT EXISTS 会跳过）
CREATE INDEX IF NOT EXISTS "inventory_records_sku_wh_date_idx"
  ON "inventory_records" ("sku_id", "warehouse", "recorded_date", "created_at" DESC);
