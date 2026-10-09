-- 0000 建表 UNIQUE(sku_id)；0005/0069 本应 DROP，但 0069 被插进 journal 中段，
-- 现网已执行后续迁移后 drizzle-kit 不再回放 0069，残留约束会让补货任务
-- 给同一 SKU 写入第二仓时失败。本迁移挂在 journal 末尾，语句幂等。
ALTER TABLE "safety_stock_config" DROP CONSTRAINT IF EXISTS "safety_stock_config_sku_id_unique";
DROP INDEX IF EXISTS "safety_stock_config_sku_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "safety_stock_config_sku_warehouse_idx"
  ON "safety_stock_config" ("sku_id", "warehouse_code");
