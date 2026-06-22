DO $$ BEGIN
 CREATE TYPE "public"."purchase_draft_status" AS ENUM('draft', 'submitted', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."purchase_draft_source" AS ENUM('reorder', 'pmc', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_no" varchar(100) NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"expected_date" date,
	"source" "purchase_draft_source" DEFAULT 'manual' NOT NULL,
	"source_ref_id" uuid,
	"status" "purchase_draft_status" DEFAULT 'draft' NOT NULL,
	"remark" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_drafts_draft_no_unique" UNIQUE("draft_no")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_drafts" ADD CONSTRAINT "purchase_drafts_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_drafts" ADD CONSTRAINT "purchase_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_drafts_status_idx" ON "purchase_drafts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_drafts_sku_id_idx" ON "purchase_drafts" USING btree ("sku_id");
