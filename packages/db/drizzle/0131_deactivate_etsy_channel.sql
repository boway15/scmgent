-- 源表和日销都没有 Etsy。停用筛选项，已有别名并入「其他」。
UPDATE "sales_platforms" SET "is_active" = false WHERE "code" = 'ETSY';
--> statement-breakpoint
UPDATE "sales_platform_aliases" SET "platform_code" = 'UNKNOWN' WHERE "alias" IN ('etsy', 'ETSY');
