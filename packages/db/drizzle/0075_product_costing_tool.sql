DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'costing_project_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."costing_project_status" AS ENUM(
      'draft', 'extracting', 'ready', 'extract_failed'
    );
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'costing_project_status'
      AND n.nspname = 'public'
      AND e.enumlabel = 'bom_ready'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'costing_project_status'
      AND n.nspname = 'public'
      AND e.enumlabel = 'ready'
  ) THEN
    ALTER TYPE "public"."costing_project_status" RENAME VALUE 'bom_ready' TO 'ready';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."costing_project_status" ADD VALUE IF NOT EXISTS 'ready';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."costing_attachment_kind" AS ENUM('source', 'page_image', 'page_text');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."costing_extract_run_status" AS ENUM(
    'pending', 'running', 'succeeded', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."costing_bom_confidence" AS ENUM('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costing_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_no" varchar(32) NOT NULL,
  "name" varchar(200) NOT NULL,
  "category" varchar(100),
  "sku_id" uuid,
  "status" "costing_project_status" DEFAULT 'draft' NOT NULL,
  "extract_error" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "costing_projects_project_no_uidx"
  ON "costing_projects" ("project_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "costing_projects_status_created_idx"
  ON "costing_projects" ("status", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'costing_projects_sku_id_skus_id_fk'
  ) THEN
    ALTER TABLE "costing_projects"
      ADD CONSTRAINT "costing_projects_sku_id_skus_id_fk"
      FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'costing_projects_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "costing_projects"
      ADD CONSTRAINT "costing_projects_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costing_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "kind" "costing_attachment_kind" NOT NULL,
  "page_no" integer,
  "file_name" varchar(255) NOT NULL,
  "content_type" varchar(120) NOT NULL,
  "storage_path" varchar(500) NOT NULL,
  "byte_size" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "costing_attachments_project_kind_page_idx"
  ON "costing_attachments" ("project_id", "kind", "page_no");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'costing_attachments_project_id_costing_projects_id_fk'
  ) THEN
    ALTER TABLE "costing_attachments"
      ADD CONSTRAINT "costing_attachments_project_id_costing_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."costing_projects"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costing_extract_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "status" "costing_extract_run_status" DEFAULT 'pending' NOT NULL,
  "page_from" integer,
  "page_to" integer,
  "dify_workflow_run_id" varchar(100),
  "raw_response" jsonb,
  "error_message" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "costing_extract_runs_project_created_idx"
  ON "costing_extract_runs" ("project_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'costing_extract_runs_project_id_costing_projects_id_fk'
  ) THEN
    ALTER TABLE "costing_extract_runs"
      ADD CONSTRAINT "costing_extract_runs_project_id_costing_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."costing_projects"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'costing_extract_runs_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "costing_extract_runs"
      ADD CONSTRAINT "costing_extract_runs_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "costing_bom_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "category" varchar(50) NOT NULL,
  "material_name" varchar(200) NOT NULL,
  "spec" varchar(500),
  "unit" varchar(20) NOT NULL,
  "qty_net" numeric(14, 4) NOT NULL,
  "loss_rate" numeric(8, 4) DEFAULT '0' NOT NULL,
  "qty_gross" numeric(14, 4) NOT NULL,
  "source_ref" varchar(100),
  "confidence" "costing_bom_confidence" DEFAULT 'medium' NOT NULL,
  "notes" text,
  "is_manual" boolean DEFAULT false NOT NULL,
  "extract_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "costing_bom_lines_project_line_idx"
  ON "costing_bom_lines" ("project_id", "line_no");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'costing_bom_lines_project_id_costing_projects_id_fk'
  ) THEN
    ALTER TABLE "costing_bom_lines"
      ADD CONSTRAINT "costing_bom_lines_project_id_costing_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."costing_projects"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'costing_bom_lines_extract_run_id_costing_extract_runs_id_fk'
  ) THEN
    ALTER TABLE "costing_bom_lines"
      ADD CONSTRAINT "costing_bom_lines_extract_run_id_costing_extract_runs_id_fk"
      FOREIGN KEY ("extract_run_id") REFERENCES "public"."costing_extract_runs"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "origin" varchar(20) DEFAULT 'explicit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "price_book_id" uuid;
--> statement-breakpoint
ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "unit_price_override" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "match_status" varchar(20) DEFAULT 'unmatched' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_price_book" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" varchar(50) NOT NULL,
  "material_name" varchar(200) NOT NULL,
  "spec" varchar(500) DEFAULT '' NOT NULL,
  "unit" varchar(20) NOT NULL,
  "unit_price" numeric(14, 4) NOT NULL,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_price_book_name_spec_unit_uidx"
  ON "material_price_book" (lower("material_name"), lower("spec"), lower("unit"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_price_book_active_category_idx"
  ON "material_price_book" ("is_active", "category");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'material_price_book_unit_price_nonnegative_check'
  ) THEN
    ALTER TABLE "material_price_book"
      ADD CONSTRAINT "material_price_book_unit_price_nonnegative_check"
      CHECK ("unit_price" >= 0);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'costing_bom_lines_price_book_id_material_price_book_id_fk'
  ) THEN
    ALTER TABLE "costing_bom_lines"
      ADD CONSTRAINT "costing_bom_lines_price_book_id_material_price_book_id_fk"
      FOREIGN KEY ("price_book_id") REFERENCES "public"."material_price_book"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "costing_projects" SET "status" = 'ready'
WHERE "status"::text IN ('bom_draft', 'bom_ready', 'costed');
--> statement-breakpoint
INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '产品成本核算', 'procurement.costing', NULL, '/procurement/costing',
  (SELECT id FROM "menus" WHERE code = 'procurement' LIMIT 1), 3, true
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement.costing');
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code IN ('super_admin', 'purchaser', 'viewer')
  AND m.code = 'procurement.costing'
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
