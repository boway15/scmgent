-- 周转 × 三池 × 影子 对照（PostgreSQL）
-- 使用前替换 :sku_code 与 :snapshot_date（上海业务日，通常与 getShanghaiBusinessDate 一致）

-- 1) SKU id
-- SELECT id, code FROM skus WHERE code = :sku_code;

-- 2) 周转最新行（import）
WITH sku AS (SELECT id FROM skus WHERE code = :sku_code LIMIT 1)
SELECT DISTINCT ON (warehouse)
  warehouse,
  qty_available,
  qty_in_transit,
  qty_in_production,
  qty_reserved,
  recorded_date
FROM inventory_records, sku
WHERE sku_id = sku.id AND source = 'import'
ORDER BY warehouse, recorded_date DESC, created_at DESC;

-- 3) 三池 open 汇总
WITH sku AS (SELECT id FROM skus WHERE code = :sku_code LIMIT 1)
SELECT warehouse_code, pool, SUM(qty) AS qty, COUNT(*) AS batches
FROM inventory_supply_lots, sku
WHERE sku_id = sku.id AND status = 'open'
GROUP BY warehouse_code, pool
ORDER BY warehouse_code, pool;

-- 4) 影子 selected
WITH sku AS (SELECT id FROM skus WHERE code = :sku_code LIMIT 1)
SELECT warehouse_code, bucket, qty, source, mapped, warehouse_raw
FROM warehouse_stock_facts, sku
WHERE snapshot_date = :snapshot_date::date
  AND sku_id = sku.id
  AND selected = true
ORDER BY warehouse_code, bucket;

-- 5) 物理仓宽表（需先跑 2–4 或在应用层 join；示例用 US-WEST）
-- 周转可售 / 三池 overseas / 影子 on_hand 应同向；在途同理
