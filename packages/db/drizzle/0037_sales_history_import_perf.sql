-- 销量日表：去重约束 + 导入/查询常用索引（支撑千万级写入与按日筛选）
CREATE UNIQUE INDEX IF NOT EXISTS "sales_history_sku_date_channel_unique_idx"
  ON "sales_history" ("sku_id", "sale_date", "channel");

CREATE INDEX IF NOT EXISTS "sales_history_sale_date_idx"
  ON "sales_history" ("sale_date");

CREATE INDEX IF NOT EXISTS "sales_history_import_batch_id_idx"
  ON "sales_history" ("import_batch_id")
  WHERE "import_batch_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "sales_history_source_sku_date_idx"
  ON "sales_history" ("source", "sku_id", "sale_date");
