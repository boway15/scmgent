-- 周转表分区仓：美中 / 平台仓（inventory_records 分仓写入，不参与 FOB 合并）
INSERT INTO "warehouses" ("code", "name", "region_group", "country_code", "allow_cross_fulfill", "sort_order")
VALUES
  ('US-CENTRAL', '美中仓', 'US', 'US', true, 7),
  ('PLATFORM-US', '平台仓(美)', 'US', 'US', true, 8),
  ('PLATFORM-EU', '平台仓(欧)', 'EU', 'EU', true, 9)
ON CONFLICT ("code") DO NOTHING;
