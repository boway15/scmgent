DO $$ BEGIN
  CREATE TYPE "sku_kind" AS ENUM ('standard', 'accessory', 'multi_box', 'return', 'legacy');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "division_code" varchar(1);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "distribution_no" integer DEFAULT 0;
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "spu_numeric_code" varchar(5);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "brand_code" varchar(2);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "category_code" varchar(3);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "division_name" varchar(50);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "encoding_source" varchar(20) DEFAULT 'manual';

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "external_code" varchar(20);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "internal_code" varchar(12);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "sku_kind" "sku_kind" DEFAULT 'legacy';
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "division_code" varchar(1);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "distribution_no" integer;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "spu_numeric_code" varchar(5);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "variant_no" varchar(2);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "brand_code" varchar(2);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "category_code" varchar(3);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "factory_suffix" varchar(1);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "accessory_no" varchar(3);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "box_no" varchar(1);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "encoding_valid" boolean DEFAULT false NOT NULL;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "encoding_meta" jsonb;

CREATE INDEX IF NOT EXISTS "spus_division_spu_numeric_idx" ON "spus" ("division_code", "spu_numeric_code");
CREATE INDEX IF NOT EXISTS "skus_internal_code_idx" ON "skus" ("internal_code");
CREATE INDEX IF NOT EXISTS "skus_external_code_idx" ON "skus" ("external_code");
