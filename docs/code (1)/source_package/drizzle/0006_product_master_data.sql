-- 商品主数据：SPU / 商家 / SKU 供货关系 / 合规属性

CREATE TABLE IF NOT EXISTS "spus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "category" varchar(100),
  "brand" varchar(100),
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "spus_code_unique" UNIQUE("code")
);

CREATE INDEX IF NOT EXISTS "spus_category_idx" ON "spus" ("category");

CREATE TABLE IF NOT EXISTS "merchants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "contact_name" varchar(100),
  "contact_phone" varchar(50),
  "contact_email" varchar(200),
  "country_code" varchar(2),
  "payment_terms" varchar(100),
  "remark" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchants_code_unique" UNIQUE("code")
);

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "spu_id" uuid;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "spec_attrs" jsonb;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "barcode" varchar(100);

DO $$ BEGIN
  ALTER TABLE "skus" ADD CONSTRAINT "skus_spu_id_spus_id_fk"
    FOREIGN KEY ("spu_id") REFERENCES "public"."spus"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "skus_spu_id_idx" ON "skus" ("spu_id");

CREATE TABLE IF NOT EXISTS "sku_suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "merchant_id" uuid NOT NULL,
  "unit_price" numeric(12, 4),
  "lead_time_days" integer,
  "moq" integer,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_merchant_id_merchants_id_fk"
    FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "sku_suppliers_sku_merchant_idx" ON "sku_suppliers" ("sku_id", "merchant_id");
CREATE INDEX IF NOT EXISTS "sku_suppliers_sku_id_idx" ON "sku_suppliers" ("sku_id");
CREATE INDEX IF NOT EXISTS "sku_suppliers_merchant_id_idx" ON "sku_suppliers" ("merchant_id");

CREATE TABLE IF NOT EXISTS "sku_compliance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "hs_code" varchar(20),
  "origin_country" varchar(2),
  "declared_value" numeric(12, 4),
  "weight_kg" numeric(10, 4),
  "length_cm" numeric(8, 2),
  "width_cm" numeric(8, 2),
  "height_cm" numeric(8, 2),
  "battery_type" varchar(50),
  "is_liquid" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sku_compliance_sku_id_unique" UNIQUE("sku_id")
);

DO $$ BEGIN
  ALTER TABLE "sku_compliance" ADD CONSTRAINT "sku_compliance_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 从现有 SKU 冗余商家字段回填商家主数据
INSERT INTO "merchants" ("code", "name")
SELECT DISTINCT s."merchant_code", COALESCE(NULLIF(TRIM(s."merchant_name"), ''), s."merchant_code")
FROM "skus" s
WHERE s."merchant_code" IS NOT NULL AND TRIM(s."merchant_code") <> ''
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updated_at" = now();

-- 现有 SKU 各建一条 SPU（过渡策略，后续可合并）
INSERT INTO "spus" ("code", "name", "category")
SELECT s."code", s."name", s."category"
FROM "skus" s
WHERE NOT EXISTS (SELECT 1 FROM "spus" p WHERE p."code" = s."code")
ON CONFLICT ("code") DO NOTHING;

UPDATE "skus" s
SET "spu_id" = p."id"
FROM "spus" p
WHERE s."spu_id" IS NULL AND p."code" = s."code";

-- 回填 SKU 供货关系
INSERT INTO "sku_suppliers" ("sku_id", "merchant_id", "unit_price", "lead_time_days", "moq", "is_default")
SELECT s."id", m."id", s."unit_cost", s."lead_time_days", s."moq", true
FROM "skus" s
INNER JOIN "merchants" m ON m."code" = s."merchant_code"
WHERE s."merchant_code" IS NOT NULL AND TRIM(s."merchant_code") <> ''
ON CONFLICT ("sku_id", "merchant_id") DO NOTHING;
