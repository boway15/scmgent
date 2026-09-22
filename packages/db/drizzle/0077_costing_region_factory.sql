CREATE TABLE IF NOT EXISTS "costing_regions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "name" varchar(80) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "costing_regions_code_uidx" ON "costing_regions" ("code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costing_factories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "name" varchar(80) NOT NULL,
  "region_id" uuid REFERENCES "costing_regions"("id") ON DELETE SET NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "costing_factories_code_uidx" ON "costing_factories" ("code");
--> statement-breakpoint
INSERT INTO "costing_regions" ("id", "code", "name", "sort_order")
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'generic', '通用', 0),
  ('a0000000-0000-4000-8000-000000000011', 'changzhou', '常州', 1),
  ('a0000000-0000-4000-8000-000000000012', 'zhangzhou', '漳州', 2),
  ('a0000000-0000-4000-8000-000000000013', 'fuqing', '福清', 3),
  ('a0000000-0000-4000-8000-000000000014', 'shandong', '山东', 4)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "costing_factories" ("id", "code", "name", "region_id", "sort_order")
VALUES
  ('a0000000-0000-4000-8000-000000000002', 'generic', '通用', 'a0000000-0000-4000-8000-000000000001', 0),
  ('a0000000-0000-4000-8000-000000000021', 'yueshuya', '约书亚', 'a0000000-0000-4000-8000-000000000011', 1),
  ('a0000000-0000-4000-8000-000000000022', 'maijunqi', '麦骏琪', 'a0000000-0000-4000-8000-000000000011', 2),
  ('a0000000-0000-4000-8000-000000000023', 'guanshan', '官山', 'a0000000-0000-4000-8000-000000000012', 3),
  ('a0000000-0000-4000-8000-000000000024', 'haiqing', '海庆', 'a0000000-0000-4000-8000-000000000014', 4),
  ('a0000000-0000-4000-8000-000000000025', 'xinhaoteng', '欣浩腾', 'a0000000-0000-4000-8000-000000000012', 5),
  ('a0000000-0000-4000-8000-000000000026', 'beijiesen', '贝杰森', 'a0000000-0000-4000-8000-000000000012', 6),
  ('a0000000-0000-4000-8000-000000000027', 'hanfu', '瀚福', NULL, 7),
  ('a0000000-0000-4000-8000-000000000028', 'guangsi', '广思', NULL, 8),
  ('a0000000-0000-4000-8000-000000000029', 'heyuanchang', '合元昌', NULL, 9),
  ('a0000000-0000-4000-8000-000000000030', 'anfeng', '安丰', NULL, 10),
  ('a0000000-0000-4000-8000-000000000031', 'chenya', '晨雅', NULL, 11)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costing_factory_fee_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "region_id" uuid NOT NULL REFERENCES "costing_regions"("id") ON DELETE CASCADE,
  "factory_id" uuid NOT NULL REFERENCES "costing_factories"("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "rate" numeric(8, 4) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "costing_factory_fee_rates_rate_nonnegative_check" CHECK ("rate" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "costing_factory_fee_rates_slice_name_uidx"
  ON "costing_factory_fee_rates" ("region_id", "factory_id", "name");
--> statement-breakpoint
ALTER TABLE "material_price_book" ADD COLUMN IF NOT EXISTS "region_id" uuid;
--> statement-breakpoint
ALTER TABLE "material_price_book" ADD COLUMN IF NOT EXISTS "factory_id" uuid;
--> statement-breakpoint
ALTER TABLE "material_price_book" ADD COLUMN IF NOT EXISTS "standard" varchar(40) DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "material_price_book"
SET "region_id" = 'a0000000-0000-4000-8000-000000000001'
WHERE "region_id" IS NULL;
--> statement-breakpoint
UPDATE "material_price_book"
SET "factory_id" = 'a0000000-0000-4000-8000-000000000002'
WHERE "factory_id" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'material_price_book_region_id_costing_regions_id_fk'
  ) THEN
    ALTER TABLE "material_price_book"
      ADD CONSTRAINT "material_price_book_region_id_costing_regions_id_fk"
      FOREIGN KEY ("region_id") REFERENCES "costing_regions"("id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'material_price_book_factory_id_costing_factories_id_fk'
  ) THEN
    ALTER TABLE "material_price_book"
      ADD CONSTRAINT "material_price_book_factory_id_costing_factories_id_fk"
      FOREIGN KEY ("factory_id") REFERENCES "costing_factories"("id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "material_price_book_name_spec_unit_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_price_book_slice_uidx"
  ON "material_price_book" (
    "region_id",
    "factory_id",
    lower("material_name"),
    lower("spec"),
    lower("unit"),
    lower("standard")
  );
--> statement-breakpoint
ALTER TABLE "costing_projects" ADD COLUMN IF NOT EXISTS "region_id" uuid;
--> statement-breakpoint
ALTER TABLE "costing_projects" ADD COLUMN IF NOT EXISTS "factory_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'costing_projects_region_id_costing_regions_id_fk'
  ) THEN
    ALTER TABLE "costing_projects"
      ADD CONSTRAINT "costing_projects_region_id_costing_regions_id_fk"
      FOREIGN KEY ("region_id") REFERENCES "costing_regions"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'costing_projects_factory_id_costing_factories_id_fk'
  ) THEN
    ALTER TABLE "costing_projects"
      ADD CONSTRAINT "costing_projects_factory_id_costing_factories_id_fk"
      FOREIGN KEY ("factory_id") REFERENCES "costing_factories"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "costing_bom_lines" ADD COLUMN IF NOT EXISTS "match_scope" varchar(20);
