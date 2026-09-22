-- 螺丝包通用价 + 纸护角；保利龙/纸箱已在 0078。
INSERT INTO "material_price_book" (
  "region_id", "factory_id", "category", "material_name", "spec", "standard",
  "unit", "unit_price", "notes", "is_active"
)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   '五金', '螺丝包', '', '', '包', 10, '通用：每件产品默认 1 包', true),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   '包装', '纸护角', '', '', '个', 0.5, '包装护角抽样价', true)
ON CONFLICT (region_id, factory_id, lower(material_name), lower(spec), lower(unit), lower(standard))
DO UPDATE SET
  "category" = EXCLUDED."category",
  "unit_price" = EXCLUDED."unit_price",
  "notes" = EXCLUDED."notes",
  "is_active" = true,
  "updated_at" = now();
