CREATE TABLE IF NOT EXISTS "shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_no" varchar(100) NOT NULL,
  "draft_id" uuid,
  "plan_item_id" uuid,
  "sku_id" uuid NOT NULL,
  "qty" integer NOT NULL,
  "container_no" varchar(100),
  "booking_ref" varchar(100),
  "tracking_no" varchar(100),
  "transport_mode" varchar(50),
  "status" varchar(30) DEFAULT 'booked' NOT NULL,
  "eta_available" date,
  "source_system" varchar(50),
  "external_id" varchar(100),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "shipments_shipment_no_unique" UNIQUE("shipment_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL,
  "milestone" varchar(30) NOT NULL,
  "planned_at" date,
  "actual_at" date,
  "remark" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_draft_id_purchase_drafts_id_fk"
  FOREIGN KEY ("draft_id") REFERENCES "public"."purchase_drafts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_plan_item_id_pmc_plan_items_id_fk"
  FOREIGN KEY ("plan_item_id") REFERENCES "public"."pmc_plan_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sku_id_skus_id_fk"
  FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_shipment_id_shipments_id_fk"
  FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_draft_id_idx" ON "shipments" ("draft_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_sku_id_idx" ON "shipments" ("sku_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_status_idx" ON "shipments" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_milestones_shipment_milestone_idx"
  ON "shipment_milestones" ("shipment_id", "milestone");
