-- 纸箱按 200 磅展开面积计价（4.9 元/m²）；停用按「个」的抽样价以免误匹配。
UPDATE "material_price_book"
SET "is_active" = false, "updated_at" = now()
WHERE lower("material_name") = '纸箱' AND lower("unit") = '个';

INSERT INTO "material_price_book" (
  "region_id", "factory_id", "category", "material_name", "spec", "standard",
  "unit", "unit_price", "notes", "is_active"
)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   '包装', '纸箱', '', '', 'm²', 4.9, '包装：展开面积×4.9 元/m²', true)
ON CONFLICT (region_id, factory_id, lower(material_name), lower(spec), lower(unit), lower(standard))
DO UPDATE SET
  "category" = EXCLUDED."category",
  "unit_price" = EXCLUDED."unit_price",
  "notes" = EXCLUDED."notes",
  "is_active" = true,
  "updated_at" = now();
