CREATE TABLE IF NOT EXISTS "sap_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_system" varchar(50) DEFAULT 'sap' NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "status" varchar(20) DEFAULT 'running' NOT NULL,
  "requested_by" uuid,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz,
  "summary" jsonb,
  "error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sap_po_mirrors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_system" varchar(50) DEFAULT 'sap' NOT NULL,
  "external_id" varchar(100) NOT NULL,
  "external_version" varchar(50),
  "sync_status" varchar(20),
  "last_sync_at" timestamptz,
  "po_number" varchar(100),
  "vendor_external_id" varchar(100),
  "merchant_code" varchar(100),
  "order_date" date,
  "status_raw" varchar(100),
  "payload" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sap_po_mirror_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mirror_id" uuid NOT NULL,
  "external_line_id" varchar(100) NOT NULL,
  "sku_external_id" varchar(100),
  "sku_id" uuid,
  "qty" integer,
  "uom" varchar(20),
  "delivery_date" date,
  "payload" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sap_sync_runs"
 ADD CONSTRAINT "sap_sync_runs_requested_by_users_id_fk"
 FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sap_po_mirror_lines"
 ADD CONSTRAINT "sap_po_mirror_lines_mirror_id_sap_po_mirrors_id_fk"
 FOREIGN KEY ("mirror_id") REFERENCES "public"."sap_po_mirrors"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sap_po_mirror_lines"
 ADD CONSTRAINT "sap_po_mirror_lines_sku_id_skus_id_fk"
 FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sap_sync_runs_entity_started_idx"
  ON "sap_sync_runs" ("entity_type", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sap_sync_runs_status_idx"
  ON "sap_sync_runs" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sap_po_mirrors_source_external_idx"
  ON "sap_po_mirrors" ("source_system", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sap_po_mirrors_po_number_idx"
  ON "sap_po_mirrors" ("po_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sap_po_mirrors_sync_status_idx"
  ON "sap_po_mirrors" ("sync_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sap_po_mirror_lines_mirror_line_idx"
  ON "sap_po_mirror_lines" ("mirror_id", "external_line_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sap_po_mirror_lines_mirror_id_idx"
  ON "sap_po_mirror_lines" ("mirror_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sap_po_mirror_lines_sku_id_idx"
  ON "sap_po_mirror_lines" ("sku_id");
