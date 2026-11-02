-- 销售渠道目录统一：源表已出现平台单独落码；品牌站停用；其他显示 UNKNOWN。
INSERT INTO "sales_platforms" ("code", "name", "station", "sort_order", "is_active")
VALUES
  ('ALL', '全平台汇总', NULL, 0, true),
  ('AMAZON', '亚马逊', 'US', 10, true),
  ('WALMART', '沃尔玛', 'US', 20, true),
  ('WAYFAIR', 'Wayfair', 'US', 30, true),
  ('TIKTOK', 'TikTok Shop', 'US', 40, true),
  ('TEMU', 'Temu', 'US', 50, true),
  ('SHOPIFY', 'Shopify', NULL, 60, true),
  ('EBAY', 'eBay', 'US', 70, true),
  ('ETSY', 'Etsy', NULL, 80, true),
  ('MANOMANO', 'ManoMano', NULL, 90, true),
  ('REAL', 'Real', NULL, 100, true),
  ('OTTO', 'OTTO', NULL, 110, true),
  ('B2B', 'B2B小包', NULL, 120, true),
  ('UNKNOWN', '其他', NULL, 130, true),
  ('DTC', '品牌站', NULL, 50, false)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "station" = COALESCE(EXCLUDED."station", "sales_platforms"."station"),
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = EXCLUDED."is_active";
--> statement-breakpoint
UPDATE "sales_platforms" SET "is_active" = false WHERE "code" = 'DTC';
--> statement-breakpoint
UPDATE "sales_platform_aliases" SET "platform_code" = 'SHOPIFY' WHERE "alias" = '独立站';
--> statement-breakpoint
INSERT INTO "sales_platform_aliases" ("alias", "platform_code")
VALUES
  ('亚马逊', 'AMAZON'),
  ('AMZ', 'AMAZON'),
  ('AMAZON', 'AMAZON'),
  ('AMAZON.COM', 'AMAZON'),
  ('AMAZON US', 'AMAZON'),
  ('AMAZON-US', 'AMAZON'),
  ('沃尔玛', 'WALMART'),
  ('WALMART', 'WALMART'),
  ('WM', 'WALMART'),
  ('wayfair', 'WAYFAIR'),
  ('WAYFAIR', 'WAYFAIR'),
  ('Tiktok', 'TIKTOK'),
  ('TIKTOK', 'TIKTOK'),
  ('TT', 'TIKTOK'),
  ('TIK TOK', 'TIKTOK'),
  ('TIKTOK SHOP', 'TIKTOK'),
  ('TEMU', 'TEMU'),
  ('Temu', 'TEMU'),
  ('Shopify', 'SHOPIFY'),
  ('SHOPIFY', 'SHOPIFY'),
  ('独立站', 'SHOPIFY'),
  ('品牌站', 'SHOPIFY'),
  ('DTC', 'SHOPIFY'),
  ('eBay', 'EBAY'),
  ('EBAY', 'EBAY'),
  ('etsy', 'ETSY'),
  ('ETSY', 'ETSY'),
  ('manomano', 'MANOMANO'),
  ('MANOMANO', 'MANOMANO'),
  ('Real', 'REAL'),
  ('REAL', 'REAL'),
  ('otto', 'OTTO'),
  ('OTTO', 'OTTO'),
  ('B2B', 'B2B'),
  ('B2B小包', 'B2B'),
  ('未知', 'UNKNOWN'),
  ('UNKNOWN', 'UNKNOWN'),
  ('全平台', 'ALL')
ON CONFLICT ("alias") DO UPDATE SET
  "platform_code" = EXCLUDED."platform_code";
