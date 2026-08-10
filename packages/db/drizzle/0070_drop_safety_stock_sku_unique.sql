-- 0000 建表时约束为 per-SKU 唯一；0005 仅 DROP INDEX，未 DROP CONSTRAINT。
-- 多仓模型下同一 SKU 可有多行 (sku_id, warehouse_code)，残留约束会导致补货任务失败。
ALTER TABLE "safety_stock_config" DROP CONSTRAINT IF EXISTS "safety_stock_config_sku_id_unique";
DROP INDEX IF EXISTS "safety_stock_config_sku_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "safety_stock_config_sku_warehouse_idx"
  ON "safety_stock_config" ("sku_id", "warehouse_code");
