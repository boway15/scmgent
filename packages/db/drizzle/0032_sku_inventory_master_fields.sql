-- 库存周转表 A:K → SKU 主数据字段
ALTER TABLE "skus" ALTER COLUMN "category" TYPE varchar(500);

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "lifecycle" varchar(50);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "sales_country" varchar(100);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "product_category" varchar(200);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "owner_name" varchar(100);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "developer_name" varchar(100);
